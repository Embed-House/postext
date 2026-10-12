import { cjkMarkPieces } from './cjkClasses';
import { hasCJK } from './cjk';
import { fontStringFamily } from './fontString';

let _measureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
/** Font string currently set on the measure context, to skip redundant
 *  `ctx.font` assignments (each assignment re-parses the shorthand). */
let _currentFont = '';

// The language text is measured in (#764).
//
// A 2D context has a language (`ctx.lang`, Chrome 136 and later), which the
// shaper hands the font: Noto Serif SC sets `1` 47.1 px wide at 100 px in
// Chinese and 55 px in any language it has no forms for, Fira Sans sets
// `l·l` 62.5 px wide in Catalan and 81.6 px otherwise. Left alone
// (`inherit`) a context made on a page takes the language of the page that
// hosts the layout, and one made in a worker none, so one document had a
// layout per host. The engine sets the language itself, on every context
// it measures with: the document's, a block's or a run's own.
//
// Measured on Chrome 154: any string is taken; a tag the browser or the
// font knows nothing of (`''`, `und`, `xx`, `en` in a face with no English
// forms) gives the forms of no language, the ones a worker's `inherit`
// gives; setting the attribute to the value it has costs nothing that can
// be measured (40 000 measures in 6 ms either way), and so does reading it.
// A browser without the attribute measures as it did.

/** The value a context is given for "the host's language", what it has
 *  until someone sets another. */
const HOST_LANGUAGE = 'inherit';
/** The language set by {@link setMeasureLanguage}; undefined: the host's. */
let _language: string | undefined;
/** What `lang` of the measuring context was last set to. */
let _ctxLanguage = HOST_LANGUAGE;

/** Give `ctx` the language measured in, where the context has one. */
function applyLanguage(ctx: object, language: string | undefined): void {
  if ('lang' in ctx) (ctx as { lang: string }).lang = language ?? HOST_LANGUAGE;
}

function getMeasureCtx(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  if (!_measureCtx) {
    if (typeof OffscreenCanvas !== 'undefined') {
      _measureCtx = new OffscreenCanvas(1, 1).getContext('2d')!;
    } else {
      _measureCtx = document.createElement('canvas').getContext('2d')!;
    }
    _currentFont = '';
    _ctxLanguage = HOST_LANGUAGE;
  }
  const wanted = _language ?? HOST_LANGUAGE;
  if (wanted !== _ctxLanguage) {
    applyLanguage(_measureCtx, _language);
    _ctxLanguage = wanted;
  }
  return _measureCtx;
}

/** The widths measured in one language: every cache below is one of
 *  these, so a document in two languages keeps both. */
interface WidthCaches {
  width: Map<string, Map<string, number>>;
  widthEntries: number;
  run: Map<string, Map<string, number>>;
  runEntries: number;
  marked: Map<string, Map<string, number>>;
  markedEntries: number;
  /** Font string → whether its punctuation changes with the script. */
  sensitive: Map<string, boolean>;
}
const newCaches = (): WidthCaches => ({ width: new Map(), widthEntries: 0, run: new Map(), runEntries: 0, marked: new Map(), markedEntries: 0, sensitive: new Map() });
/** The caches of each language measured in (`''` under the key of the
 *  host's language is never mixed with the explicit empty tag: the host's
 *  is kept under {@link HOST_LANGUAGE}). */
let _cachesByLanguage = new Map<string, WidthCaches>();
/** The caches of the language measured in now. */
let C: WidthCaches = newCaches();
_cachesByLanguage.set(HOST_LANGUAGE, C);

/**
 * Measure in `language` from now on: a BCP 47 tag (`zh-Hans`, `ca`), the
 * empty string for no language at all, or undefined for the host's (what
 * a context has when nobody sets one: the page's on a page, none in a
 * worker; a configuration with `bodyText.shapingLanguage: 'host'`). The
 * build sets the document's and puts back what it found; a block and a run
 * that name their own set it for their text ({@link withMeasureLanguage}).
 * Each language keeps its own widths, so going from one to another drops
 * nothing measured; a cache kept elsewhere of what was measured in a font
 * holds the language in its key ({@link measureLanguageKey}).
 */
