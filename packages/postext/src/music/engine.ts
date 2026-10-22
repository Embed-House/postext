import type { ScoreFormat, ScoreItem, ScoreRender, ScoreRenderOptions, ScoreSystem } from './types.js';
import { flattenVerovioSvg, itemsToSvg } from './flatten.js';

// ---------------------------------------------------------------------------
// Verovio singleton — lazy init. Verovio (LGPL-3.0) stays its own package,
// loaded with a dynamic import only by documents that hold a score: it is
// ~12 MB of WebAssembly (3.7 MB compressed), and a host can swap in its own
// build. The build with the Humdrum reader, which the plain one lacks: it
// reads ABC, MusicXML and MEI as well.
// ---------------------------------------------------------------------------

interface VerovioToolkit {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
  getLog(): string;
}

let toolkit: VerovioToolkit | null = null;
let initPromise: Promise<void> | null = null;
const initListeners = new Set<() => void>();
let warnedWithoutEngine = false;

export function isMusicReady(): boolean {
  return toolkit !== null;
}

export function onMusicReady(fn: () => void): () => void {
  if (toolkit !== null) {
    fn();
    return () => {};
  }
  initListeners.add(fn);
  return () => { initListeners.delete(fn); };
}

/**
 * Load Verovio and start the score engraver. Await it before laying out a
 * document with scores on the main thread (the layout worker calls it
 * itself): until it resolves, every score is set as a grey placeholder box.
 * Idempotent; a failed start can be retried.
 */
export async function initMusicEngine(): Promise<void> {
  if (toolkit !== null) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
        import('verovio/wasm-hum'),
        import('verovio/esm'),
      ]);
      const module = await createVerovioModule();
      toolkit = new VerovioToolkit(module) as unknown as VerovioToolkit;
    } catch (err) {
      initPromise = null;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`[postext] the music engine failed to start: ${reason}`, { cause: err });
    }
    for (const fn of initListeners) fn();
    initListeners.clear();
  })();
  return initPromise;
}

/** Called when the layout sets a score with no engine running. Warns once,
 *  and only when nobody asked for the engine. */
export function noteMusicWithoutEngine(): void {
  if (toolkit !== null || initPromise !== null || warnedWithoutEngine) return;
  warnedWithoutEngine = true;
  console.warn(
    '[postext] This document contains music scores, but the music engine is not running, so every score is laid out as a grey placeholder box. '
    + 'Call `await initMusicEngine()` before `buildDocument` (the layout worker does it for you).',
  );
}

// ---------------------------------------------------------------------------
// LRU cache
// ---------------------------------------------------------------------------

const MAX_CACHE = 512;
const cache = new Map<string, ScoreRender>();

function cacheKey(source: string, format: ScoreFormat, widthPx: number, o: ScoreRenderOptions): string {
  return [
    format, widthPx.toFixed(2), o.staffSizePx.toFixed(3), o.font, o.textFont ?? '', o.spacing,
    o.barNumbers, o.systemSpacing, source,
  ].join('|');
}

export function clearMusicCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Verovio's staff height at scale 100, in px: 4 staff spaces of 18 px. */
const STAFF_PX_AT_100 = 72;

const TITLE_RE = /<(?:work-title|movement-title|title)[^>]*>([^<]+)</i;
const ABC_TITLE_RE = /^T:\s*(.+)$/m;
const ABC_COMPOSER_RE = /^C:\s*(.+)$/m;
const COMPOSER_RE = /<(?:creator type="composer"|persName role="composer"|composer)[^>]*>([^<]+)</i;

function readMetadata(source: string, format: ScoreFormat): { title?: string; composer?: string } {
  if (format === 'abc') {
    return {
      title: ABC_TITLE_RE.exec(source)?.[1]?.trim(),
      composer: ABC_COMPOSER_RE.exec(source)?.[1]?.trim(),
    };
  }
  return {
    title: TITLE_RE.exec(source)?.[1]?.trim(),
    composer: COMPOSER_RE.exec(source)?.[1]?.trim(),
  };
}

