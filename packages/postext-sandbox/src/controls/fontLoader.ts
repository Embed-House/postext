import type { CustomFontFamily, CustomFontVariant, PostextConfig, VerticalAlternatesFace } from 'postext';
import type { FontPayload } from 'postext/worker';
import {
  markdownHasComics,
  isJapaneseLanguage,
  chineseScriptOf,
  loadVerticalAlternates,
  localeScript,
  unregisterVerticalAlternates,
  prepareFonts,
  comicFontFamilies,
  configFontFaces,
  fontSampleText,
} from 'postext';
import type { PostextContent } from 'postext';
import { getFontFile } from '../storage/fontStorage';
import { parseUnicodeRange } from '../viewport/fontsourceSlices';

const FONT_LOAD_TIMEOUT_MS = 3000;

// What a configuration asks of its faces lives in the engine, shared with
// the CLI; re-exported here for the Sandbox's own callers.
import {
  collectFontUsage,
  hasLatinEmphasis,
  configFontFamilies as getConfigFontFamilies,
  STANDARD_FONT_VARIANTS,
  type FontContentText,
  type FontUsageDocument,
  type FontVariantUse,
} from 'postext';
export { collectFontUsage, hasLatinEmphasis, getConfigFontFamilies, STANDARD_FONT_VARIANTS };
export type { FontContentText, FontUsageDocument, FontVariantUse };

const loadedFonts = new Set<string>();
const loadingPromises = new Map<string, Promise<void>>();

/** A face of a family as it is served: one file, with the weight, the slant
 *  and the characters (`unicode-range`) it answers for. */
export interface FamilyFace {
  family: string;
  /** `'400'`, or a range (`'100 900'`). */
  weight: string;
  style: string;
  unicodeRange?: string;
  url: string;
}

interface FontMetadata {
  variable: boolean;
  weights: number[];
  hasItalic: boolean;
  /** The family's files on Fontsource, for a family Google Fonts does not
   *  serve (Fontsource's `type` is not `google`: Commit Mono, FiraGO,
   *  DejaVu Sans…): asked of Google, its style sheet is a 400 with no CORS
   *  headers (#689). */
  fontsource?: FamilyFace[];
}

/** What the Fontsource API says of a family, as far as the loader reads it. */
interface FontsourceRecord {
  variable?: boolean;
  weights?: number[];
  styles?: string[];
  type?: string;
  unicodeRange?: Record<string, string>;
  variants?: Record<string, Record<string, Record<string, { url?: { woff2?: string } }>>>;
}

/** The WOFF2 files of a Fontsource record, one face per weight, style and
 *  subset, in the order the record lists them. */
function fontsourceFaces(family: string, data: FontsourceRecord): FamilyFace[] {
  const out: FamilyFace[] = [];
  const ranges = data.unicodeRange ?? {};
  for (const [weight, styles] of Object.entries(data.variants ?? {})) {
    for (const [style, subsets] of Object.entries(styles ?? {})) {
      for (const [subset, file] of Object.entries(subsets ?? {})) {
        const url = file?.url?.woff2;
        if (!url) continue;
        const unicodeRange = ranges[subset] ?? ranges[`[${subset}]`];
        out.push({ family, weight, style: style === 'italic' ? 'italic' : 'normal', ...(unicodeRange ? { unicodeRange } : {}), url });
      }
    }
  }
  return out;
}

const metadataCache = new Map<string, FontMetadata | null>();
const metadataInFlight = new Map<string, Promise<FontMetadata | null>>();

function toFontsourceId(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '-');
}

async function fetchFontMetadata(family: string): Promise<FontMetadata | null> {
  if (metadataCache.has(family)) return metadataCache.get(family)!;
  const existing = metadataInFlight.get(family);
  if (existing) return existing;

  const promise = (async (): Promise<FontMetadata | null> => {
    try {
      const res = await fetch(`https://api.fontsource.org/v1/fonts/${toFontsourceId(family)}`);
      if (!res.ok) return null;
      const data = await res.json() as FontsourceRecord;
      const weights = (data.weights ?? []).filter((w) => typeof w === 'number');
      if (weights.length === 0) return null;
      // Fontsource also lists families that are not on Google Fonts.
      const own = data.type !== undefined && data.type !== 'google' ? fontsourceFaces(family, data) : [];
      return {
        variable: data.variable === true,
        weights,
        hasItalic: (data.styles ?? []).includes('italic'),
        ...(own.length > 0 ? { fontsource: own } : {}),
      };
    } catch {
      return null;
    }
  })();

  metadataInFlight.set(family, promise);
  const meta = await promise;
  metadataCache.set(family, meta);
  metadataInFlight.delete(family);
  for (const cb of fontSourceListeners) cb(family);
  return meta;
}

/** Where the loader takes a family from. */
export type FontFamilySource = 'custom' | 'google' | 'fontsource' | 'missing';

const fontSourceListeners = new Set<(family: string) => void>();

/** Calls `cb` each time the loader learns where a family comes from (its
 *  record arrived, or the answer that no service has it). */
export function onFontSourceResolved(cb: (family: string) => void): () => void {
  fontSourceListeners.add(cb);
  return () => { fontSourceListeners.delete(cb); };
}

/**
 * Where a family comes from, as the loader resolved it (#739): `custom`
 * for a family uploaded as files; `fontsource` for one Google Fonts does
 * not have and Fontsource does (its own files are declared, #689);
 * `google` for any other family the services know; `missing` for one
 * neither has (a misspelt name, a system font) and for a custom family
 * whose files were removed. Undefined while no answer has come: the
 * request is in flight or was never made.
 */
export function fontFamilySource(family: string): FontFamilySource | undefined {
  if (isCustomFontFamily(family)) return 'custom';
  if (isRemovedCustomFontFamily(family)) return 'missing';
  if (!metadataCache.has(family)) return undefined;
  const meta = metadataCache.get(family);
  if (!meta) return 'missing';
  return meta.fontsource ? 'fontsource' : 'google';
}

