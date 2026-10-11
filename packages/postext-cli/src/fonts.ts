// The faces a book is measured, painted and embedded with. In the browser
// the Sandbox loads them into the page (the book's own files, or Google
// Fonts); here they are registered with Skia and handed to the PDF and
// EPUB writers. Each family the configuration names is looked up, in
// order:
//
//   1. the book's own font files (a family the book carries is never mixed
//      with faces from anywhere else);
//   2. the folders given with --font-dir;
//   3. the faces compiled into the executable (EB Garamond, Open Sans);
//   4. the download cache;
//   5. Google Fonts, or Fontsource for a family Google Fonts does not have,
//      saved to the cache (not with --offline).
//
// A weight or a slant a family does not ship is set in its nearest face, as
// it is (the regular of a one-weight display face for its bold): the files
// the Sandbox declares as stand-ins and the PDF embeds. A family found
// nowhere is measured and drawn with the fallback face under its own name,
// so the layout and the PDF agree, and a warning says so.

import { GlobalFonts } from '@napi-rs/canvas';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { collectFontUsage, configFontFamilies, documentFontFaces, STANDARD_FONT_VARIANTS, type FontVariantUse, type VDTDocument } from 'postext';
import { decompressWoff2 } from 'postext-pdf';
import { EMBEDDED_FACES, FALLBACK_FAMILY, readEmbedded } from './assets';
import type { Book } from './input';
import { ensureDir } from './io';
import type { Reporter, Warning } from './log';

export type FaceSource = 'book' | 'font-dir' | 'embedded' | 'cache' | 'download' | 'fallback';

export interface Face {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** TrueType or OpenType bytes (WOFF2 is decoded on load). */
  bytes: Uint8Array;
  format: 'ttf' | 'otf';
  source: FaceSource;
  /** The family this face really is, when it stands in for another. */
  standsInFor?: string;
}

export interface FontOptions {
  fontDirs: string[];
  offline: boolean;
  cacheDir?: string;
}

export class FontSet {
  /** `faces`: every face registered; `families`: those the book sets text
   *  in (the rest is the PDF writer's fallback); `shipped`: by family in
   *  lower case, the weights and slants the family is known to ship (the
   *  download cache's record of it), whether or not the set holds them. */
  constructor(
    readonly faces: Face[],
    readonly families: ReadonlySet<string>,
    readonly shipped: ReadonlyMap<string, readonly FontVariantUse[]> = new Map(),
  ) {}

  /** The faces of the families the book sets text in. */
  usedFaces(): Face[] {
    const used = new Set([...this.families].map((f) => f.toLowerCase()));
    return this.faces.filter((f) => used.has(f.family.toLowerCase()));
  }

  familyFaces(family: string): Face[] {
    const key = family.toLowerCase();
    return this.faces.filter((f) => f.family.toLowerCase() === key);
  }

  /** The face of `family` closest to the weight and style asked for (the
   *  browser's matching: same style first, then nearest weight). */
  pick(family: string, weight: number, style: 'normal' | 'italic'): Face | undefined {
    const faces = this.familyFaces(family);
    if (faces.length === 0) return undefined;
    const sameStyle = faces.filter((f) => f.style === style);
    const pool = sameStyle.length > 0 ? sameStyle : faces;
    return pool.reduce((best, f) => (Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best), pool[0]!);
  }

  /** `postext-pdf`'s font provider. */
  provider(): (family: string, weight: number, style: 'normal' | 'italic') => Promise<Uint8Array> {
    return async (family, weight, style) => {
      const face = this.pick(family, weight, style) ?? this.pick(FALLBACK_FAMILY, weight, style);
      if (!face) throw new Error(`No face for font family "${family}"`);
      return face.bytes;
    };
  }
}

// ---------------------------------------------------------------------------
// Registering with Skia
// ---------------------------------------------------------------------------

const registered = new Set<string>();

function register(face: Face): void {
  const key = `${face.family}|${face.weight}|${face.style}|${face.source}|${face.bytes.byteLength}`;
  if (registered.has(key)) return;
  registered.add(key);
  // Skia reads the weight and the slant from the file itself, as the
  // browser does from @font-face; the alias is the family the book names.
  GlobalFonts.register(Buffer.from(face.bytes.buffer, face.bytes.byteOffset, face.bytes.byteLength), face.family);
}

