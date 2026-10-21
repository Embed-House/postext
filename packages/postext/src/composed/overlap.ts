/**
 * The overlap checks of a composed page (#1053, DESIGN §12.10): what the
 * reflow ladder never sees, because no frame's content is short of its box.
 *
 * - `frameCovered`: ink of a frame (its lines, its tab and title, its
 *   pictures) under a frame painted after it (a higher `layer`, or the same
 *   layer later in template order, as `composedPaintOrder` paints them)
 *   where that frame is opaque: its fill (the boxes of its overlay with a
 *   background: the style's or `look`'s fill, a label tab, a stripe), its
 *   pictures and its text. A frame with no fill covers nothing between its
 *   pictures and lines; words cover words, not pictures (a line over a
 *   picture hides a hairline of it).
 * - `frameOutsideArea`: ink of a frame past what holds it: its text past
 *   the trim (cut there), its fill or pictures past the bleed (a fill may
 *   bleed on purpose), or any of it past the frame or group it is anchored
 *   inside (a nine-point anchor on `'#name'` whose point lies in that box).
 *
 * Pure: it reads the laid frames and their blocks, so it runs on the
 * composition the ladder settled on, before a spread is cut at its spine
 * (the facing copies do not exist yet). Every box is put on the sheet by
 * its frame's matrix (scale, turn) and compared as the box holding it.
 */
import type { ContentWarning, FrameCoverProposal, FrameOutsideProposal, ReflowEvent, VDTBlock, VDTDesignBlock, VDTFrame } from '../vdt.js';
import type { Dimension } from '../types.js';
import { physicalEdge } from '../design/logicalEdges.js';
import { dimensionToPx } from '../units.js';
import { contourOnPage } from '../contour/index.js';
import { anchorOn, type FrameAreas, type Rect } from './geometry.js';
import { frameClips, frameContentRect, frameMatrix } from './paint.js';
import { anchorTarget } from './templates.js';
import type { ResolvedFrame, ResolvedPageTemplate } from './types.js';

const MM_PER_IN = 25.4;
/** Overlaps thinner than this (mm) are a touch, not a cover: a line box
 *  holds its leading, two frames set edge to edge meet without hiding
 *  anything. */
const MIN_DEPTH_MM = 0.3;
/** The least area covered that is reported (mm²). */
const MIN_AREA_MM2 = 1;
/** The least overrun that is reported (mm). */
const MIN_EXCESS_MM = 0.3;

/** A piece of a frame's ink on the sheet. */
interface Ink {
  box: Rect;
  kind: 'text' | 'picture' | 'fill';
  /** A line of the frame's body, which text pushed by another frame runs
   *  round (`'line'`), or text that keeps its place: a caption or note, a
   *  tab, a title (`'fixed'`). */
  flow?: 'line' | 'fixed';
  /** The words of a line, the resource of a picture. */
  text?: string;
  resourceId?: string;
  /** A covering picture with a known shape (#1123): the rows of its
   *  shape (its polygon or traced alpha channel), each a box on the sheet;
   *  what it hides is what lies under them, not under its whole box. */
  shape?: Rect[];
}

export interface OverlapCheckInput {
  /** The template laid (with the ladder's patches). */
  template: ResolvedPageTemplate;
  /** The page's frames as laid, any order. */
  frames: readonly VDTFrame[];
  /** The page's frame blocks (each frame's box first). */
  blocks: readonly VDTBlock[];
  /** Groups' final boxes, by name. */
  groupRects: ReadonlyMap<string, Rect>;
  areas: FrameAreas;
  dpi: number;
  emPx: number;
  fenceIndex: number;
  pageIndex: number;
  locale?: string;
  /** The page lays its flow out right to left (`pageIsMirrored`): a
   *  picture's shape turns in the frames' coordinates. */
  mirrored?: boolean;
  /** The page's flow is vertical: pictures cover with their boxes. */
  verticalFlow?: boolean;
}

export interface OverlapCheckResult {
  warnings: ContentWarning[];
  /** `covered` and `outside` events of the reflow log. */
  events: ReflowEvent[];
}

type Affine = [number, number, number, number, number, number];

/** The box holding `r` once put on the sheet by `m`. */
function mapRect(r: Rect, m: Affine | undefined): Rect {
  if (!m) return { x: r.x, y: r.y, width: r.width, height: r.height };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]] as const) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return r > x && btm > y ? { x, y, width: r - x, height: btm - y } : undefined;
}