function verovioOptions(widthPx: number, o: ScoreRenderOptions, leftMarginPx = 0): Record<string, unknown> {
  // Engrave at scale 100 on a page as wide as the measure at that scale; the
  // slices are then scaled to the measure exactly (Verovio's scale is an
  // integer percentage, too coarse for a staff size in px).
  const toScale100 = STAFF_PX_AT_100 / o.staffSizePx;
  return {
    scale: 100,
    pageWidth: Math.max(100, Math.round(widthPx * toScale100)),
    // Room for a brace or bracket left of the staves (see `renderScore`).
    pageMarginLeft: Math.round(leftMarginPx * toScale100),
    // One system per page: each page is one breakable slice of the score.
    pageHeight: 100,
    adjustPageHeight: true,
    breaks: 'auto',
    header: 'none',
    footer: 'none',
    pageMarginTop: 0,
    pageMarginBottom: 0,
    pageMarginRight: 0,
    spacingSystem: o.systemSpacing,
    spacingLinear: 0.25 * o.spacing,
    spacingNonLinear: 0.6,
    mnumInterval: o.barNumbers === 'every' ? 1 : 0,
    font: o.font,
    svgViewBox: true,
    svgRemoveXlink: true,
    smuflTextFont: 'none',
  };
}

const COORD_RUN_RE = /[MLCQST]([^A-Za-z]*)/g;

/** The leftmost x a system paints at (its paths' points; text is never
 *  left of the staves). */
function itemsMinX(items: readonly ScoreItem[]): number {
  let min = Infinity;
  for (const it of items) {
    if (it.type !== 'path') continue;
    for (const m of it.d.matchAll(COORD_RUN_RE)) {
      const nums = m[1]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      for (let k = 0; k < nums.length; k += 2) if (nums[k]! < min) min = nums[k]!;
    }
  }
  return Number.isFinite(min) ? min : 0;
}

const DEFAULT_TEXT_FONT = 'Times New Roman, serif';

function toSystem(svg: string, o: ScoreRenderOptions, widthPx: number): ScoreSystem | null {
  const flat = flattenVerovioSvg(svg, widthPx);
  if (!flat) return null;
  const textFont = o.textFont || DEFAULT_TEXT_FONT;
  return {
    widthPx,
    heightPx: flat.heightPx,
    items: flat.items,
    svg: itemsToSvg(flat.items, widthPx, flat.heightPx, 'currentColor', textFont),
    textFont,
  };
}

/**
 * Engrave a score at a measure `widthPx` wide. Returns one slice per system;
 * an empty list (with `error`) when the source does not load or the engine
 * is not running.
 */
export function renderScore(
  source: string,
  format: ScoreFormat,
  widthPx: number,
  options: ScoreRenderOptions,
): ScoreRender {
  const key = cacheKey(source, format, widthPx, options);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const meta = readMetadata(source, format);
  if (toolkit === null) {
    noteMusicWithoutEngine();
    return { systems: [], error: 'music engine not running', ...meta };
  }
  const engrave = (leftMarginPx: number): ScoreSystem[] | null => {
    toolkit!.setOptions(verovioOptions(widthPx, options, leftMarginPx));
    if (!toolkit!.loadData(source)) return null;
    const systems: ScoreSystem[] = [];
    const pages = toolkit!.getPageCount();
    for (let p = 1; p <= pages; p++) {
      const slice = toSystem(toolkit!.renderToSVG(p), options, widthPx);
      if (slice) systems.push(slice);
    }
    return systems;
  };
  let systems = engrave(0);
  // A brace or bracket joining staves stands left of them, past the
  // measure's edge: engraved again with a left margin that takes it, the
  // staves indented as far.
  const overhang = systems ? -Math.min(0, ...systems.map((s) => itemsMinX(s.items))) : 0;
  if (systems && overhang > 0.5) systems = engrave(Math.ceil(overhang + 1));
  const result: ScoreRender = systems
    ? { systems, ...meta }
    : { systems: [], error: toolkit.getLog().trim() || `the ${format} source did not load`, ...meta };
  cache.set(key, result);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  return result;
}