/** How much heavier than the face it is drawn from a weight must be for
 *  Skia to draw it bold itself. */
const SKIA_FAKE_BOLD = 200;

/**
 * A copy of a TrueType / OpenType file that says it is of another weight
 * and slant (`OS/2` weight class and selection bits, `head` style bits),
 * the outlines untouched. Skia reads a face's weight and slant from its
 * file, and asked for a bold or an italic a family lacks it draws the
 * nearest face heavier or slanted: registered under the weight and slant
 * asked, the copy makes it draw the family's own letters, the ones the PDF
 * embeds (#688). Undefined for a collection, a variable font or a file
 * with no `OS/2` table.
 */
export function restyleFace(bytes: Uint8Array, weight: number, style: 'normal' | 'italic'): Uint8Array | undefined {
  if (bytes.byteLength < 12) return undefined;
  const out = bytes.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const tables = new Map<string, number>();
  const count = view.getUint16(4);
  if (12 + count * 16 > out.byteLength) return undefined;
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    tables.set(String.fromCharCode(out[record]!, out[record + 1]!, out[record + 2]!, out[record + 3]!), view.getUint32(record + 8));
  }
  const os2 = tables.get('OS/2');
  if (os2 === undefined || tables.has('fvar') || os2 + 64 > out.byteLength) return undefined;
  const bold = weight >= 600;
  const italic = style === 'italic';
  view.setUint16(os2 + 4, weight);
  // fsSelection: italic (bit 0), bold (bit 5), regular (bit 6).
  let selection = view.getUint16(os2 + 62) & ~0x61;
  if (italic) selection |= 0x01;
  if (bold) selection |= 0x20;
  if (!italic && !bold) selection |= 0x40;
  view.setUint16(os2 + 62, selection);
  const head = tables.get('head');
  if (head !== undefined && head + 46 <= out.byteLength) {
    view.setUint16(head + 44, (view.getUint16(head + 44) & ~0x3) | (bold ? 1 : 0) | (italic ? 2 : 0));
  }
  return out;
}

/** Register with Skia, for each variant `family` is asked for that it
 *  would draw heavier or slanted from another face, that face under the
 *  weight and slant asked. The copies are Skia's alone: the PDF and the
 *  EPUB embed the family's files. */
function registerStandIns(family: string, faces: readonly Face[], variants: readonly FontVariantUse[]): void {
  if (faces.length === 0) return;
  for (const v of variants) {
    const sameStyle = faces.filter((f) => f.style === v.style);
    const pool = sameStyle.length > 0 ? sameStyle : faces;
    const nearest = pool.reduce((best, f) => (Math.abs(f.weight - v.weight) < Math.abs(best.weight - v.weight) ? f : best), pool[0]!);
    if (nearest.style === v.style && v.weight - nearest.weight < SKIA_FAKE_BOLD) continue;
    const key = `${family}|${v.weight}|${v.style}|stand-in|${nearest.weight}|${nearest.style}|${nearest.bytes.byteLength}`;
    if (registered.has(key)) continue;
    const copy = restyleFace(nearest.bytes, v.weight, v.style);
    if (!copy) continue;
    registered.add(key);
    GlobalFonts.register(Buffer.from(copy.buffer, copy.byteOffset, copy.byteLength), family);
  }
}

// ---------------------------------------------------------------------------
// Reading font files
// ---------------------------------------------------------------------------