export function setMeasureLanguage(language: string | undefined): void {
  if (language === _language) return;
  _language = language;
  const key = language ?? HOST_LANGUAGE;
  let caches = _cachesByLanguage.get(key);
  if (!caches) {
    caches = newCaches();
    _cachesByLanguage.set(key, caches);
  }
  C = caches;
}

/** The language set by {@link setMeasureLanguage}. */
export function getMeasureLanguage(): string | undefined {
  return _language;
}

/** Run `fn` measuring in `language`, then measure again in the language
 *  in force before, also when `fn` throws. */
export function withMeasureLanguage<T>(language: string | undefined, fn: () => T): T {
  const previous = _language;
  if (language === previous) return fn();
  setMeasureLanguage(language);
  try {
    return fn();
  } finally {
    setMeasureLanguage(previous);
  }
}

/** The part of a measurement cache key the language decides: empty for
 *  the host's, so those keys are unchanged. */
export function measureLanguageKey(): string {
  return _language === undefined ? '' : `lg${_language}\x00`;
}

// Word-level width cache. Text measurement is the engine's hottest call:
// tokenizers measure every word (plus hyphenation prefixes), and natural
// language repeats words constantly. Keyed font → text → width so the key
// needs no string concatenation. Cleared wholesale when it grows past the
// cap (rare) or when fonts change (see clearTextWidthCache).
const MAX_WIDTH_CACHE_ENTRIES = 100_000;

export function measureTextWidth(text: string, font: string): number {
  let byText = C.width.get(font);
  if (byText === undefined) {
    byText = new Map();
    C.width.set(font, byText);
  }
  const cached = byText.get(text);
  if (cached !== undefined) return cached;

  const ctx = getMeasureCtx();
  if (font !== _currentFont) {
    ctx.font = font;
    _currentFont = font;
  }
  // Two CJK marks side by side (`）》`, `”“`) are measured apart: the
  // browser would set the first half width in one run (see
  // `cjkMarkCuts`), and the renderers paint them apart. Text with no CJK
  // is never cut (`markCuts`): one measure, with no cut to look for.
  let width = 0;
  if (!hasCJK(text)) width += ctx.measureText(text).width;
  else for (const piece of cjkMarkPieces(text, true)) width += ctx.measureText(piece).width;

  if (C.widthEntries >= MAX_WIDTH_CACHE_ENTRIES) {
    C.width = new Map();
    C.widthEntries = 0;
    byText = new Map();
    C.width.set(font, byText);
  }
  byText.set(text, width);
  C.widthEntries++;
  return width;
}

// Widths of runs as the browser sets them (see `measureRunWidth`): `C.run`.

/**
 * The width of `text` set in one run, as the browser paints it: two CJK
 * marks that meet are not measured apart (see {@link measureTextWidth}).
 * For the pieces a renderer paints apart (`markPieces`), each of which
 * holds only pairs the layout measured whole.
 */
export function measureRunWidth(text: string, font: string): number {
  let byText = C.run.get(font);
  if (byText === undefined) {
    byText = new Map();
    C.run.set(font, byText);
  }
  const cached = byText.get(text);
  if (cached !== undefined) return cached;
  const ctx = getMeasureCtx();
  if (font !== _currentFont) {
    ctx.font = font;
    _currentFont = font;
  }
  const width = ctx.measureText(text).width;
  if (C.runEntries >= MAX_WIDTH_CACHE_ENTRIES) {
    C.run = new Map();
    C.runEntries = 0;
    byText = new Map();
    C.run.set(font, byText);
  }
  byText.set(text, width);
  C.runEntries++;
  return width;
}

// Widths of words with no letter, measured in a script (#725): `C.marked`.