/** Area of the union of `rects` (few: a sweep over their edges). */
function unionArea(rects: readonly Rect[]): number {
  if (rects.length === 0) return 0;
  if (rects.length === 1) return rects[0]!.width * rects[0]!.height;
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const spans = rects
      .filter((r) => r.x <= x0 && r.x + r.width >= x1)
      .map((r) => [r.y, r.y + r.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let lo = -Infinity;
    let hi = -Infinity;
    for (const [a, b] of spans) {
      if (a > hi) {
        covered += hi - lo > 0 ? hi - lo : 0;
        lo = a;
        hi = b;
      } else if (b > hi) hi = b;
    }
    covered += hi - lo > 0 ? hi - lo : 0;
    area += covered * (x1 - x0);
  }
  return area;
}

/** A colour that hides what is under it: not transparent, and at least
 *  half opaque when it carries an alpha (`#rrggbbaa`). */
function opaque(color: string | undefined): boolean {
  if (!color) return false;
  const c = color.trim().toLowerCase();
  if (c === '' || c === 'transparent' || c === 'none') return false;
  if (/^#[0-9a-f]{8}$/.test(c)) return parseInt(c.slice(7, 9), 16) >= 0x80;
  if (/^#[0-9a-f]{4}$/.test(c)) return parseInt(c.slice(4, 5), 16) >= 8;
  return true;
}

/** The size in px a design text's font string names (`bold 12px "X"`). */
function fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 12;
}

/** The ink of a design slot's blocks (a box's overlay: its fill, tab,
 *  stripe, icon, title). */
function designInk(blocks: readonly VDTDesignBlock[], out: Ink[]): void {
  for (const b of blocks) {
    if (b.kind === 'box') {
      if (opaque(b.box.backgroundColor)) out.push({ box: { ...b.bbox }, kind: 'fill' });
      else if (b.box.borderColor && b.box.borderWidthPx > 0) out.push({ box: { ...b.bbox }, kind: 'fill' });
    } else if (b.kind === 'path' && b.boxPart && b.fill) {
      // A card joined to its tab (#1059), as a box.
      out.push({ box: { ...b.bbox }, kind: 'fill' });
    } else if (b.kind === 'image') {
      out.push({ box: { ...b.bbox }, kind: 'picture' });
    } else if (b.kind === 'rule') {
      out.push({ box: { ...b.bbox }, kind: 'fill' });
    } else if (b.kind === 'text') {
      if (b.vertical) {
        const words = b.lines.map((l) => l.text).join(' ').trim();
        if (words) out.push({ box: { ...b.bbox }, kind: 'text', flow: 'fixed', text: words });
        continue;
      }
      const size = fontPx(b.fontString);
      for (const l of b.lines) {
        if (l.text.trim() === '' || l.width <= 0) continue;
        out.push({ box: { x: b.bbox.x + l.xOffset, y: l.baselineY - 0.8 * size, width: l.width, height: size }, kind: 'text', flow: 'fixed', text: l.text });
      }
    }
  }
}

/** A box's border alone does not hide what is under its middle: the fill
 *  pieces that only stroke an outline cover along it. */
function isOutlineOnly(b: VDTDesignBlock): boolean {
  return (b.kind === 'box' && !opaque(b.box.backgroundColor) && !!b.box.borderColor && b.box.borderWidthPx > 0)
    || (b.kind === 'path' && b.boxPart === 'border');
}

/** How pictures cover (#1123): by the rows of their shape, set as the page
 *  lays them (`mirrored`), or by their boxes (`false`). */
type PictureShapes = { mirrored: boolean } | false;

/** The ink of one frame, in its blocks' own (laid-out) coordinates: what
 *  it paints. `covering` leaves out outlines (they hide only a hairline)
 *  and keeps what hides what is under it; a covering picture with a known
 *  shape carries its rows (`shapes`). */
function frameInk(blocks: readonly VDTBlock[], covering: boolean, shapes: PictureShapes = false): Ink[] {
  const out: Ink[] = [];
  for (const b of blocks) {
    if (b.hidden) continue;
    if (b.designOverlay) {
      const overlay = covering ? b.designOverlay.blocks.filter((d) => !isOutlineOnly(d)) : b.designOverlay.blocks;
      designInk(overlay, out);
      // A heading design paints its overlay instead of its lines.
      if (b.type !== 'callout') continue;
    }
    const rb = b.resourceBlock;
    if (rb) {
      const body = rb.rotation ? { ...b.bbox } : { x: b.bbox.x + rb.bodyRect.x, y: b.bbox.y + rb.bodyRect.y, width: rb.bodyRect.width, height: rb.bodyRect.height };
      if (rb.kind === 'bitmap' || rb.kind === 'svg' || rb.kind === 'video') {
        const shape = covering && shapes && rb.kind !== 'video' && !rb.rotation ? pictureShape(b, shapes.mirrored) : undefined;
        out.push({ box: body, kind: 'picture', resourceId: rb.resource.id, ...(shape ? { shape } : {}) });
      }
      else if (!covering) out.push({ box: body, kind: 'text', flow: 'fixed', text: rb.resource.id });
      if (!rb.rotation) {
        for (const l of [...rb.captionLines, ...rb.noteLines]) {
          if (l.text.trim() !== '') out.push({ box: { ...l.bbox }, kind: 'text', flow: 'fixed', text: l.text });
        }
      }
      continue;
    }
    for (const l of b.lines) {
      if (l.text.trim() === '' || l.bbox.width <= 0 || l.bbox.height <= 0) continue;
      out.push({ box: { ...l.bbox }, kind: 'text', flow: 'line', text: l.text });
    }
  }
  return out;
}

/** The rows of a picture's shape where its block lays it (a cut-out's
 *  polygon or traced alpha channel, through its crop and scale), in the
 *  block's coordinates; `undefined` when the shape is not known (the box
 *  covers), none when the shape reaches no row. */
function pictureShape(b: VDTBlock, mirrored: boolean): Rect[] | undefined {
  const rb = b.resourceBlock!;
  const c = contourOnPage(rb.resource, rb, undefined, { margin: 0, mirrored, originX: b.bbox.x, originY: b.bbox.y });
  if (!c) return undefined;
  return c.spans.filter((sp) => sp.height > 0 && sp.right > sp.left).map((sp) => ({ x: sp.left, y: sp.y, width: sp.right - sp.left, height: sp.height }));
}

const ELEMENT_EDGES: ReadonlySet<string> = new Set(['right-of', 'left-of', 'below', 'above', 'align-top', 'align-bottom', 'align-left', 'align-right', 'align-start', 'align-end']);

/** Rounded to 0.1. */
const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The overlap warnings of one composed page (or the sheet of a spread),
 * and the reflow log's events for them.
 */
export function overlapChecks(input: OverlapCheckInput): OverlapCheckResult {
  const { template, dpi } = input;
  const mmPx = dpi / MM_PER_IN;
  const resolved = new Map(template.frames.map((f) => [f.name, f]));
  const order = new Map(template.frames.map((f, i) => [f.name, i]));
  const byId = new Map(input.blocks.map((b) => [b.id, b]));
  const shapes: PictureShapes = input.verticalFlow ? false : { mirrored: input.mirrored === true };
  const live = input.frames.filter((f) => !f.collapsed && !f.facingBlocks && resolved.has(f.name));
  /** Each frame's ink on the sheet, covered side and covering side, clipped
   *  to its box when its content overflows (painted clipped). */
  const inkOf = new Map<string, { all: Ink[]; covers: Ink[] }>();
  for (const f of live) {
    const blocks = f.blockIds.map((id) => byId.get(id)).filter((b): b is VDTBlock => b !== undefined);
    const m = frameMatrix(f);
    const clip = frameClips(f) ? frameContentRect(f) : undefined;
    const place = (list: Ink[]): Ink[] => list.flatMap((ink) => {
      const cut = clip ? intersect(ink.box, clip) : ink.box;
      if (!cut) return [];
      const shape = ink.shape?.flatMap((r) => {
        const piece = clip ? intersect(r, clip) : r;
        return piece ? [mapRect(piece, m)] : [];
      });
      return [{ ...ink, box: mapRect(cut, m), ...(shape ? { shape } : {}) }];
    });
    const rules: Ink[] = (f.rules ?? []).map((r) => ({ box: { ...r.bbox }, kind: 'fill' as const }));
    inkOf.set(f.name, { all: [...place(frameInk(blocks, false)), ...rules], covers: place(frameInk(blocks, true, shapes)) });
  }
  const warnings: ContentWarning[] = [];
  const events: ReflowEvent[] = [];
  const base = (f: VDTFrame): { template: string; frame: string; fenceIndex: number; configPath: string } => ({
    template: template.id,
    frame: f.name,
    fenceIndex: input.fenceIndex,
    configPath: f.configPath,
  });
  const where = (f: VDTFrame): { sourceStart?: number; sourceEnd?: number; pageIndex: number } => ({
    ...(f.sourceStart !== undefined ? { sourceStart: f.sourceStart, sourceEnd: f.sourceEnd } : {}),
    pageIndex: input.pageIndex,
  });
  const locale = input.locale ? { locale: input.locale } : {};
  const depth = MIN_DEPTH_MM * mmPx;

  // frameCovered: each frame against every frame painted after it.
  const paintRank = (f: VDTFrame): [number, number] => [f.layer, order.get(f.name) ?? 0];
  const later = (a: VDTFrame, b: VDTFrame): boolean => {
    const [la, oa] = paintRank(a);
    const [lb, ob] = paintRank(b);
    return lb > la || (lb === la && ob > oa);
  };
  /** What `over` covers of `under`, by the check's rules: the covered
   *  frame's ink that is not fill against the covering frame's opaque ink
   *  (its pictures left out when they push with a contour), each read
   *  through `ink` (the frames where they lie). `skipLines` leaves out the
   *  covered frame's body lines (they run round a pushing frame). */
  const pairInk = (under: VDTFrame, over: VDTFrame, ink: (name: string) => FrameInk, skipLines = false): { covered: Ink[]; covers: Ink[] } | undefined => {
    if (over === under || !later(under, over)) return undefined;
    const ru = resolved.get(under.name)!;
    const ro = resolved.get(over.name)!;
    if (ru.overlap === 'allow' || ro.overlap === 'allow') return undefined;
    const covered = ink(under.name).all.filter((i) => i.kind !== 'fill' && !(skipLines && i.flow === 'line'));
    // Text set round a frame's pictures (`wrap: 'contour'`) comes into
    // their box by design: the contour, not the box, keeps it clear.
    const contourWrap = ro.exclude === 'push' && ro.wrap === 'contour';
    const covers = ink(over.name).covers.filter((c) => !(contourWrap && c.kind === 'picture'));
    return covered.length > 0 && covers.length > 0 ? { covered, covers } : undefined;
  };
  const here = (name: string): FrameInk => inkOf.get(name)!;
  const found: CoverPair[] = [];
  for (const under of live) {
    for (const over of live) {
      const pi = pairInk(under, over, here);
      if (!pi) continue;
      let area = 0;
      let words: string | undefined;
      let picture: string | undefined;
      let hitLine = false;
      const hitBoxes: Rect[] = [];
      const hitCovers: Rect[] = [];
      for (const ink of pi.covered) {
        const cuts = inkCuts(ink, pi.covers, depth);
        if (cuts.length === 0) continue;
        area += unionArea(cuts.map((x) => x.cut));
        hitBoxes.push(ink.box);
        for (const x of cuts) hitCovers.push(x.c.box);
        if (ink.kind === 'text') {
          if (ink.flow === 'line') hitLine = true;
          if (ink.text !== undefined) words = words === undefined ? ink.text : words.length < 40 ? `${words} ${ink.text}` : words;
        } else if (picture === undefined && ink.resourceId) picture = ink.resourceId;
      }
      if (r1(area / (mmPx * mmPx)) < MIN_AREA_MM2) continue;
      found.push({ under, over, area, words, picture, hitLine, hitBoxes, hitCovers });
    }
  }

  // A move is proposed only where it lands clear (#1075).
  const warned = new Set(found.map((x) => pairKey(x.under.name, x.over.name)));
  const minArea = MIN_AREA_MM2 * mmPx * mmPx;
  const byName = new Map(live.map((f) => [f.name, f]));
  /** The frames that move with `name`: it, and those anchored to it. */
  const movers = (name: string): Set<string> => {
    const set = new Set([name]);
    for (let grew = true; grew;) {
      grew = false;
      for (const f of live) {
        const rf = resolved.get(f.name)!;
        const to = rf.grid ? undefined : anchorTarget(rf.placement);
        if (to !== undefined && set.has(to) && !set.has(f.name)) {
          set.add(f.name);
          grew = true;
        }
      }
    }
    return set;
  };
  const hostHere = (name: string): Rect | undefined => {
    const h = byName.get(name);
    return h ? hostRect(h) : input.groupRects.get(name);
  };
  /** How far a frame's ink runs past the page (text past the trim, the
   *  rest past the bleed) or past the box it is anchored inside, px. */
  const pastArea = (f: VDTFrame, ink: readonly Ink[], hostOf: (name: string) => Rect | undefined): number => {
    const text = ink.filter((i) => i.kind === 'text').map((i) => i.box);
    const rest = ink.filter((i) => i.kind !== 'text').map((i) => i.box);
    let max = Math.max(text.length ? overrun(text, input.areas.page).max : 0, rest.length ? overrun(rest, input.areas.bleed).max : 0);
    const host = insideHost(resolved.get(f.name)!, input, hostOf, (n) => resolved.get(n)?.overlap === 'allow');
    if (host && ink.length) max = Math.max(max, overrun(ink.map((i) => i.box), host.box).max);
    return max;
  };
  /**
   * The page with the frames of `moved` shifted by (dx, dy) px, read by the
   * check's own rules: whether the pair `target` (`under<over`) is clear,
   * whether each moved frame stays inside what holds it (no further past
   * it than it was), and the pieces of ink of pairs no warning names that
   * would come to cover each other (`m` the moved frame's piece where it
   * lies now, `b` the other frame's).
   */
  const tryMove: MoveTest = (moved, dx, dy, target) => {
    const move = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
    const shift = (list: Ink[]): Ink[] => list.map((i) => ({ ...i, box: move(i.box), ...(i.shape ? { shape: i.shape.map(move) } : {}) }));
    const shifted = new Map<string, FrameInk>();
    for (const name of moved) {
      const ink = inkOf.get(name);
      if (ink) shifted.set(name, { all: shift(ink.all), covers: shift(ink.covers) });
    }
    const at = (name: string): FrameInk => shifted.get(name) ?? inkOf.get(name)!;
    const hostAt = (name: string): Rect | undefined => {
      const r = hostHere(name);
      return r && moved.has(name) ? { ...r, x: r.x + dx, y: r.y + dy } : r;
    };
    for (const name of moved) {
      const f = byName.get(name);
      if (!f || resolved.get(name)!.overlap === 'allow') continue;
      const after = pastArea(f, at(name).all, hostAt);
      if (after >= MIN_EXCESS_MM * mmPx && after > pastArea(f, inkOf.get(name)!.all, hostHere) + 0.5) return { clear: false, outside: true, blockers: [] };
    }
    let clear = true;
    const blockers: Array<{ m: Rect; b: Rect }> = [];
    for (const under of live) {
      for (const over of live) {
        // Two frames that move together lie as they did to each other.
        if (moved.has(under.name) === moved.has(over.name)) continue;
        // Lines run round a pushing frame wherever it lies.
        const pi = pairInk(under, over, at, resolved.get(over.name)!.exclude === 'push');
        if (!pi) continue;
        let area = 0;
        const pieces: Array<{ m: Rect; b: Rect }> = [];
        for (const ink of pi.covered) {
          const cuts = inkCuts(ink, pi.covers, depth);
          if (cuts.length === 0) continue;
          area += unionArea(cuts.map((x) => x.cut));
          for (const x of cuts) {
            const [mv, other] = moved.has(under.name) ? [ink.box, x.c.box] : [x.c.box, ink.box];
            pieces.push({ m: { ...mv, x: mv.x - dx, y: mv.y - dy }, b: other });
          }
        }
        if (area < minArea) continue;
        const key = pairKey(under.name, over.name);
        if (key === target) clear = false;
        else if (!warned.has(key)) blockers.push(...pieces);
      }
    }
    return { clear, outside: false, blockers };
  };

  for (const { under, over, area, words, picture, hitLine, hitBoxes, hitCovers } of found) {
    const ro = resolved.get(over.name)!;
    const areaMm2 = r1(area / (mmPx * mmPx));
    const proposals: FrameCoverProposal[] = [];
    // Painted under it, the covering frame is hidden in turn wherever the
    // covered one is opaque (a fill, a picture): proposed only where the
    // covered frame has nothing but text over it.
    const covers = pairInk(under, over, here)!.covers;
    const underOpaque = inkOf.get(under.name)!.covers.filter((c) => c.kind !== 'text');
    const swaps = underOpaque.some((u) => covers.some((c) => {
      const cut = intersect(u.box, c.box);
      return cut !== undefined && cut.width >= depth && cut.height >= depth;
    }));
    if (!swaps) proposals.push({ kind: 'layer', path: `${over.configPath}/layer`, value: under.layer - 1 });
    // Body lines run round a frame that pushes; a caption or a tab do not.
    if (hitLine && ro.exclude !== 'push' && ro.rotate === 0 && !over.writingMode) proposals.push({ kind: 'exclude', path: `${over.configPath}/exclude`, value: 'push' });
    // The covered frame anchored to the covering one moves with it: no
    // move takes one off the other.
    const moved = movers(over.name);
    const move = moved.has(under.name) ? undefined : clearingMove(hitBoxes, hitCovers, mmPx, (dx, dy) => tryMove(moved, dx, dy, pairKey(under.name, over.name)));
    if (move) proposals.push({ kind: 'move', frame: over.name, dxMm: move.dxMm, dyMm: move.dyMm });
    const text = words !== undefined ? words.trim().replace(/\s+/g, ' ').slice(0, 40) : undefined;
    warnings.push({
      kind: 'frameCovered',
      ...base(under),
      coveredBy: over.name,
      coveredByPath: over.configPath,
      overlapMm2: areaMm2,
      ...(text ? { text } : {}),
      ...(picture !== undefined ? { picture } : {}),
      ...locale,
      proposals,
      ...where(under),
    });
    events.push({ frame: under.name, kind: 'covered', cause: over.name, areaMm2 });
  }

  // frameOutsideArea: past the trim (text) or the bleed (fills, pictures),
  // and past the box it is anchored inside.
  const moveIsClear = (name: string) => (dx: number, dy: number): boolean => {
    const t = tryMove(movers(name), dx, dy);
    return t.clear && !t.outside && t.blockers.length === 0;
  };
  for (const f of live) {
    const rf = resolved.get(f.name)!;
    if (rf.overlap === 'allow') continue;
    const ink = inkOf.get(f.name)!.all;
    if (ink.length === 0) continue;
    const textInk = ink.filter((i) => i.kind === 'text').map((i) => i.box);
    const restInk = ink.filter((i) => i.kind !== 'text').map((i) => i.box);
    const overTrim = overrun(textInk, input.areas.page);
    const overBleed = overrun(restInk, input.areas.bleed);
    const pageCase = overTrim.max >= overBleed.max ? { past: 'trim' as const, o: overTrim } : { past: 'bleed' as const, o: overBleed };
    if (pageCase.o.max >= MIN_EXCESS_MM * mmPx) {
      warnings.push(outsideWarning(f, rf, pageCase.past, undefined, pageCase.o, mmPx, base, where, locale, byName, moveIsClear(f.name)));
      events.push({ frame: f.name, kind: 'outside', toMm: r1(pageCase.o.max / mmPx), past: pageCase.past });
    }
    // Anchored inside another frame or a group.
    const host = insideHost(rf, input, hostHere, (n) => resolved.get(n)?.overlap === 'allow');
    if (!host) continue;
    const o = overrun(ink.map((i) => i.box), host.box);
    if (o.max < MIN_EXCESS_MM * mmPx) continue;
    const past = byName.has(host.target) ? 'frame' as const : 'group' as const;
    warnings.push(outsideWarning(f, rf, past, host.target, o, mmPx, base, where, locale, byName, moveIsClear(f.name)));
    events.push({ frame: f.name, kind: 'outside', toMm: r1(o.max / mmPx), past: `#${host.target}` });
  }
  return { warnings, events };
}

/** A covering pair the check found. */
interface CoverPair {
  under: VDTFrame;
  over: VDTFrame;
  /** px². */
  area: number;
  words?: string;
  picture?: string;
  hitLine: boolean;
  /** The covered frame's ink that is hit, and the covering ink over it. */
  hitBoxes: Rect[];
  hitCovers: Rect[];
}

/** A frame's ink on the sheet: all it paints, and what of it hides what is
 *  under it. */
interface FrameInk {
  all: Ink[];
  covers: Ink[];
}

/** What the page would be with `moved` shifted by (dx, dy) px (#1075):
 *  `clear`, the pair `target` no longer covers; `outside`, a moved frame
 *  runs further past what holds it; `blockers`, pieces of ink (`m` of a
 *  moved frame, where it lies now; `b` of another) that would cover each
 *  other in a pair no warning names. */
type MoveTest = (moved: ReadonlySet<string>, dx: number, dy: number, target?: string) => { clear: boolean; outside: boolean; blockers: Array<{ m: Rect; b: Rect }> };

const pairKey = (under: string, over: string): string => `${under}<${over}`;

/** The cuts of `ink` by `covers` deeper than `depth` on both sides. A
 *  covering picture with a shape (#1123) cuts by its rows: the pieces
 *  under them, deeper than `depth` taken together. */
function inkCuts(ink: Ink, covers: readonly Ink[], depth: number): Array<{ cut: Rect; c: Ink }> {
  return covers.flatMap((c) => {
    // A line over a picture hides a hairline of it, not the picture:
    // whether the words read on it is the contrast check's matter.
    if (ink.kind === 'picture' && c.kind === 'text') return [];
    const cut = intersect(ink.box, c.box);
    if (!cut || cut.width < depth || cut.height < depth) return [];
    if (!c.shape) return [{ cut, c }];
    const pieces = c.shape.flatMap((r) => intersect(ink.box, r) ?? []);
    if (pieces.length === 0) return [];
    const x0 = Math.min(...pieces.map((p) => p.x));
    const y0 = Math.min(...pieces.map((p) => p.y));
    const x1 = Math.max(...pieces.map((p) => p.x + p.width));
    const y1 = Math.max(...pieces.map((p) => p.y + p.height));
    if (x1 - x0 < depth || y1 - y0 < depth) return [];
    return pieces.map((p) => ({ cut: p, c }));
  });
}

/** The frame or group a frame is anchored inside (a nine-point anchor on
 *  `'#name'` whose point, offset added, lies in that box), and its box as
 *  `hostOf` gives it. An `'allow'` host is not one. */
function insideHost(rf: ResolvedFrame, input: OverlapCheckInput, hostOf: (name: string) => Rect | undefined, allows: (name: string) => boolean): { target: string; box: Rect } | undefined {
  const target = rf.grid ? undefined : anchorTarget(rf.placement);
  if (!target || !rf.placement) return undefined;
  const edge = physicalEdge(rf.placement.anchor.edge, false);
  if (ELEMENT_EDGES.has(edge)) return undefined;
  const hostBox = hostOf(target);
  if (!hostBox || allows(target)) return undefined;
  const a = anchorOn(edge, hostBox, true);
  const ax = a.x + lengthPx(rf.placement.offset?.x, input.dpi, input.emPx);
  const ay = a.y + lengthPx(rf.placement.offset?.y, input.dpi, input.emPx);
  const eps = 0.5;
  if (ax < hostBox.x - eps || ax > hostBox.x + hostBox.width + eps || ay < hostBox.y - eps || ay > hostBox.y + hostBox.height + eps) return undefined;
  return { target, box: hostBox };
}

/** A frame's box on the sheet: its content box put there by its matrix. */
function hostRect(f: VDTFrame): Rect {
  return mapRect(frameContentRect(f), frameMatrix(f));
}

const lengthPx = (d: Dimension | undefined, dpi: number, emPx: number): number => (d ? dimensionToPx(d, dpi, emPx) : 0);

interface Overrun {
  top: number;
  right: number;
  bottom: number;
  left: number;
  max: number;
  /** The ink is no wider (`fitsX`) or taller (`fitsY`) than the limit: a
   *  move can bring it in along that axis. */
  fitsX: boolean;
  fitsY: boolean;
}

/** How far the union of `boxes` runs past `limit` on each side, px. */
function overrun(boxes: readonly Rect[], limit: Rect): Overrun {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
    top = Math.max(top, limit.y - b.y);
    left = Math.max(left, limit.x - b.x);
    bottom = Math.max(bottom, b.y + b.height - (limit.y + limit.height));
    right = Math.max(right, b.x + b.width - (limit.x + limit.width));
  }
  return { top, right, bottom, left, max: Math.max(top, right, bottom, left), fitsX: x1 - x0 <= limit.width + 0.5, fitsY: y1 - y0 <= limit.height + 0.5 };
}

function outsideWarning(
  f: VDTFrame,
  rf: ResolvedFrame,
  past: 'trim' | 'bleed' | 'frame' | 'group',
  target: string | undefined,
  o: Overrun,
  mmPx: number,
  base: (f: VDTFrame) => { template: string; frame: string; fenceIndex: number; configPath: string },
  where: (f: VDTFrame) => { sourceStart?: number; sourceEnd?: number; pageIndex: number },
  locale: { locale?: string },
  byName: ReadonlyMap<string, VDTFrame>,
  /** Whether a shift (px) of the frame lands clear of the page's other
   *  frames (#1075). */
  moveIsClear: (dx: number, dy: number) => boolean,
): ContentWarning {
  const mm = (px: number): number | undefined => (px >= MIN_EXCESS_MM * mmPx ? r1(px / mmPx) : undefined);
  const sides: { top?: number; right?: number; bottom?: number; left?: number } = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const v = mm(o[side]);
    if (v !== undefined) sides[side] = v;
  }
  const proposals: FrameOutsideProposal[] = [];
  // Which side of its box the frame's placement holds: a smaller height
  // brings a frame held by its top in at the foot, half as much one held
  // by its middle, and none held by its foot.
  const pinY = rf.grid || !rf.placement ? 'start' : anchorOn(physicalEdge(rf.placement.anchor.edge, false), { x: 0, y: 0, width: 1, height: 1 }, anchorTarget(rf.placement) !== undefined).pinY;
  const min = MIN_EXCESS_MM * mmPx;
  if (o.bottom >= min && !f.rotate && pinY !== 'end') {
    // The frame held to the room it has: its height less what runs past,
    // in whole millimetres down.
    const room = Math.floor((f.rect.height - (pinY === 'middle' ? 2 : 1) * o.bottom) / mmPx);
    if (room > 0) {
      proposals.push({ kind: 'maxHeight', path: `${f.configPath}/maxHeight`, value: mmDim(room) });
      const holdsText = f.blockIds.length > 1;
      if (holdsText && !rf.overflow.continueIn && !rf.next) proposals.push({ kind: 'continueNextPage', path: `${f.configPath}/overflow/continueIn`, value: 'next-page' });
    }
    // The frame it is anchored inside grown to hold it.
    const host = target !== undefined ? byName.get(target) : undefined;
    if (host && !host.rotate) {
      const need = Math.ceil((host.rect.height + o.bottom) / mmPx);
      proposals.push({ kind: 'minHeight', path: `${host.configPath}/minHeight`, value: mmDim(need), frame: host.name });
    }
  }
  // The shift that brings it in, when only one side of each axis runs
  // past (data only).
  const dx = !o.fitsX ? 0 : o.left >= min && o.right < min ? o.left : o.right >= min && o.left < min ? -o.right : 0;
  const dy = !o.fitsY ? 0 : o.top >= min && o.bottom < min ? o.top : o.bottom >= min && o.top < min ? -o.bottom : 0;
  // Proposed only where it lands clear of the page's other frames (#1075).
  const dxMm = r1(dx / mmPx) + 0;
  const dyMm = r1(dy / mmPx) + 0;
  if ((dx !== 0 || dy !== 0) && moveIsClear(dxMm * mmPx, dyMm * mmPx)) proposals.push({ kind: 'move', frame: f.name, dxMm, dyMm });
  return {
    kind: 'frameOutsideArea',
    ...base(f),
    past,
    ...(target !== undefined ? { target } : {}),
    excessMm: r1(o.max / mmPx),
    sides,
    ...locale,
    proposals,
    ...where(f),
  };
}