interface FontMeta {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

let fontkitModule: typeof import('@pdf-lib/fontkit') | undefined;

/** Family, weight and style of a TrueType / OpenType file, from its tables. */
export async function readFontMeta(bytes: Uint8Array): Promise<FontMeta | undefined> {
  fontkitModule ??= await import('@pdf-lib/fontkit');
  const fontkit = (fontkitModule as unknown as { default?: typeof import('@pdf-lib/fontkit') }).default ?? fontkitModule;
  try {
    const font = fontkit.create(bytes) as unknown as {
      getName(key: string): string | null;
      familyName: string;
      italicAngle: number;
      'OS/2'?: { usWeightClass?: number; fsSelection?: { italic?: boolean } };
    };
    const family = font.getName('preferredFamily') ?? font.familyName;
    if (!family) return undefined;
    const os2 = font['OS/2'];
    const italic = os2?.fsSelection?.italic === true || (font.italicAngle ?? 0) !== 0;
    return { family, weight: os2?.usWeightClass ?? 400, style: italic ? 'italic' : 'normal' };
  } catch {
    return undefined;
  }
}

const FONT_EXT = new Set(['.ttf', '.otf', '.woff2']);

/** TrueType / OpenType bytes of a font file (WOFF2 decoded). */
export async function fontBytes(file: string, bytes: Uint8Array): Promise<{ bytes: Uint8Array; format: 'ttf' | 'otf' }> {
  if (extname(file).toLowerCase() === '.woff2') return { bytes: await decompressWoff2(bytes), format: 'ttf' };
  return { bytes, format: extname(file).toLowerCase() === '.otf' ? 'otf' : 'ttf' };
}

/** Every font in `dir`, with the family, weight and style its tables give. */
export async function scanFontDir(dir: string): Promise<Face[]> {
  const out: Face[] = [];
  const walk = async (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const path = join(d, name);
      if (statSync(path).isDirectory()) {
        await walk(path);
        continue;
      }
      if (!FONT_EXT.has(extname(name).toLowerCase())) continue;
      const decoded = await fontBytes(name, new Uint8Array(readFileSync(path))).catch(() => undefined);
      if (!decoded) continue;
      const meta = await readFontMeta(decoded.bytes);
      if (meta) out.push({ ...meta, ...decoded, source: 'font-dir' });
    }
  };
  if (existsSync(dir)) await walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Download cache (Google Fonts)
// ---------------------------------------------------------------------------

export function defaultCacheDir(): string {
  if (process.env.POSTEXT_CACHE_DIR) return process.env.POSTEXT_CACHE_DIR;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'postext', 'cache');
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'postext');
}

const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const variantFile = (v: FontVariantUse) => `${v.weight}-${v.style}.ttf`;

export interface FamilyMeta {
  /** False when neither Google Fonts nor Fontsource has the family. */
  available: boolean;
  weights: number[];
  styles: ('normal' | 'italic')[];
  checkedAt: number;
  /** The family's TrueType files by variant (`400-normal`), for a family
   *  Fontsource carries that Google Fonts does not (Commit Mono, FiraGO):
   *  downloaded from there (#689). */
  files?: Record<string, string>;
  /** The shape of this record: one written before Fontsource's own
   *  families were read (no `v`) is asked again when it says unavailable. */
  v?: number;
}

const META_VERSION = 2;

/** What the Fontsource API says of a family, as far as it is read. */
export interface FontsourceRecord {
  weights?: number[];
  styles?: string[];
  type?: string;
  defSubset?: string;
  variants?: Record<string, Record<string, Record<string, { url?: { ttf?: string } }>>>;
}

/** The TrueType file of each weight and style of a Fontsource record, in
 *  its default subset, by variant key (`400-normal`). */
export function fontsourceFiles(data: FontsourceRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [weight, styles] of Object.entries(data.variants ?? {})) {
    for (const [style, subsets] of Object.entries(styles ?? {})) {
      const subset = subsets?.[data.defSubset ?? 'latin'] ?? Object.values(subsets ?? {})[0];
      const url = subset?.url?.ttf;
      if (url && (style === 'normal' || style === 'italic')) out[`${weight}-${style}`] = url;
    }
  }
  return out;
}

/** How long "Google Fonts does not have it" is believed before asking again. */
const UNAVAILABLE_TTL_MS = 7 * 24 * 3600 * 1000;