function rawWidth(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, text: string, rtl: boolean): number {
  // A right-to-left word is measured as it is painted: its brackets mirrored.
  if (!rtl || !('direction' in ctx)) return ctx.measureText(text).width;
  const direction = ctx.direction;
  ctx.direction = 'rtl';
  const width = ctx.measureText(text).width;
  ctx.direction = direction;
  return width;
}

/**
 * The width of `text` set between `lead` and `trail`, less theirs: `text`
 * as the browser shapes it in the script of the mark beside it (#725, see
 * `measure/script.ts`; a word with no letter takes the script of the text
 * it stands in). `rtl`: measured in a right-to-left context, as the word is
 * painted. The mark is glued with a no-break space, so nothing kerns
 * across. For text with no CJK character (it is measured in one run).
 */
export function measureMarkedWidth(text: string, font: string, lead: string, trail: string, rtl: boolean): number {
  let byText = C.marked.get(font);
  if (byText === undefined) {
    byText = new Map();
    C.marked.set(font, byText);
  }
  const key = `${rtl ? '<' : '>'}${lead}\x00${trail}\x00${text}`;
  const cached = byText.get(key);
  if (cached !== undefined) return cached;
  const ctx = getMeasureCtx();
  if (font !== _currentFont) {
    ctx.font = font;
    _currentFont = font;
  }
  const markKey = `${rtl ? '<' : '>'}${lead}\x00${trail}`;
  let mark = byText.get(markKey);
  if (mark === undefined) {
    mark = rawWidth(ctx, lead + trail, rtl);
    byText.set(markKey, mark);
    C.markedEntries++;
  }
  const width = Math.max(0, rawWidth(ctx, lead + text + trail, rtl) - mark);
  if (C.markedEntries >= MAX_WIDTH_CACHE_ENTRIES) {
    C.marked = new Map();
    C.markedEntries = 0;
    byText = new Map();
    C.marked.set(font, byText);
  }
  byText.set(key, width);
  C.markedEntries++;
  return width;
}

/** The marks {@link scriptSensitive} compares: the punctuation and digits
 *  a face may draw by script. */
const SCRIPT_PROBE = '.,:;!?()[]\u00AB\u00BB\u201C\u201D\u2018\u2019\'"-\u2013\u2014/\u2026*%&0123456789';
/** Least difference between two of the probe's widths that counts, as a
 *  fraction of the smaller: above the noise of two measures, far below
 *  any change of glyph (Amiri's full stop alone moves the row by 1.3 %). */
const PROBE_TOLERANCE = 0.0005;

/**
 * Whether the face `font` draws punctuation or digits otherwise by script:
 * a fixed row of them is measured beside each of `marks` (a character of
 * each script, glued after it) and the widths compared. One false answer
 * a font string for nearly every face, which then goes no further; the
 * answer is dropped with the cached widths when faces change. A measurer
 * that tells nothing apart (no canvas, a stub) answers false.
 */
export function scriptSensitive(font: string, marks: readonly string[]): boolean {
  const known = C.sensitive.get(font);
  if (known !== undefined) return known;
  const ctx = getMeasureCtx();
  if (font !== _currentFont) {
    ctx.font = font;
    _currentFont = font;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const mark of marks) {
    const width = ctx.measureText(SCRIPT_PROBE + mark).width - ctx.measureText(mark).width;
    if (width < lo) lo = width;
    if (width > hi) hi = width;
  }
  const sensitive = Number.isFinite(lo) && lo > 0 && hi - lo > lo * PROBE_TOLERANCE;
  C.sensitive.set(font, sensitive);
  return sensitive;
}

/** Drop all cached text widths. Must be called whenever font faces are
 *  (un)registered: widths measured against fallback glyphs are stale. */
export function clearTextWidthCache(): void {
  evictTextWidths(null);
}

// The measurement generation (#629): bumped whenever widths are dropped, so
// caches filled under another generation (a host's `MeasurementCache`) know
// to drop what was measured with the faces that changed. The log says which
// families each bump concerned (null: all of them).
let _generation = 0;
const _evictions: { generation: number; families: ReadonlySet<string> | null }[] = [];
const MAX_EVICTIONS = 64;

