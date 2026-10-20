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
import type { ContentWarning, FrameCoverProposal, FrameOutsideProposal, ReflowEvent, VDTBlock, VDTDesignBlock, VDTFrame } from '../vdt';
import type { Dimension } from '../types';
import { physicalEdge } from '../design/logicalEdges';
import { dimensionToPx } from '../units';
import { anchorOn, type FrameAreas, type Rect } from './geometry';
import { frameClips, frameContentRect, frameMatrix } from './paint';
import { anchorTarget } from './templates';
import type { ResolvedFrame, ResolvedPageTemplate } from './types';

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
  return b.kind === 'box' && !opaque(b.box.backgroundColor) && !!b.box.borderColor && b.box.borderWidthPx > 0;
}

/** The ink of one frame, in its blocks' own (laid-out) coordinates: what
 *  it paints. `covering` leaves out outlines (they hide only a hairline)
 *  and keeps what hides what is under it. */
function frameInk(blocks: readonly VDTBlock[], covering: boolean): Ink[] {
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
      if (rb.kind === 'bitmap' || rb.kind === 'svg' || rb.kind === 'video') out.push({ box: body, kind: 'picture', resourceId: rb.resource.id });
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
      return cut ? [{ ...ink, box: mapRect(cut, m) }] : [];
    });
    const rules: Ink[] = (f.rules ?? []).map((r) => ({ box: { ...r.bbox }, kind: 'fill' as const }));
    inkOf.set(f.name, { all: [...place(frameInk(blocks, false)), ...rules], covers: place(frameInk(blocks, true)) });
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
  for (const under of live) {
    const ru = resolved.get(under.name)!;
    if (ru.overlap === 'allow') continue;
    const covered = inkOf.get(under.name)!.all.filter((i) => i.kind !== 'fill');
    if (covered.length === 0) continue;
    for (const over of live) {
      if (over === under || !later(under, over)) continue;
      const ro = resolved.get(over.name)!;
      if (ro.overlap === 'allow') continue;
      // Text set round a frame's pictures (`wrap: 'contour'`) comes into
      // their box by design: the contour, not the box, keeps it clear.
      const contourWrap = ro.exclude === 'push' && ro.wrap === 'contour';
      const covers = inkOf.get(over.name)!.covers.filter((c) => !(contourWrap && c.kind === 'picture'));
      if (covers.length === 0) continue;
      let area = 0;
      let words: string | undefined;
      let picture: string | undefined;
      let hitLine = false;
      const hitBoxes: Rect[] = [];
      const hitCovers: Rect[] = [];
      for (const ink of covered) {
        const cuts = covers.flatMap((c) => {
          // A line over a picture hides a hairline of it, not the picture:
          // whether the words read on it is the contrast check's matter.
          if (ink.kind === 'picture' && c.kind === 'text') return [];
          const cut = intersect(ink.box, c.box);
          return cut && cut.width >= depth && cut.height >= depth ? [{ cut, c }] : [];
        });
        if (cuts.length === 0) continue;
        area += unionArea(cuts.map((x) => x.cut));
        hitBoxes.push(ink.box);
        for (const x of cuts) hitCovers.push(x.c.box);
        if (ink.kind === 'text') {
          if (ink.flow === 'line') hitLine = true;
          if (ink.text !== undefined) words = words === undefined ? ink.text : words.length < 40 ? `${words} ${ink.text}` : words;
        } else if (picture === undefined && ink.resourceId) picture = ink.resourceId;
      }
      const areaMm2 = r1(area / (mmPx * mmPx));
      if (areaMm2 < MIN_AREA_MM2) continue;
      const proposals: FrameCoverProposal[] = [];
      // Painted under it, the covering frame is hidden in turn wherever the
      // covered one is opaque (a fill, a picture): proposed only where the
      // covered frame has nothing but text over it.
      const underOpaque = inkOf.get(under.name)!.covers.filter((c) => c.kind !== 'text');
      const swaps = underOpaque.some((u) => covers.some((c) => {
        const cut = intersect(u.box, c.box);
        return cut !== undefined && cut.width >= depth && cut.height >= depth;
      }));
      if (!swaps) proposals.push({ kind: 'layer', path: `${over.configPath}/layer`, value: under.layer - 1 });
      // Body lines run round a frame that pushes; a caption or a tab do not.
      if (hitLine && ro.exclude !== 'push' && ro.rotate === 0 && !over.writingMode) proposals.push({ kind: 'exclude', path: `${over.configPath}/exclude`, value: 'push' });
      const move = clearingMove(hitBoxes, hitCovers);
      if (move) proposals.push({ kind: 'move', frame: over.name, dxMm: r1(move.dx / mmPx), dyMm: r1(move.dy / mmPx) });
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
  }

  // frameOutsideArea: past the trim (text) or the bleed (fills, pictures),
  // and past the box it is anchored inside.
  const byName = new Map(live.map((f) => [f.name, f]));
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
      warnings.push(outsideWarning(f, rf, pageCase.past, undefined, pageCase.o, mmPx, input, base, where, locale, byName));
      events.push({ frame: f.name, kind: 'outside', toMm: r1(pageCase.o.max / mmPx), past: pageCase.past });
    }
    // Anchored inside another frame or a group.
    const target = rf.grid ? undefined : anchorTarget(rf.placement);
    if (!target || !rf.placement) continue;
    const edge = physicalEdge(rf.placement.anchor.edge, false);
    if (ELEMENT_EDGES.has(edge)) continue;
    const host = byName.get(target);
    const hostBox = host ? hostRect(host) : input.groupRects.get(target);
    if (!hostBox || (host && resolved.get(host.name)?.overlap === 'allow')) continue;
    const a = anchorOn(edge, hostBox, true);
    const ox = lengthPx(rf.placement.offset?.x, dpi, input.emPx);
    const oy = lengthPx(rf.placement.offset?.y, dpi, input.emPx);
    const eps = 0.5;
    const ax = a.x + ox;
    const ay = a.y + oy;
    if (ax < hostBox.x - eps || ax > hostBox.x + hostBox.width + eps || ay < hostBox.y - eps || ay > hostBox.y + hostBox.height + eps) continue;
    const o = overrun(ink.map((i) => i.box), hostBox);
    if (o.max < MIN_EXCESS_MM * mmPx) continue;
    const past = host ? 'frame' as const : 'group' as const;
    warnings.push(outsideWarning(f, rf, past, target, o, mmPx, input, base, where, locale, byName));
    events.push({ frame: f.name, kind: 'outside', toMm: r1(o.max / mmPx), past: `#${target}` });
  }
  return { warnings, events };
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
}