async function familyMeta(family: string, dir: string, offline: boolean): Promise<FamilyMeta | undefined> {
  const file = join(dir, 'meta.json');
  if (existsSync(file)) {
    try {
      const meta = JSON.parse(readFileSync(file, 'utf8')) as FamilyMeta;
      if (meta.available || offline || (meta.v === META_VERSION && Date.now() - meta.checkedAt < UNAVAILABLE_TTL_MS)) return meta;
    } catch {
      // A broken file is fetched again.
    }
  }
  if (offline) return undefined;
  let meta: FamilyMeta;
  try {
    const res = await fetch(`https://api.fontsource.org/v1/fonts/${slug(family)}`);
    if (res.status === 404) meta = { available: false, weights: [], styles: [], checkedAt: Date.now(), v: META_VERSION };
    else if (!res.ok) return undefined;
    else {
      const data = (await res.json()) as FontsourceRecord;
      // Fontsource also lists families that are not on Google Fonts:
      // their files are its own.
      const files = data.type !== undefined && data.type !== 'google' ? fontsourceFiles(data) : undefined;
      meta = files && Object.keys(files).length === 0
        ? { available: false, weights: [], styles: [], checkedAt: Date.now(), v: META_VERSION }
        : {
            available: true,
            weights: (data.weights ?? []).filter((w) => typeof w === 'number'),
            styles: (data.styles ?? ['normal']).filter((s): s is 'normal' | 'italic' => s === 'normal' || s === 'italic'),
            checkedAt: Date.now(),
            ...(files ? { files } : {}),
            v: META_VERSION,
          };
    }
  } catch {
    return undefined;
  }
  ensureDir(dir);
  writeFileSync(file, JSON.stringify(meta));
  return meta;
}

function nearestAvailable(v: FontVariantUse, meta: FamilyMeta): FontVariantUse {
  const style = meta.styles.includes(v.style) ? v.style : 'normal';
  const weights = meta.weights.length > 0 ? meta.weights : [400];
  const weight = weights.reduce((best, w) => (Math.abs(w - v.weight) < Math.abs(best - v.weight) ? w : best), weights[0]!);
  return { weight, style };
}

/** The files that answer `variants` in a family: for each, the nearest
 *  weight and style it ships, each file once (a one-weight family answers
 *  its regular, its bold and their italics with one file). */
export function nearestVariants(variants: readonly FontVariantUse[], meta: FamilyMeta): FontVariantUse[] {
  const out = new Map<string, FontVariantUse>();
  for (const v of variants) {
    const nearest = nearestAvailable(v, meta);
    const key = `${nearest.weight}|${nearest.style}`;
    if (!out.has(key)) out.set(key, nearest);
  }
  return [...out.values()];
}

/** Download the variants of a Google family into `dir` (static TrueType
 *  files: the Google Fonts CSS API answers a client that is not a browser
 *  with whole `.ttf` instances, one per weight and style). */
async function download(family: string, variants: FontVariantUse[], dir: string, files?: Record<string, string>): Promise<void> {
  // A family Google Fonts does not have: Fontsource's own files.
  if (files) {
    ensureDir(dir);
    await Promise.all(variants.map(async (v) => {
      const src = files[`${v.weight}-${v.style}`];
      const file = join(dir, variantFile(v));
      if (!src || existsSync(file)) return;
      const font = await fetch(src);
      if (!font.ok) throw new Error(`Could not download ${src}: ${font.status}`);
      writeFileSync(file, new Uint8Array(await font.arrayBuffer()));
    }));
    return;
  }
  const tuples = [...new Set(variants.map((v) => `${v.style === 'italic' ? 1 : 0},${v.weight}`))].sort((a, b) => {
    const [ia, wa] = a.split(',').map(Number);
    const [ib, wb] = b.split(',').map(Number);
    return ia! - ib! || wa! - wb!;
  });
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${tuples.join(';')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Fonts answered ${res.status} for "${family}"`);
  const css = await res.text();
  ensureDir(dir);
  const faces = [...css.matchAll(/font-style:\s*(\w+);\s*font-weight:\s*(\d+);[^}]*?url\(([^)]+)\)/g)];
  await Promise.all(faces.map(async ([, style, weight, src]) => {
    const file = join(dir, variantFile({ weight: Number(weight), style: style === 'italic' ? 'italic' : 'normal' }));
    if (existsSync(file)) return;
    const font = await fetch(src!);
    if (!font.ok) throw new Error(`Could not download ${src}: ${font.status}`);
    writeFileSync(file, new Uint8Array(await font.arrayBuffer()));
  }));
}

// ---------------------------------------------------------------------------
// Resolving a book's fonts
// ---------------------------------------------------------------------------

/** What each family of the book needs: regular, bold and their italics
 *  (what the Sandbox loads for every family: settings inherit weights the
 *  config does not spell out, such as the headings' bold), and any other
 *  weight its settings name, the bold's included (`boldFontWeight`, #741). */
export function wantedVariants(book: Pick<Book, 'config' | 'chapters'>): Map<string, FontVariantUse[]> {
  const families = configFontFamilies(book.config, book.chapters.map((c) => c.markdown));
  const usage = collectFontUsage(book.config);
  const out = new Map<string, FontVariantUse[]>();
  for (const family of families) {
    const list = [...STANDARD_FONT_VARIANTS, ...(usage.get(family) ?? [])];
    const seen = new Set<string>();
    out.set(family, list.filter((v) => {
      const k = `${v.weight}|${v.style}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }));
  }
  return out;
}