/** The current measurement generation: a counter bumped by every
 *  {@link evictTextWidths} (and so by `clearMeasurementCache` and the
 *  per-family eviction when faces arrive). */
export function measurementGeneration(): number {
  return _generation;
}

/** What changed since `generation`: every family (`all`), or the
 *  families named by the evictions after it (lower case). */
export function evictionsSince(generation: number): { all: boolean; families: Set<string> } {
  const families = new Set<string>();
  if (generation >= _generation) return { all: false, families };
  const oldest = _evictions[0];
  if (!oldest || oldest.generation > generation + 1) return { all: true, families };
  for (const e of _evictions) {
    if (e.generation <= generation) continue;
    if (e.families === null) return { all: true, families };
    for (const f of e.families) families.add(f);
  }
  return { all: false, families };
}

function dropFamilies(caches: Map<string, Map<string, number>>, families: ReadonlySet<string>): number {
  let dropped = 0;
  for (const [font, byText] of caches) {
    const family = fontStringFamily(font);
    if (family !== null && families.has(family.toLowerCase())) {
      dropped += byText.size;
      caches.delete(font);
    }
  }
  return dropped;
}

/** Drop the cached widths measured in `families` (case-insensitive), or
 *  every width when `families` is null, and bump the measurement
 *  generation. The listeners of {@link onTextWidthCacheClear} (caches of
 *  ink and baselines) clear whole. */
export function evictTextWidths(families: Iterable<string> | null): void {
  const set = families === null ? null : new Set(Array.from(families, (f) => f.toLowerCase()));
  if (set === null) {
    // Every language's widths: the one measured in keeps its place.
    C = newCaches();
    _cachesByLanguage = new Map([[_language ?? HOST_LANGUAGE, C]]);
  } else {
    for (const caches of _cachesByLanguage.values()) {
      caches.widthEntries -= dropFamilies(caches.width, set);
      caches.runEntries -= dropFamilies(caches.run, set);
      caches.markedEntries -= dropFamilies(caches.marked, set);
      for (const font of [...caches.sensitive.keys()]) {
        const family = fontStringFamily(font);
        // A face of the stack may stand in for another: any font string
        // that names a changed family is asked again.
        if (family === null || [...set].some((f) => font.toLowerCase().includes(f))) caches.sensitive.delete(font);
      }
    }
  }
  // The context resolves its font again on the next measure.
  _currentFont = '';
  _generation++;
  _evictions.push({ generation: _generation, families: set });
  if (_evictions.length > MAX_EVICTIONS) _evictions.shift();
  for (const listener of _fontChangeListeners) listener();
}

const _fontChangeListeners = new Set<() => void>();

/** Called whenever {@link clearTextWidthCache} drops the widths (fonts
 *  changed): other font-dependent caches clear with it. */
export function onTextWidthCacheClear(listener: () => void): void {
  _fontChangeListeners.add(listener);
}

/** The ink box of `text` in `font` above and below the alphabetic
 *  baseline (px), or null when the measurer gives no ink metrics. Not
 *  cached. */
export function measureInkBox(text: string, font: string): { ascent: number; descent: number } | null {
  const ctx = getMeasureCtx();
  if (font !== _currentFont) {
    ctx.font = font;
    _currentFont = font;
  }
  const m = ctx.measureText(text) as Partial<TextMetrics>;
  const ascent = m.actualBoundingBoxAscent;
  const descent = m.actualBoundingBoxDescent;
  if (typeof ascent !== 'number' || typeof descent !== 'number' || !Number.isFinite(ascent) || !Number.isFinite(descent)) return null;
  return { ascent, descent };
}

/** How far the ink of a text reaches above and below the baseline at each
 *  pixel column along it (see {@link measureInkProfile}). */