/**
 * Build a Google Fonts CSS2 URL that exposes the full weight axis of a
 * variable font, so canvas text can interpolate across intermediate weights
 * instead of snapping between discrete static instances.
 *
 * - Variable fonts: use `wght@{min}..{max}`, which makes Google Fonts emit a
 *   single `@font-face` with `font-weight: {min} {max}` pointing to the VF.
 *   This is the only shape the browser will interpolate across on canvas.
 * - Static fonts: request each supported weight explicitly.
 * - Unknown fonts (metadata fetch failed): fall back to the historical
 *   regular/bold pair so the font still renders.
 */
function buildFontUrl(family: string, meta: FontMetadata | null): string {
  const name = encodeURIComponent(family);
  if (!meta) {
    return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
  }
  const min = Math.min(...meta.weights);
  const max = Math.max(...meta.weights);
  if (meta.variable && min < max) {
    if (meta.hasItalic) {
      return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@0,${min}..${max};1,${min}..${max}&display=swap`;
    }
    return `https://fonts.googleapis.com/css2?family=${name}:wght@${min}..${max}&display=swap`;
  }
  const sorted = [...new Set(meta.weights)].sort((a, b) => a - b);
  if (meta.hasItalic) {
    const parts = sorted.flatMap((w) => [`0,${w}`, `1,${w}`]).join(';');
    return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@${parts}&display=swap`;
  }
  const parts = sorted.join(';');
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${parts}&display=swap`;
}

export function loadFont(font: string): Promise<void> {
  if (loadedFonts.has(font)) return Promise.resolve();

  const existing = loadingPromises.get(font);
  if (existing) return existing;

  const custom = getCustomFontFamily(font);
  if (custom) {
    const promise = loadCustomFontFamily(custom).then(() => {
      loadedFonts.add(font);
      loadingPromises.delete(font);
    });
    loadingPromises.set(font, promise);
    return promise;
  }

  const promise = (async () => {
    const meta = await fetchFontMetadata(font);
    if (meta?.fontsource) {
      // Not on Google Fonts (#689): its faces are declared from
      // Fontsource's files, and loaded below like a style sheet's.
      declareFaces(meta.fontsource);
    } else {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = buildFontUrl(font, meta);
      const linkLoaded = new Promise<void>((resolve) => {
        link.onload = () => resolve();
        link.onerror = () => resolve();
      });
      document.head.appendChild(link);

      // The stylesheet must be parsed before document.fonts sees the faces;
      // waiting on document.fonts.ready alone can resolve prematurely.
      await Promise.race([
        linkLoaded,
        new Promise<void>((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
      ]);
    }

    // Explicitly request each variant so document.fonts tracks them as pending
    const weights = meta?.weights?.length ? meta.weights : [400, 700];
    const quoted = `"${font}"`;
    const specs = meta?.hasItalic
      ? weights.flatMap((w) => [`${w} 16px ${quoted}`, `italic ${w} 16px ${quoted}`])
      : weights.map((w) => `${w} 16px ${quoted}`);
    await Promise.race([
      Promise.all(specs.map((spec) => document.fonts.load(spec).catch(() => []))),
      new Promise<void>((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
    ]);

    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
    ]);

    loadedFonts.add(font);
    loadingPromises.delete(font);
  })();

  loadingPromises.set(font, promise);
  return promise;
}

export function preloadConfigFonts(config: PostextConfig, markdown?: FontContentText): Promise<void> {
  const promises = getConfigFontFamilies(config, markdown).map((family) => loadFont(family));
  return Promise.all(promises).then(() => {});
}

/**
 * Font-spec strings (for `document.fonts.check/load`) covering every
 * family × weight × style combination a build might hit. Size is fixed at
 * 16px because the check is per-face — the actual render size doesn't
 * affect whether a matching face is loaded.
 */
export function getConfigFontSpecs(config: PostextConfig, markdown?: FontContentText): string[] {
  const specs = new Set<string>();
  const push = (family: string) => {
    const q = `"${family}"`;
    specs.add(`400 16px ${q}`);
    specs.add(`700 16px ${q}`);
    specs.add(`italic 400 16px ${q}`);
    specs.add(`italic 700 16px ${q}`);
  };
  for (const f of getConfigFontFamilies(config, markdown)) push(f);
  return [...specs];
}

/**
 * The characters a face must have loaded before a build measures with it,
 * for `document.fonts.check/load`. A Google family comes as one file per
 * script (`latin`, `arabic`… each with its `unicode-range`), and the
 * browser fetches a file only when text needs it: checked with a space
 * alone, an Arabic book would pass with only the Latin file in, measure its
 * first build with a fallback face, and lay out again when the Arabic file
 * lands. A document in a language written in the Arabic script asks for an
 * Arabic letter and digit too. (Chinese faces come in about a hundred
 * slices, fetched as the text needs them; the `loadingdone` rebuild covers
 * those.)
 */
export function configFontSampleText(config: PostextConfig): string {
  const tag = config.locale ?? config.bodyText?.hyphenation?.locale;
  return tag !== undefined && localeScript(tag) === 'Arab' ? ' \u0628\u0661' : ' ';
}

/** The specs of `getConfigFontSpecs` not loaded yet for the document's
 *  text (`configFontSampleText`). */
export function missingConfigFontSpecs(config: PostextConfig, markdown?: FontContentText): string[] {
  if (typeof document === 'undefined' || !document.fonts) return [];
  const text = configFontSampleText(config);
  return getConfigFontSpecs(config, markdown).filter((s) => !document.fonts.check(s, text));
}

/** `document.fonts.load` for each spec, given up after the timeout; a
 *  face that fails to load counts as tried. */
async function loadFontSpecs(specs: readonly string[], text: string): Promise<void> {
  if (specs.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(specs.map((s) => document.fonts.load(s, text).catch(() => []))),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

/**
 * Ensure every face the given config will render is actually available to
 * `CanvasRenderingContext2D.measureText`. Resolves once all faces pass
 * `document.fonts.check`, or after the timeout. Safe to call repeatedly.
 */
export function ensureConfigFontsLoaded(config: PostextConfig, markdown?: FontContentText): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  // The stand-ins first (#688): once declared they are faces the check
  // below names and the loads that follow bring in.
  if (!standInsSettled(config, markdown)) {
    // Given up after the timeout, like a face that does not load: the
    // previews declare what is left when they look again.
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      declareStandIns(config, markdown).catch(() => false),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
      }),
    ]).then(() => {
      if (timer !== undefined) clearTimeout(timer);
      return loadMissingConfigFonts(config, markdown);
    });
  }
  return loadMissingConfigFonts(config, markdown);
}

function loadMissingConfigFonts(config: PostextConfig, markdown?: FontContentText): Promise<void> {
  const missing = missingConfigFontSpecs(config, markdown);
  if (missing.length === 0) return Promise.resolve();
  // The engine's preparation (#629): every face the configuration asks
  // for, loaded for the characters the text sets (so the Arabic, Greek or
  // CJK slices of a Google family come in before the first build), the
  // measurements of the families that changed dropped. A family not
  // declared yet gets its style sheet (`loadFont`) and is loaded from it.
  return prepareFonts(markdown, config, {
    timeoutMs: FONT_LOAD_TIMEOUT_MS,
    resolve: async (family) => {
      await loadFont(family);
      return null;
    },
  }).then(() => {
    // The preparation loads the faces the configuration sets; the callers
    // hold their build for `missingConfigFontSpecs`, which asks more of
    // each family (a heading face never set in italic is still checked in
    // italic). `loadFont` loads all of them, once per family, and Chrome
    // makes the faces of every style sheet anew, unloaded, when another
    // font style sheet lands: a family loaded before the last sheet of the
    // book landed is back to unloaded, and nothing asked for the faces
    // only the check names again, so the previews waited for them without
    // end (#659). What the check still misses is loaded here.
    return loadFontSpecs(missingConfigFontSpecs(config, markdown), configFontSampleText(config));
  });
}

/**
 * A preview's hold on its build until the faces it paints with are loaded
 * (#659). `pending` lists what to wait for, `wait` waits for it, and the
 * preview looks again when the wait ends. A face is waited for once: what
 * a wait ends without (a file that fails or outlasts the timeout) is given
 * up on, and the build goes ahead with the fallback the engine reports; a
 * face that lands later lays the pages out again through `watchFonts`.
 * Looking again can therefore not hold the build twice for the same
 * missing face, whatever the font set answers.
 */
export interface FontGate {
  /** The specs of `missingConfigFontSpecs` to wait for before building:
   *  empty, build. */
  pending(config: PostextConfig, markdown?: FontContentText): string[];
  /** Load them (`ensureConfigFontsLoaded`); the ones still missing when it
   *  settles are not waited for again while they stay missing. */
  wait(config: PostextConfig, markdown?: FontContentText): Promise<void>;
}

/** One per preview. */
export function createFontGate(): FontGate {
  // Sample text and spec of the faces a wait ended without.
  const givenUp = new Set<string>();
  const keyOf = (config: PostextConfig): ((spec: string) => string) => {
    const text = configFontSampleText(config);
    return (spec) => `${text}\n${spec}`;
  };
  return {
    pending(config, markdown) {
      const missing = missingConfigFontSpecs(config, markdown);
      if (givenUp.size === 0) return missing;
      const key = keyOf(config);
      // A face that loaded after all is waited for again if it goes
      // missing once more (its style sheet's faces made anew).
      const still = new Set(missing.map(key));
      for (const k of givenUp) if (!still.has(k)) givenUp.delete(k);
      return missing.filter((s) => !givenUp.has(key(s)));
    },
    async wait(config, markdown) {
      // A preparation that throws ends the wait as one that loaded nothing:
      // the preview is told either way, or it would never look again.
      await ensureConfigFontsLoaded(config, markdown).catch((err: unknown) => {
        console.warn('[postext-sandbox] font preparation failed', err);
      });
      const key = keyOf(config);
      for (const s of missingConfigFontSpecs(config, markdown)) givenUp.add(key(s));
    },
  };
}

// ---------------------------------------------------------------------------
// Worker font payload collection
// ---------------------------------------------------------------------------

const FACE_RE = /@font-face\s*\{([^}]+)\}/g;
const DECL_RES = {
  family: /font-family:\s*['"]?([^;'"]+)['"]?\s*;/i,
  style: /font-style:\s*([^;]+);/i,
  weight: /font-weight:\s*([^;]+);/i,
  unicodeRange: /unicode-range:\s*([^;]+);/i,
  src: /src:\s*url\(([^)]+)\)\s*format\(['"]?woff2['"]?\)/i,
};

function parseFontFaceCss(css: string): FamilyFace[] {
  const out: FamilyFace[] = [];
  for (const match of css.matchAll(FACE_RE)) {
    const body = match[1]!;
    const srcMatch = DECL_RES.src.exec(body);
    const familyMatch = DECL_RES.family.exec(body);
    if (!srcMatch || !familyMatch) continue;
    const weight = DECL_RES.weight.exec(body)?.[1]?.trim() ?? '400';
    const style = DECL_RES.style.exec(body)?.[1]?.trim() ?? 'normal';
    const unicodeRange = DECL_RES.unicodeRange.exec(body)?.[1]?.trim();
    const url = srcMatch[1]!.trim().replace(/^['"]|['"]$/g, '');
    out.push({
      family: familyMatch[1]!.trim(),
      weight,
      style,
      unicodeRange,
      url,
    });
  }
  return out;
}

const familyFacesCache = new Map<string, Promise<FamilyFace[]>>();
/** When a family's faces could not be had, by family. */
const familyFacesFailedAt = new Map<string, number>();
/** How long a family that gave no faces is left alone: every build asks
 *  for its families, and a family that is nowhere would otherwise cost a
 *  failed request per keystroke. */
const FAMILY_FACES_RETRY_MS = 30_000;

/**
 * The faces a family that is not a custom one is served as, in the order
 * its style sheet declares them: Google's, or Fontsource's files for a
 * family Google Fonts does not have. Empty when they cannot be had (the
 * request fails, the family is nowhere), and asked again after a while.
 * Never rejects: a failed style sheet is one family without faces, not a
 * build without fonts (#689).
 */
export function fetchFamilyFaces(family: string): Promise<FamilyFace[]> {
  const cached = familyFacesCache.get(family);
  const failedAt = familyFacesFailedAt.get(family);
  if (cached && (failedAt === undefined || Date.now() - failedAt < FAMILY_FACES_RETRY_MS)) return cached;
  familyFacesFailedAt.delete(family);
  const promise = (async (): Promise<FamilyFace[]> => {
    try {
      const meta = await fetchFontMetadata(family);
      if (meta?.fontsource) return meta.fontsource;
      // Google Fonts returns woff2 only if the UA is browser-like. Normal
      // fetch from the main thread inherits the browser UA, so this is
      // fine. From a worker it would return ttf; that's why we do this on
      // the main thread. A family Google does not have answers 400 with no
      // CORS headers, which rejects.
      const res = await fetch(buildFontUrl(family, meta), { credentials: 'omit' });
      if (!res.ok) return [];
      return parseFontFaceCss(await res.text());
    } catch {
      return [];
    }
  })();
  familyFacesCache.set(family, promise);
  void promise.then((faces) => {
    if (faces.length === 0 && familyFacesCache.get(family) === promise) familyFacesFailedAt.set(family, Date.now());
  });
  return promise;
}

const facePayloadCache = new Map<string, Promise<FontPayload[]>>();

function faceCacheKey(p: { family: string; weight: string; style: string; unicodeRange?: string }): string {
  return `${p.family}|${p.weight}|${p.style}|${p.unicodeRange ?? ''}`;
}

/** The files of `faces` as worker payloads, in the order of `faces` (a
 *  family's slices overlap at a few code points, where the order they are
 *  added in decides, #629). A file that fails is left out. */
async function fetchFacePayloads(faces: readonly FamilyFace[]): Promise<FontPayload[]> {
  const payloads = await Promise.all(faces.map(async (face): Promise<FontPayload | null> => {
    try {
      const r = await fetch(face.url, { credentials: 'omit' });
      if (!r.ok) return null;
      return {
        family: face.family,
        weight: face.weight,
        style: face.style,
        unicodeRange: face.unicodeRange,
        buffer: await r.arrayBuffer(),
      };
    } catch {
      return null; // ignore individual face failures
    }
  }));
  return payloads.filter((p): p is FontPayload => p !== null);
}

async function fetchFamilyPayloads(family: string): Promise<FontPayload[]> {
  const custom = getCustomFontFamily(family);
  if (custom) return fetchCustomFamilyPayloads(custom);
  return fetchFacePayloads(await fetchFamilyFaces(family));
}

/**
 * Collect `FontPayload` objects (woff2 ArrayBuffers + descriptors) for every
 * family a config will render, so they can be shipped to a layout worker.
 *
 * The buffers are freshly fetched each call (so the caller can transfer them
 * into the worker without detaching a shared copy). The CSS lookup and face
 * *list* is cached.
 */
export async function collectFontPayloadsForConfig(
  config: PostextConfig,
  markdown?: FontContentText,
): Promise<FontPayload[]> {
  return collectFontPayloadsForFamilies(getConfigFontFamilies(config, markdown));
}

/**
 * Variant of `collectFontPayloadsForConfig` that fetches only the requested
 * families, so the caller can ship a delta (newly-seen families) to the
 * worker instead of the whole configured set on every update.
 */
export async function collectFontPayloadsForFamilies(
  families: string[],
): Promise<FontPayload[]> {
  if (families.length === 0) return [];
  const byFamily = await Promise.all(families.map(async (family) => {
    const cached = facePayloadCache.get(family);
    if (cached) {
      // The cached promise resolves with FontPayload[] whose buffers may
      // already have been transferred. Re-fetch to produce fresh buffers,
      // but dedupe concurrent re-fetches.
      return cached.then(async (payloads) => {
        // If any buffer has been neutered (byteLength === 0), re-fetch.
        if (payloads.some((p) => p.buffer.byteLength === 0)) {
          const fresh = fetchFamilyPayloads(family).catch((): FontPayload[] => []);
          facePayloadCache.set(family, fresh);
          return fresh;
        }
        // Clone buffers so transferring to the worker doesn't neuter the cache.
        return payloads.map((p) => ({ ...p, buffer: p.buffer.slice(0) }));
      });
    }
    // A family that cannot be fetched gives no payload; the others of
    // the build are registered all the same (#689).
    const promise = fetchFamilyPayloads(family).catch((): FontPayload[] => []).then((payloads) => {
      // An empty face list means the family could not be fetched (or was
      // looked up before its custom definition landed): don't cache it, so
      // the next build retries instead of measuring with a fallback forever.
      if (payloads.length === 0 && facePayloadCache.get(family) === promise) facePayloadCache.delete(family);
      return payloads;
    });
    facePayloadCache.set(family, promise);
    return promise;
  }));
  // Deduplicate across families (cheap — same family appears at most once).
  const seen = new Set<string>();
  const flat: FontPayload[] = [];
  for (const group of byFamily) {
    for (const p of group) {
      const key = faceCacheKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push(p);
    }
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Stand-in faces: a bold or an italic the family has no file for
// ---------------------------------------------------------------------------
//
// A browser asked for the 700 of a family with one 400 file draws the 400
// heavier, and slants an upright for an italic the family lacks: letters no
// file holds, while the PDF embeds the file there is (the provider snaps to
// the nearest weight, and to the upright). The comic faces are the common
// case: a shout and a sound effect are lettered in bold, an inner voice in
// italics, in families that ship one weight (Bangers, Patrick Hand, Zen
// Antique, Dela Gothic One). The Sandbox declares the file the browser
// would have drawn from as the face asked, so the previews set the letters
// the PDF embeds, as the Cookbook kit's comics block and the command line
// do (#688). A weight another real face answers as it is (a 600 set from
// the 700) is left to the browser, and reported by the engine (#650).

/** The weights the heaviest cut of a family with no bold stands in for:
 *  the ones a browser makes bold from a face of 500 or less. */
const BOLD_STAND_IN = '600 900';

function isSlanted(style: string): boolean {
  return /italic|oblique/i.test(style);
}

/** A weight descriptor (`'400'`, `'bold'`, `'100 900'`) as a range. */
function weightSpan(weight: string): [number, number] {
  const parts = weight.trim().split(/\s+/).map((w) => (w === 'bold' ? 700 : w === 'normal' ? 400 : Number(w)));
  const lo = Number.isFinite(parts[0]) ? parts[0]! : 400;
  const hi = Number.isFinite(parts[1]) ? parts[1]! : lo;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** The weight descriptor CSS font matching settles on for `target` among
 *  `weights` (CSS Fonts 4, §5.2): from 400 to 500 the weights up to 500
 *  first, then lighter, then heavier; below 400 lighter first; above 500
 *  heavier first. */
function matchWeight(weights: readonly string[], target: number): string | undefined {
  const spans = [...new Set(weights)].map((weight) => ({ weight, span: weightSpan(weight) }));
  const exact = spans.find(({ span }) => target >= span[0] && target <= span[1]);
  if (exact) return exact.weight;
  const lighter = spans.filter(({ span }) => span[1] < target).sort((a, b) => b.span[1] - a.span[1]);
  const heavier = spans.filter(({ span }) => span[0] > target).sort((a, b) => a.span[0] - b.span[0]);
  if (target >= 400 && target <= 500) {
    return (heavier.find(({ span }) => span[0] <= 500) ?? lighter[0] ?? heavier[0])?.weight;
  }
  return (target < 400 ? lighter[0] ?? heavier[0] : heavier[0] ?? lighter[0])?.weight;
}

/**
 * The faces to declare beside a family's own (`own`: every file of the
 * family, with its weight, slant and range), each the copy of one of them
 * under another weight or slant:
 *
 * - in each slant, the heaviest cut for 600 to 900 when that cut is 500 or
 *   lighter (the weights a browser would make bold from it);
 * - for a family with no italic, the upright cut each weight of `italics`
 *   (the italics a build asks of the family) is matched to, as an italic.
 *
 * A family with a bold and an italic of its own gets none.
 */
export function standInFaces<T extends { weight: string; style: string }>(own: readonly T[], italics: readonly number[] = []): T[] {
  const upright = own.filter((f) => !isSlanted(f.style));
  const slanted = own.filter((f) => isSlanted(f.style));
  const bold = (pool: readonly T[]): T[] => {
    if (pool.length === 0) return [];
    const top = Math.max(...pool.map((f) => weightSpan(f.weight)[1]));
    if (top > 500) return [];
    return pool.filter((f) => weightSpan(f.weight)[1] === top).map((f) => ({ ...f, weight: BOLD_STAND_IN }));
  };
  const uprightBold = bold(upright);
  const out = [...uprightBold, ...bold(slanted)];
  if (slanted.length === 0 && italics.length > 0) {
    const pool = [...upright, ...uprightBold];
    const weights = pool.map((f) => f.weight);
    const cuts = new Set<string>();
    for (const weight of italics) {
      const cut = matchWeight(weights, weight);
      if (cut !== undefined) cuts.add(cut);
    }
    for (const f of pool) if (cuts.has(f.weight)) out.push({ ...f, style: 'italic' });
  }
  return out;
}

/**
 * The italics a build may ask of each family, by weight: the ones the
 * configuration sets (the engine's `configFontFaces`: the body's emphasis,
 * a style set in italics, code), and the regular and bold italics of the
 * faces comic pages are lettered in (an inner voice is set in italics,
 * emphasis in bold italics). A bold needs no asking: its stand-in follows
 * from the family's faces alone.
 */
export function askedItalics(config: PostextConfig, markdown?: FontContentText): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const add = (family: string, weight: number): void => {
    const list = out.get(family);
    if (!list) out.set(family, [weight]);
    else if (!list.includes(weight)) list.push(weight);
  };
  for (const f of configFontFaces(config, markdown)) if (f.style === 'italic') add(f.family, f.weight);
  for (const family of comicFontFamilies(config, markdown)) {
    for (const v of STANDARD_FONT_VARIANTS) if (v.style === 'italic') add(family, v.weight);
  }
  return out;
}

/** The stand-in faces of a family that is not a custom one, for the
 *  italics asked of it; none when its faces cannot be had. A custom
 *  family keeps what its author uploaded (and its own check, *Missing
 *  font variant*). */
async function familyStandIns(family: string, italics: readonly number[] | undefined): Promise<FamilyFace[]> {
  if (getCustomFontFamily(family)) return [];
  return standInFaces(await fetchFamilyFaces(family), italics);
}

/** `FontFace`s the Sandbox declared itself (the faces of a Fontsource
 *  family, the stand-ins), by face key. */
const declaredFaces = new Set<string>();

/** Declare `faces` in `document.fonts`, each once; they load when a text
 *  or a `load` asks for them. Returns the ones added. */
function declareFaces(faces: readonly FamilyFace[]): FamilyFace[] {
  const FontFaceCtor = (globalThis as { FontFace?: typeof FontFace }).FontFace;
  if (typeof document === 'undefined' || !document.fonts || !FontFaceCtor) return [];
  const added: FamilyFace[] = [];
  for (const face of faces) {
    const key = faceCacheKey(face);
    if (declaredFaces.has(key)) continue;
    declaredFaces.add(key);
    try {
      document.fonts.add(new FontFaceCtor(face.family, `url(${JSON.stringify(face.url)}) format('woff2')`, {
        weight: face.weight,
        style: face.style,
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      }));
      added.push(face);
    } catch (err) {
      console.warn('[postext-sandbox] failed to declare font face', face.family, face.weight, face.style, err);
    }
  }
  return added;
}

/** Family and the italics asked of it: what a family's stand-ins were
 *  declared for. */
function standInKey(family: string, italics: readonly number[] | undefined): string {
  return `${family}|${[...(italics ?? [])].sort((a, b) => a - b).join(',')}`;
}

/** The keys whose stand-ins are declared on the page (or were tried). */
const settledStandIns = new Set<string>();
const standInDeclarations = new Map<string, Promise<boolean>>();

function standInKeys(config: PostextConfig, markdown?: FontContentText): { family: string; italics: number[] | undefined; key: string }[] {
  const italics = askedItalics(config, markdown);
  return getConfigFontFamilies(config, markdown)
    .filter((family) => !getCustomFontFamily(family))
    .map((family) => ({ family, italics: italics.get(family), key: standInKey(family, italics.get(family)) }));
}

/** Whether the stand-ins of every family of a config are declared on the
 *  page: nothing left for `declareStandIns` to do. */
export function standInsSettled(config: PostextConfig, markdown?: FontContentText): boolean {
  if (typeof document === 'undefined' || !document.fonts || typeof (globalThis as { FontFace?: unknown }).FontFace === 'undefined') return true;
  return standInKeys(config, markdown).every(({ key }) => settledStandIns.has(key));
}

/**
 * Declare on the page the stand-in faces of every family a config sets
 * text in, and load them for the characters of the document, so the canvas
 * paints a bold or an italic the family lacks with the family's own
 * letters. Once per family and set of italics asked. Resolves to whether
 * any face was added (the previews paint again then).
 */
export async function declareStandIns(config: PostextConfig, markdown?: FontContentText): Promise<boolean> {
  if (standInsSettled(config, markdown)) return false;
  const sample = fontSampleText(markdown, config);
  const results = await Promise.all(standInKeys(config, markdown).map(({ family, italics, key }) => {
    if (settledStandIns.has(key)) return false;
    let declaration = standInDeclarations.get(key);
    if (!declaration) {
      declaration = (async (): Promise<boolean> => {
        const added = declareFaces(await familyStandIns(family, italics).catch((): FamilyFace[] => []));
        // One load per weight and slant brings in the files that hold
        // the document's characters.
        const specs = [...new Set(added.map((f) => `${isSlanted(f.style) ? 'italic ' : ''}${weightSpan(f.weight)[0]} 16px "${family}"`))];
        await loadFontSpecs(specs, sample);
        return added.length > 0;
      })().finally(() => {
        settledStandIns.add(key);
        standInDeclarations.delete(key);
      });
      standInDeclarations.set(key, declaration);
    }
    return declaration;
  }));
  return results.some(Boolean);
}

/** A unicode-range holds one of `codePoints`. */
function rangeHolds(unicodeRange: string | undefined, codePoints: ReadonlySet<number>): boolean {
  if (!unicodeRange) return true;
  const ranges = parseUnicodeRange(unicodeRange);
  for (const cp of codePoints) for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  return false;
}

/**
 * The stand-in faces of a build as worker payloads: for every family the
 * config sets text in, the files of its stand-ins that hold a character
 * of the document (a Japanese display face comes as some 120 slices, and a
 * page uses a handful), leaving out the faces of `sent` (face keys, as
 * {@link fontPayloadKey} gives them). The worker registers them after the
 * family's own faces.
 */
export async function collectStandInPayloads(
  config: PostextConfig,
  content: PostextContent | FontContentText,
  sent?: ReadonlySet<string>,
): Promise<FontPayload[]> {
  const markdown = content !== undefined && typeof content === 'object' && !Array.isArray(content) ? (content as PostextContent).markdown : content as FontContentText;
  const italics = askedItalics(config, markdown);
  let codePoints: Set<number> | undefined;
  const wanted: FamilyFace[] = [];
  for (const family of getConfigFontFamilies(config, markdown)) {
    const faces = (await familyStandIns(family, italics.get(family)).catch((): FamilyFace[] => []))
      .filter((face) => !sent?.has(faceCacheKey(face)));
    if (faces.length === 0) continue;
    if (!codePoints) {
      codePoints = new Set<number>();
      for (const ch of fontSampleText(content, config)) codePoints.add(ch.codePointAt(0)!);
    }
    for (const face of faces) if (rangeHolds(face.unicodeRange, codePoints)) wanted.push(face);
  }
  return fetchFacePayloads(wanted);
}

/** The key of a payload's face: family, weight, style and range. */
export function fontPayloadKey(payload: Pick<FontPayload, 'family' | 'weight' | 'style' | 'unicodeRange'>): string {
  return faceCacheKey(payload);
}

// ---------------------------------------------------------------------------
// Custom (user-uploaded) font registry
// ---------------------------------------------------------------------------

const customFontRegistry = new Map<string, CustomFontFamily>();
/** Names of families registered as a custom font since the book on screen
 *  was opened. Seeded by every `setCustomFonts` call so
 *  `isRemovedCustomFontFamily` can tell "deleted a custom family I had
 *  declared" from "never seen this name". Emptied when another book comes
 *  in (`newBook`): a family the last book bundled may be a Google Font the
 *  next one asks for by name (紅樓夢 bundles Noto Serif SC; the guide's
 *  Chinese edition loads it from Google Fonts). */
const everSeenCustomFamilies = new Set<string>();
/** Listeners notified when the set of known custom families changes. The
 *  payload is the list of family names whose definition changed, was added,
 *  or was removed. Consumers (the worker bundle) use it to drop stale
 *  registrations so the next build reloads the fresh bytes. */
const customFontListeners = new Set<(changedFamilies: string[]) => void>();
/** Document-level FontFace instances we registered, keyed by family — so
 *  `setCustomFonts` can remove them when a family is updated or deleted. */
const registeredCustomFaces = new Map<string, FontFace[]>();

function variantKey(v: CustomFontVariant): string {
  return `${v.weight}|${v.style}|${v.fileId}`;
}

function familySignature(f: CustomFontFamily): string {
  const vs = [...f.variants].map(variantKey).sort();
  return `${f.name}::${vs.join(';')}`;
}

/** Replace the sandbox's known custom fonts. Invalidates every cached
 *  loader state for families that changed, added, or were removed.
 *  `newBook`: the list is another book's (a preset, a project, a draft
 *  opened), not an edit of this one's, so the families left out were not
 *  deleted by the author. */
export function setCustomFonts(list: CustomFontFamily[] | undefined, options: { newBook?: boolean } = {}): void {
  const next = new Map<string, CustomFontFamily>();
  for (const f of list ?? []) next.set(f.name, f);

  const changed: string[] = [];
  for (const [name, fam] of next) {
    const prev = customFontRegistry.get(name);
    if (!prev || familySignature(prev) !== familySignature(fam)) changed.push(name);
  }
  for (const name of customFontRegistry.keys()) {
    if (!next.has(name)) changed.push(name);
  }

  customFontRegistry.clear();
  if (options.newBook) everSeenCustomFamilies.clear();
  for (const [name, fam] of next) {
    customFontRegistry.set(name, fam);
    everSeenCustomFamilies.add(name);
  }

  for (const family of changed) {
    loadedFonts.delete(family);
    loadingPromises.delete(family);
    facePayloadCache.delete(family);
    familyFacesCache.delete(family);
    familyFacesFailedAt.delete(family);
    const faces = registeredCustomFaces.get(family);
    if (faces && typeof document !== 'undefined' && document.fonts) {
      for (const ff of faces) {
        try { document.fonts.delete(ff); } catch { /* ignore */ }
      }
    }
    registeredCustomFaces.delete(family);
  }

  if (changed.length > 0) {
    for (const cb of customFontListeners) cb(changed);
  }

  // Kick off FontFace registration on document.fonts for every currently
  // declared custom family. Without this, the HTML viewport (which only
  // applies the family via CSS) falls back to a system font because no
  // FontFace matches the name.
  if (typeof document !== 'undefined' && document.fonts) {
    for (const name of customFontRegistry.keys()) {
      loadFont(name).catch(() => { /* individual variant failures are logged below */ });
    }
  }
}

/** Signature of a custom-font list — of the registry's current contents
 *  when `list` is omitted. Callers compare the two to detect a registry that
 *  drifted from the config it should mirror, including a dev-server hot
 *  reload, which re-evaluates this module (emptying the registry) while
 *  React keeps the config it was seeded from. */
export function customFontsSignature(list?: CustomFontFamily[]): string {
  const source = list ?? Array.from(customFontRegistry.values());
  return source.map(familySignature).sort().join('|');
}

export function getCustomFontFamily(name: string): CustomFontFamily | undefined {
  return customFontRegistry.get(name);
}

export function listCustomFontFamilies(): CustomFontFamily[] {
  return Array.from(customFontRegistry.values());
}

export function isCustomFontFamily(name: string): boolean {
  return customFontRegistry.has(name);
}

/** True when `name` was registered as a custom family since the book on
 *  screen was opened but is no longer present — i.e. the user has deleted
 *  it while some `fontFamily` field still references it. */
export function isRemovedCustomFontFamily(name: string): boolean {
  return everSeenCustomFamilies.has(name) && !customFontRegistry.has(name);
}

/** Subscribe to custom-font registry changes. The callback receives the
 *  family names whose definition changed (added, removed, or variant set
 *  altered). Returns an unsubscribe function. */
export function onCustomFontsChanged(cb: (families: string[]) => void): () => void {
  customFontListeners.add(cb);
  return () => { customFontListeners.delete(cb); };
}

async function loadVariantBuffer(variant: CustomFontVariant): Promise<ArrayBuffer | null> {
  const file = await getFontFile(variant.fileId).catch(() => null);
  return file ? file.buffer : null;
}

async function loadCustomFontFamily(family: CustomFontFamily): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const existing = registeredCustomFaces.get(family.name) ?? [];
  // Skip variants that already have a matching FontFace loaded.
  const haveKeys = new Set(
    existing.map((ff) => `${ff.weight}|${ff.style}`),
  );
  const faces: FontFace[] = [...existing];
  await Promise.all(
    family.variants.map(async (variant) => {
      const key = `${variant.weight}|${variant.style}`;
      if (haveKeys.has(key)) return;
      const buffer = await loadVariantBuffer(variant);
      if (!buffer) return;
      try {
        const ff = new FontFace(family.name, buffer, {
          weight: String(variant.weight),
          style: variant.style,
        });
        await ff.load();
        document.fonts.add(ff);
        faces.push(ff);
      } catch (err) {
        console.warn('[postext-sandbox] failed to load custom font variant', family.name, variant, err);
      }
    }),
  );
  registeredCustomFaces.set(family.name, faces);
}

async function fetchCustomFamilyPayloads(family: CustomFontFamily): Promise<FontPayload[]> {
  const payloads: FontPayload[] = [];
  await Promise.all(
    family.variants.map(async (variant) => {
      const buffer = await loadVariantBuffer(variant);
      if (!buffer) return;
      payloads.push({
        family: family.name,
        weight: String(variant.weight),
        style: variant.style,
        buffer: buffer.slice(0),
      });
    }),
  );
  return payloads;
}

/** Resolve which of the standard specs (400/700 × normal/italic) are not
 *  covered by this family's variants. Returns an empty array if every spec
 *  has a matching variant (exact weight + style). */
/** Returns true only when we've conclusively tried and failed to fetch
 *  metadata for `family` from Fontsource (so we know it's not a Google
 *  Font). Returns false while the lookup is pending or not yet started. */
export function isKnownUnavailableGoogleFont(family: string): boolean {
  return metadataCache.has(family) && metadataCache.get(family) === null;
}

export function missingStandardVariants(
  family: CustomFontFamily,
): Array<{ weight: number; style: 'normal' | 'italic' }> {
  return missingVariants(family, STANDARD_FONT_VARIANTS);
}

function missingVariants(family: CustomFontFamily, wanted: readonly FontVariantUse[]): FontVariantUse[] {
  const have = new Set(family.variants.map((v) => `${v.weight}|${v.style}`));
  const seen = new Set<string>();
  const out: FontVariantUse[] = [];
  for (const w of wanted) {
    const key = `${w.weight}|${w.style}`;
    if (have.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** The variants `config` (and the text `doc` describes) asks of a
 *  declared custom family that it has no file for — bold or italic set in
 *  a family that only carries a regular face, a weight no face covers. */
export function missingUsedVariants(family: CustomFontFamily, config: PostextConfig, doc?: FontUsageDocument): FontVariantUse[] {
  const wanted = collectFontUsage(config, doc).get(family.name) ?? [];
  return missingVariants(family, wanted);
}

// ---------------------------------------------------------------------------
// Vertical forms for vertical text (canvas)
// ---------------------------------------------------------------------------

/** Whether a config sets any text vertically (`layout.writingMode`, or a
 *  heading style's own layout). */
export function configIsVertical(config: PostextConfig, markdown?: FontContentText): boolean {
  if (config.layout?.writingMode === 'vertical-rl') return true;
  if ((config.headingStyles ?? []).some((s) => s.layout?.writingMode === 'vertical-rl')) return true;
  // Comic balloons of Japanese and Traditional Chinese are lettered in
  // columns (`comics.lettering.writingMode: 'auto'`).
  if (!config.comics && !markdownHasComics(markdown)) return false;
  const mode = config.comics?.lettering?.writingMode;
  if (mode === 'vertical') return true;
  if (mode === 'horizontal') return false;
  const tag = config.locale ?? config.bodyText?.hyphenation?.locale;
  return isJapaneseLanguage(tag) || chineseScriptOf(tag) === 'Hant';
}

/** The twin load of each family, keyed by where its faces come from
 *  ({@link twinSourceKey}): a family whose sources change is loaded again. */
const verticalTwins = new Map<string, { key: string; promise: Promise<boolean> }>();
/** Per family, the source key whose twin load has settled. */
const verticalTwinsDone = new Map<string, string>();

/** Where a family's faces come from: the files of a custom family (a file
 *  uploaded again under the same name is another source), else Google. */
function twinSourceKey(family: string): string {
  const custom = getCustomFontFamily(family);
  return custom ? `custom:${familySignature(custom)}` : 'google';
}

async function verticalFacesOf(family: string, italics?: readonly number[]): Promise<VerticalAlternatesFace[]> {
  const custom = getCustomFontFamily(family);
  if (custom) {
    const faces: VerticalAlternatesFace[] = [];
    await Promise.all(custom.variants.map(async (variant) => {
      const buffer = await loadVariantBuffer(variant);
      if (buffer) faces.push({ source: buffer, weight: String(variant.weight), style: variant.style });
    }));
    return faces;
  }
  // The stand-ins too (#688): a shout lettered in columns is set in the
  // bold the family's own file answers for.
  const own = await fetchFamilyFaces(family);
  return [...own, ...standInFaces(own, italics)].map((face) => ({
    source: face.url,
    weight: face.weight,
    style: face.style,
    ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
  }));
}

/**
 * For a config that sets text vertically: load, for every family it uses, a
 * twin with the font's vertical forms (OpenType `vert`) that the canvas
 * paints brackets and punctuation with (see `loadVerticalAlternates` in
 * postext). Once per family; resolves when every family is settled, to
 * whether any family has its twin (the preview repaints then).
 */
export async function loadVerticalTwins(config: PostextConfig, markdown?: FontContentText): Promise<boolean> {
  if (typeof document === 'undefined' || !configIsVertical(config, markdown)) return false;
  const italics = askedItalics(config, markdown);
  const results = await Promise.all(getConfigFontFamilies(config, markdown).map((family) => {
    const key = twinSourceKey(family);
    const entry = verticalTwins.get(family);
    if (entry && entry.key === key) return entry.promise;
    // New sources for a family (a custom font uploaded again, or a book
    // whose font of that name is another file): the old twin's faces go,
    // and the twin is loaded from the new ones.
    if (entry) {
      unregisterVerticalAlternates(family);
      verticalTwinsDone.delete(family);
    }
    const promise = verticalFacesOf(family, italics.get(family))
      .then((faces) => loadVerticalAlternates(family, faces))
      .catch(() => false)
      .then((ok) => {
        if (verticalTwins.get(family)?.key === key) verticalTwinsDone.set(family, key);
        return ok;
      });
    verticalTwins.set(family, { key, promise });
    return promise;
  }));
  return results.some(Boolean);
}

/** Whether every family of a vertical config has had its twin tried, from
 *  the family's current sources. */
export function verticalTwinsSettled(config: PostextConfig, markdown?: FontContentText): boolean {
  if (!configIsVertical(config, markdown)) return true;
  return getConfigFontFamilies(config, markdown).every((f) => verticalTwinsDone.get(f) === twinSourceKey(f));
}