/** How far the union of `boxes` runs past `limit` on each side, px. */
function overrun(boxes: readonly Rect[], limit: Rect): Overrun {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  for (const b of boxes) {
    top = Math.max(top, limit.y - b.y);
    left = Math.max(left, limit.x - b.x);
    bottom = Math.max(bottom, b.y + b.height - (limit.y + limit.height));
    right = Math.max(right, b.x + b.width - (limit.x + limit.width));
  }
  return { top, right, bottom, left, max: Math.max(top, right, bottom, left) };
}

function outsideWarning(
  f: VDTFrame,
  rf: ResolvedFrame,
  past: 'trim' | 'bleed' | 'frame' | 'group',
  target: string | undefined,
  o: Overrun,
  mmPx: number,
  input: OverlapCheckInput,
  base: (f: VDTFrame) => { template: string; frame: string; fenceIndex: number; configPath: string },
  where: (f: VDTFrame) => { sourceStart?: number; sourceEnd?: number; pageIndex: number },
  locale: { locale?: string },
  byName: ReadonlyMap<string, VDTFrame>,
): ContentWarning {
  const mm = (px: number): number | undefined => (px >= MIN_EXCESS_MM * mmPx ? r1(px / mmPx) : undefined);
  const sides: { top?: number; right?: number; bottom?: number; left?: number } = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const v = mm(o[side]);
    if (v !== undefined) sides[side] = v;
  }
  const proposals: FrameOutsideProposal[] = [];
  if (o.bottom >= MIN_EXCESS_MM * mmPx && !f.rotate) {
    // The frame held to the room it has: its height less what runs past,
    // in whole millimetres down.
    const room = Math.floor((f.rect.height - o.bottom) / mmPx);
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

/** The smallest shift of the covering boxes along one axis that takes them
 *  off the covered ones (px), or undefined when there is nothing to clear. */
function clearingMove(covered: readonly Rect[], covers: readonly Rect[]): { dx: number; dy: number } | undefined {
  if (covered.length === 0 || covers.length === 0) return undefined;
  const u = (rs: readonly Rect[]): Rect => {
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y };
  };
  const a = u(covered);
  const c = u(covers);
  const options = [
    { dx: a.x + a.width - c.x, dy: 0 },
    { dx: a.x - (c.x + c.width), dy: 0 },
    { dx: 0, dy: a.y + a.height - c.y },
    { dx: 0, dy: a.y - (c.y + c.height) },
  ];
  options.sort((p, q) => Math.abs(p.dx) + Math.abs(p.dy) - (Math.abs(q.dx) + Math.abs(q.dy)));
  return options[0];
}