const fontDirCache = new Map<string, Promise<Face[]>>();
const embeddedFaces: Face[] = [];

function embedded(): Face[] {
  if (embeddedFaces.length === 0) {
    for (const f of EMBEDDED_FACES) {
      embeddedFaces.push({ family: f.family, weight: f.weight, style: f.style, bytes: readEmbedded(f.path), format: 'ttf', source: 'embedded' });
    }
  }
  return embeddedFaces;
}

export async function resolveFonts(book: Book, options: FontOptions, reporter: Reporter): Promise<FontSet> {
  const faces: Face[] = [];
  // 1. The book's own files.
  for (const f of book.fonts) {
    try {
      const decoded = await fontBytes(f.file, new Uint8Array(f.bytes));
      faces.push({ family: f.family, weight: f.weight, style: f.style, ...decoded, source: 'book' });
    } catch (err) {
      reporter.warn({ kind: 'fontUnreadable', severity: 'warning', message: `${f.file}: ${(err as Error).message}` });
    }
  }
  const dirFaces = (await Promise.all(options.fontDirs.map((d) => {
    let p = fontDirCache.get(d);
    if (!p) fontDirCache.set(d, (p = scanFontDir(d)));
    return p;
  }))).flat();
  const cacheRoot = join(options.cacheDir ?? defaultCacheDir(), 'fonts');
  const has = (family: string) => faces.some((f) => f.family.toLowerCase() === family.toLowerCase());

  const wanted = wantedVariants(book);
  // What each family ships, where the cache has its record (#741): a face
  // the pages ask for that the family has and the set does not is reported
  // after the layout (`fontFallbackWarnings`). Read from disk only: a
  // family the book or a font folder supplies is never asked about online.
  const shipped = new Map<string, FontVariantUse[]>();
  const ships = (family: string, meta: FamilyMeta | undefined) => {
    if (!meta?.available) return;
    const styles = meta.styles.length > 0 ? meta.styles : ['normal' as const];
    shipped.set(family.toLowerCase(), meta.weights.flatMap((weight) => styles.map((style) => ({ weight, style }))));
  };
  for (const [family, variants] of wanted) {
    if (has(family) || dirFaces.some((f) => f.family.toLowerCase() === family.toLowerCase())) {
      ships(family, await familyMeta(family, join(cacheRoot, slug(family)), true));
    }
    if (has(family)) continue;
    const key = family.toLowerCase();
    // 2. --font-dir.
    const fromDir = dirFaces.filter((f) => f.family.toLowerCase() === key);
    if (fromDir.length > 0) {
      faces.push(...fromDir.map((f) => ({ ...f, family })));
      continue;
    }
    // 3–5. Embedded faces, the cache and Google Fonts, variant by variant.
    const found: Face[] = embedded().filter((f) => f.family.toLowerCase() === key).map((f) => ({ ...f, family }));
    const missing = variants.filter((v) => !found.some((f) => f.weight === v.weight && f.style === v.style));
    if (missing.length > 0) {
      const dir = join(cacheRoot, slug(family));
      const meta = await familyMeta(family, dir, options.offline);
      ships(family, meta);
      if (meta?.available) {
        const targets = nearestVariants(missing, meta)
          .filter((v) => !found.some((f) => f.weight === v.weight && f.style === v.style));
        const absent = targets.filter((v) => !existsSync(join(dir, variantFile(v))));
        if (absent.length > 0 && !options.offline) {
          reporter.info(`downloading ${family} (${absent.map((v) => `${v.weight}${v.style === 'italic' ? ' italic' : ''}`).join(', ')}) from ${meta.files ? 'Fontsource' : 'Google Fonts'}`);
          try {
            await download(family, absent, dir, meta.files);
          } catch (err) {
            reporter.warn({ kind: 'fontDownload', severity: 'warning', message: `${family}: ${(err as Error).message}` });
          }
        }
        for (const v of targets) {
          const file = join(dir, variantFile(v));
          if (!existsSync(file)) continue;
          const source: FaceSource = absent.some((a) => a.weight === v.weight && a.style === v.style) ? 'download' : 'cache';
          found.push({ family, weight: v.weight, style: v.style, bytes: new Uint8Array(readFileSync(file)), format: 'ttf', source });
        }
      }
    }
    if (found.length > 0) {
      faces.push(...found);
      continue;
    }
    // Nowhere: the fallback face stands in under the family's name.
    reporter.warn({
      kind: 'missingFont',
      severity: 'warning',
      message: `font family "${family}" is not in the book${options.offline ? ' (offline)' : ' nor on Google Fonts or Fontsource'}; set in ${FALLBACK_FAMILY} instead (add it with --font-dir)`,
    });
    faces.push(...embedded().filter((f) => f.family === FALLBACK_FAMILY).map((f) => ({ ...f, family, source: 'fallback' as const, standsInFor: FALLBACK_FAMILY })));
  }
  // The fallback family is always there for the PDF writer.
  if (!has(FALLBACK_FAMILY)) faces.push(...embedded().filter((f) => f.family === FALLBACK_FAMILY));
  for (const face of faces) register(face);
  // A bold or an italic a family does not ship is drawn from its own
  // nearest face, as the PDF embeds it (#688). A family the book carries
  // is left as its author made it.
  const carried = new Set(book.fonts.map((f) => f.family.toLowerCase()));
  for (const [family, variants] of wanted) {
    if (carried.has(family.toLowerCase())) continue;
    registerStandIns(family, faces.filter((f) => f.family.toLowerCase() === family.toLowerCase()), variants);
  }
  return new FontSet(faces, new Set([...wanted.keys(), ...book.fonts.map((f) => f.family)]), shipped);
}