export interface InkProfile {
  /** Where column 0 stands, px from the pen's origin (negative when the
   *  ink overhangs the origin). */
  start: number;
  /** The text's advance, px. */
  advance: number;
  /** Per column: px of ink above the baseline (−Infinity: no ink). */
  above: Float32Array;
  /** Per column: px of ink below the baseline (−Infinity: no ink). */
  below: Float32Array;
}

let _profileCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;

/** Alpha under which a pixel is left out: a faint fringe. */
const INK_ALPHA = 32;

/**
 * The ink of `text` in `font` column by column: the text is painted from
 * its left edge, left to right as the page paints it, and each pixel
 * column records its highest and lowest inked pixel. Null when nothing can
 * be painted and read back (no canvas, or a measurer without pixels) or
 * the text has no ink. Not cached.
 */
export function measureInkProfile(text: string, font: string): InkProfile | null {
  if (_profileCtx === undefined) {
    _profileCtx = null;
    try {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? document.createElement('canvas') : null;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
      if (ctx && typeof ctx.fillText === 'function' && typeof ctx.getImageData === 'function') _profileCtx = ctx;
    } catch {
      _profileCtx = null;
    }
  }
  const ctx = _profileCtx;
  if (!ctx) return null;
  try {
    // The ink is the ink of the glyphs measured: the same language.
    applyLanguage(ctx, _language);
    ctx.font = font;
    const m = ctx.measureText(text);
    const { actualBoundingBoxLeft: left, actualBoundingBoxRight: right, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent } = m;
    if (![left, right, ascent, descent].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    const pad = 2;
    const x0 = Math.floor(-left) - pad;
    const width = Math.ceil(right) + pad - x0;
    const top = Math.ceil(ascent) + pad;
    const height = top + Math.ceil(descent) + pad;
    if (width <= 0 || height <= 0 || width * height > 4_000_000) return null;
    const canvas = ctx.canvas as { width: number; height: number };
    if (canvas.width < width) canvas.width = width;
    if (canvas.height < height) canvas.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if ('direction' in ctx) ctx.direction = 'ltr';
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fillText(text, -x0, top);
    const data = ctx.getImageData(0, 0, width, height).data;
    const above = new Float32Array(width).fill(-Infinity);
    const below = new Float32Array(width).fill(-Infinity);
    let inked = false;
    // The outermost pixel of a column is only partly covered: its alpha
    // says how much, so the edge stands that far into it.
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const a = data[(y * width + x) * 4 + 3]!;
        if (a < INK_ALPHA) continue;
        above[x] = top - y - 1 + a / 255;
        inked = true;
        break;
      }
      for (let y = height - 1; y >= 0; y--) {
        const a = data[(y * width + x) * 4 + 3]!;
        if (a < INK_ALPHA) continue;
        below[x] = y - top + a / 255;
        break;
      }
    }
    return inked ? { start: x0, advance: m.width, above, below } : null;
  } catch {
    return null;
  }
}

/** Where the ink of `text` in `font` starts and ends along the line, px
 *  from the pen's origin (the start is negative when the ink overhangs
 *  it), or null when the measurer gives no ink metrics or the text has no
 *  ink. Not cached. */
export function measureInkExtent(text: string, font: string): { start: number; end: number } | null {
  const ctx = getMeasureCtx();
  if (font !== _currentFont) {
    ctx.font = font;
    _currentFont = font;
  }
  const m = ctx.measureText(text) as Partial<TextMetrics>;
  const left = m.actualBoundingBoxLeft;
  const right = m.actualBoundingBoxRight;
  if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  const start = -left;
  return right > start ? { start, end: right } : null;
}

/** Measure a short glyph (e.g. a list bullet) in the given font. */
export function measureGlyphWidth(text: string, font: string): number {
  return measureTextWidth(text, font);
}

/** Compute the normal space width for a given font, used to express justified
 *  spacing as a multiplier of the natural space. */
export function normalSpaceWidthFor(font: string): number {
  return measureTextWidth(' ', font);
}

export function cleanSoftHyphens(text: string): string {
  return text.replace(/\u00AD/g, '');
}