const mmDim = (value: number): Dimension => ({ value, unit: 'mm' });

/** Up to this many times a move is pushed on past the frame it would land
 *  on before the direction is given up. */
const MAX_MOVE_STEPS = 8;

/** `mm` rounded away from zero to 0.1 mm: a proposal never falls short. */
const ceil1 = (mm: number): number => Math.ceil(mm * 10 - 1e-6) / 10;

/**
 * The smallest shift of the covering frame along one axis that takes its
 * ink off the covered ink and lands clear (#1075), in mm; undefined when no
 * direction does. Each of the four directions starts at the distance that
 * takes the covering boxes off the covered ones; where `test` finds that the
 * moved frames would come to cover another frame (or be covered by one), the
 * move goes on past that frame's ink and is tested again; a direction stops
 * when the pair is not cleared or a moved frame runs past what holds it.
 */
function clearingMove(covered: readonly Rect[], covers: readonly Rect[], mmPx: number, test: (dx: number, dy: number) => ReturnType<MoveTest>): { dxMm: number; dyMm: number } | undefined {
  if (covered.length === 0 || covers.length === 0) return undefined;
  const u = (rs: readonly Rect[]): Rect => {
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y };
  };
  const a = u(covered);
  const c = u(covers);
  /** Each direction: its unit vector, the distance that takes the covers
   *  off the covered ink, and the distance that takes a moved piece `m`
   *  past a piece `b` (px). */
  const directions: Array<{ ux: number; uy: number; start: number; past: (m: Rect, b: Rect) => number }> = [
    { ux: 1, uy: 0, start: a.x + a.width - c.x, past: (m, b) => b.x + b.width - m.x },
    { ux: -1, uy: 0, start: c.x + c.width - a.x, past: (m, b) => m.x + m.width - b.x },
    { ux: 0, uy: 1, start: a.y + a.height - c.y, past: (m, b) => b.y + b.height - m.y },
    { ux: 0, uy: -1, start: c.y + c.height - a.y, past: (m, b) => m.y + m.height - b.y },
  ];
  let best: { mm: number; dxMm: number; dyMm: number } | undefined;
  for (const d of directions) {
    let mm = ceil1(Math.max(0, d.start) / mmPx);
    for (let step = 0; step < MAX_MOVE_STEPS && mm > 0 && (!best || mm < best.mm); step++) {
      const t = test(d.ux * mm * mmPx, d.uy * mm * mmPx);
      if (!t.clear || t.outside) break;
      if (t.blockers.length === 0) {
        best = { mm, dxMm: d.ux * mm, dyMm: d.uy * mm };
        break;
      }
      const next = ceil1(Math.max(...t.blockers.map((p) => d.past(p.m, p.b))) / mmPx);
      if (!(next > mm)) break;
      mm = next;
    }
  }
  // `+ 0` turns a -0 into 0.
  return best ? { dxMm: best.dxMm + 0, dyMm: best.dyMm + 0 } : undefined;
}