/**
 * The faces the pages were set in that the set does not hold although
 * their family ships them (#741): offline with no cached file, a download
 * that failed, a font folder without the file. The canvas measured the
 * text with the nearest face of the family, so lines and pages may differ
 * from a host that has the face. A weight or a slant the family does not
 * ship stays silent: its nearest face stands in on purpose (#688).
 */
export function fontFallbackWarnings(docs: readonly VDTDocument[], fonts: FontSet): Warning[] {
  const out: Warning[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const face of documentFontFaces(doc)) {
      const key = `${face.family.toLowerCase()}|${face.weight}|${face.style}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ships = fonts.shipped.get(face.family.toLowerCase());
      if (!ships?.some((v) => v.weight === face.weight && v.style === face.style)) continue;
      const used = fonts.pick(face.family, face.weight, face.style);
      if (!used || (used.weight === face.weight && used.style === face.style)) continue;
      const name = (weight: number, style: string) => `${weight}${style === 'italic' ? ' italic' : ''}`;
      out.push({
        kind: 'fontFallback',
        severity: 'warning',
        message: `${face.family} ${name(face.weight, face.style)}: the family ships this face but it is not loaded (offline with no cached file, a failed download or a font folder without it); the text is set in its ${name(used.weight, used.style)} instead, and lines may break otherwise than where the face is there`,
      });
    }
  }
  return out;
}
