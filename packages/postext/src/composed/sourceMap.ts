/**
 * The source map of a laid-out document (#857, DESIGN §6): what a point of
 * a page shows and where it is written, and the reverse, what a range of
 * the Markdown became on the pages.
 *
 * Nothing here lays anything out: it reads what the layout stamped on the
 * VDT. Body text (in the flow or in a frame) carries `sourceMap` per block
 * and `plainStart`/`plainEnd` per line; a chip carries the offsets of its
 * words (`VDTChip.sourceOffsets`); a frame its template entry
 * (`VDTFrame.configPath`) and the range of its slot's content; a composed
 * page its template and its page fence; a design block (decoration, running
 * heads) its element (`elementId`, `configPath`) and, when it shows an
 * attribute, the attribute's name and value range (`attr`); a contents
 * entry the heading it lists (`tocEntry.headingSource`).
 *
 * `sourceAt` answers with the innermost element first and its ancestors
 * after it (text → paragraph → frame → group → template), each with a
 * stable id ({@link ./ids}), so a host can widen a selection level by
 * level and find the same element again after a relayout or in another
 * locale of the chapter.
 */
import type { BoundingBox, VDTBlock, VDTComposedPage, VDTDesignBlock, VDTDesignSlot, VDTDesignTextBlock, VDTDocument, VDTFrame, VDTLine, VDTLineSegment, VDTPage } from '../vdt';
import { lineTextAlign, pageIsMirrored, pageToFlow } from '../vdt';
import { resolvePageTemplate } from './templates';
import { composedPaintOrder, frameMatrix } from './paint';
import { composedPageElementId, designElementId, groupElementId } from './ids';

/** Where something painted comes from. Markdown offsets are absolute in
 *  the chapter file (front matter counted), as every `sourceStart` of the
 *  VDT; `file` is the host's name for that file, when it gave one. */
export type SourceRef =
  | { kind: 'markdown'; start: number; end: number; file?: string }
  | { kind: 'config'; path: string }
  | { kind: 'attr'; name: string; start: number; end: number; file?: string }
  | { kind: 'resource'; resourceId: string; anchor?: string };

/** The selection level of a {@link SourceElement}, innermost first:
 *  `text` a glyph (or a chip, a reference, a formula: one unit of a line),
 *  `attr` an attribute an element shows, `resource` a picture,
 *  `line` a line of text, `block` a paragraph, heading, list item, picture
 *  block…, `box` a callout around it, `frame` a frame of a composed page,
 *  `group` a group of frames, `design` an element of a design slot,
 *  `slot` that slot (decoration, header, footer), `template` the composed
 *  page and its template. */
export type SourceLevel = 'text' | 'attr' | 'resource' | 'line' | 'block' | 'box' | 'frame' | 'group' | 'design' | 'slot' | 'template';

export interface SourceElement {
  level: SourceLevel;
  /** Stable on a composed page (`cp<fence>:…`): the same across relayouts
   *  and in every locale of the chapter. Elsewhere the block's id. */
  id: string;
  source: SourceRef;
  /** The Markdown the element holds, when that is not its `source`: a
   *  frame's slot content, a composed page's fence, a box's fence. */
  content?: { start: number; end: number };
  /** The element's box on the page (px): upright, before its frame's turn
   *  (`rotate`). In the page's flow frame for flow text on a vertical or
   *  right-to-left page, as the VDT has it. */
  rect?: BoundingBox;
  /** Degrees the element's frame is turned, clockwise about the frame's
   *  centre; absent when upright. */
  rotate?: number;
  /** A contents entry (`:::toc`): where the heading it lists starts in its
   *  chapter's Markdown body (front matter not counted, as outlines count). */
  heading?: number;
  /** Set on an element laid past its frame's foot: kept in the source map,
   *  clipped on the page (`frameOverflow`). */
  clipped?: true;
}

export interface SourceMapOptions {
  /** The file each page's Markdown offsets belong to: the chapter's name,
   *  or one per page for a document stitched from several chapters. */
  file?: string | ((pageIndex: number) => string | undefined);
}

type Point = { x: number; y: number };

const inside = (r: BoundingBox | { x: number; y: number; width: number; height: number }, p: Point, slop = 0): boolean =>
  p.x >= r.x - slop && p.x <= r.x + r.width + slop && p.y >= r.y - slop && p.y <= r.y + r.height + slop;

const fileOf = (options: SourceMapOptions | undefined, pageIndex: number): { file?: string } => {
  const f = typeof options?.file === 'function' ? options.file(pageIndex) : options?.file;
  return f !== undefined ? { file: f } : {};
};

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

/** A segment of a line where the renderers paint it (as the Sandbox's
 *  `placeLineSegments` reads the canvas painter): `x` and its advance, and
 *  the plain characters it stands for (`plainStart` relative to the line). */
interface PlacedSegment {
  seg: VDTLineSegment;
  index: number;
  x: number;
  width: number;
  plainStart: number;
  plainLen: number;
}

/** The plain characters a segment stands for: none for what the layout
 *  added (a book title's brackets, a tab leader, the hyphen of a break),
 *  one for a reference, a swatch, a chip, a formula. */
function segmentPlainLength(seg: VDTLineSegment, dropTrailingHyphen: boolean, dropLeadingHyphen: boolean): number {
  if (seg.refContinues || seg.inserted || seg.leader !== undefined) return 0;
  if (seg.refResourceId !== undefined || seg.kind === 'swatch') return 1;
  let len = seg.text.length - (seg.kashida?.length ?? 0);
  if (dropLeadingHyphen && seg.text.startsWith('-')) len--;
  if (dropTrailingHyphen && seg.text.endsWith('-') && len > 0) len--;
  return Math.max(0, len);
}

function placeSegments(block: VDTBlock, line: VDTLine): PlacedSegment[] {
  const segs = line.segments ?? [];
  if (segs.length === 0) return [];
  const span = line.measure;
  const lineX = span ? span.x : line.bbox.x;
  const effectiveWidth = span ? span.width : block.bbox.x + block.bbox.width - lineX;
  let natural = 0;
  let words = 0;
  let spaces = 0;
  for (const s of segs) {
    natural += s.width;
    if (s.kind === 'space') spaces++;
    else words += s.width;
  }
  const justify = block.textAlign === 'justify' && spaces > 0 && !line.tabbed
    && ((line.isLastLine === false && !line.ragged) || natural > effectiveWidth);
  const spaceWidth = justify ? (effectiveWidth - words) / spaces : undefined;
  const align = lineTextAlign(line, block.textAlign);
  const slack = Math.max(0, effectiveWidth - natural);
  const start = lineX + (justify ? 0 : align === 'center' ? slack / 2 : align === 'right' ? slack : 0);
  const widths = segs.map((s) => (s.kind === 'space' && spaceWidth !== undefined ? spaceWidth : s.width));
  const order = line.order && line.order.length === segs.length ? line.order : segs.map((_, i) => i);
  const xs = new Array<number>(segs.length).fill(start);
  let x = start;
  for (const i of order) {
    xs[i] = x;
    x += widths[i]!;
  }
  const out: PlacedSegment[] = [];
  const dropTrailing = line.hyphenated === true && line.hardHyphen !== true;
  let cum = 0;
  segs.forEach((seg, i) => {
    const plainLen = segmentPlainLength(seg, i === segs.length - 1 && dropTrailing, i === 0 && line.repeatedHyphen === true);
    out.push({ seg, index: i, x: xs[i]!, width: widths[i]!, plainStart: cum, plainLen });
    cum += plainLen;
  });
  return out;
}

/** The source offset of plain character `plain` (block-relative, its
 *  number prefix counted) of `block`. */
function sourceOfPlain(block: VDTBlock, plain: number): number | undefined {
  const map = block.sourceMap;
  if (!map || map.length === 0) return undefined;
  const k = plain - (block.plainPrefixLen ?? 0);
  if (k < 0) return map[0];
  return map[Math.min(k, map.length - 1)];
}

/** The source range of the glyph of `block`'s line under `x` (flow
 *  frame), with the plain offset it stands at; undefined off the text. */
function glyphAt(block: VDTBlock, line: VDTLine, x: number): { start: number; end: number; plain: number } | undefined {
  if (line.plainStart === undefined || line.plainEnd === undefined) return undefined;
  const placed = placeSegments(block, line).filter((p) => p.plainLen > 0);
  if (placed.length === 0) return undefined;
  let hit = placed[0]!;
  let best = Infinity;
  for (const p of placed) {
    const d = x < p.x ? p.x - x : x > p.x + p.width ? x - p.x - p.width : 0;
    if (d < best) { best = d; hit = p; }
    if (d === 0) break;
  }
  const seg = hit.seg;
  const along = Math.max(0, Math.min(hit.width, x - hit.x));
  const rtl = seg.rtl === true;
  const plainOf = (k: number) => line.plainStart! + hit.plainStart + k;
  // A chip: the character of its words under `x`, through its own map.
  if (seg.chip) {
    const chipAt = sourceOfPlain(block, plainOf(0));
    if (chipAt === undefined) return undefined;
    const chip = seg.chip;
    const offsets = chip.sourceOffsets;
    const nextAt = sourceOfPlain(block, plainOf(1));
    const whole = { start: chipAt, end: nextAt !== undefined && nextAt > chipAt ? nextAt : chipAt + 1, plain: plainOf(0) };
    if (!offsets) return whole;
    let rx = hit.x + chip.marginLeft + chip.paddingX + chip.borderWidth;
    let k = 0;
    const order = chip.order ?? chip.runs.map((_, i) => i);
    const logicalStart: number[] = [];
    let acc = 0;
    for (const r of chip.runs) { logicalStart.push(acc); acc += r.text.length; }
    for (const ri of order) {
      const run = chip.runs[ri]!;
      if (x <= rx + run.width || ri === order[order.length - 1]) {
        const n = run.text.length;
        const frac = run.width > 0 ? Math.max(0, Math.min(0.9999, (x - rx) / run.width)) : 0;
        const at = Math.floor((run.rtl ? 1 - frac : frac) * n);
        k = logicalStart[ri]! + Math.max(0, Math.min(n - 1, at));
        break;
      }
      rx += run.width;
    }
    const off = offsets[k];
    return off === undefined ? whole : { start: chipAt + off, end: chipAt + off + 1, plain: plainOf(0) };
  }
  // A placeholder (reference, swatch, formula): the whole construct, up to
  // the next character's source.
  if (hit.plainLen === 1 && (seg.refResourceId !== undefined || seg.kind === 'swatch' || seg.kind === 'math' || seg.text.length !== 1)) {
    const at = sourceOfPlain(block, plainOf(0));
    if (at === undefined) return undefined;
    const next = sourceOfPlain(block, plainOf(1));
    return { start: at, end: next !== undefined && next > at ? next : at + 1, plain: plainOf(0) };
  }
  const frac = hit.width > 0 ? Math.max(0, Math.min(0.9999, along / hit.width)) : 0;
  const k = Math.min(hit.plainLen - 1, Math.floor((rtl ? 1 - frac : frac) * hit.plainLen));
  const at = sourceOfPlain(block, plainOf(k));
  if (at === undefined) return undefined;
  return { start: at, end: at + 1, plain: plainOf(k) };
}

/** The line of `block` under `y` (the nearest one in a gap). */
function lineAt(block: VDTBlock, y: number): { line: VDTLine; index: number } | undefined {
  let best: { line: VDTLine; index: number } | undefined;
  let bestDy = Infinity;
  block.lines.forEach((line, index) => {
    const top = line.bbox.y;
    const bot = top + line.bbox.height;
    const dy = y < top ? top - y : y > bot ? y - bot : 0;
    if (dy < bestDy) { bestDy = dy; best = { line, index }; }
  });
  return best;
}

/** The source range a line covers. */
function lineRange(block: VDTBlock, line: VDTLine): { start: number; end: number } | undefined {
  if (line.plainStart !== undefined && line.plainEnd !== undefined && line.plainEnd > line.plainStart) {
    const a = sourceOfPlain(block, line.plainStart);
    const b = sourceOfPlain(block, line.plainEnd - 1);
    if (a !== undefined && b !== undefined) return { start: Math.min(a, b), end: Math.max(a, b) + 1 };
  }
  if (line.sourceStart !== undefined && line.sourceEnd !== undefined) return { start: line.sourceStart, end: line.sourceEnd };
  return undefined;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const blockElement = (block: VDTBlock, file: { file?: string }): SourceElement | undefined => {
  if (block.sourceStart === undefined || block.sourceEnd === undefined) return undefined;
  return {
    level: block.type === 'callout' ? 'box' : 'block',
    id: block.id,
    source: { kind: 'markdown', start: block.sourceStart, end: block.sourceEnd, ...file },
    rect: { ...block.bbox },
    ...(block.tocEntry?.headingSource !== undefined ? { heading: block.tocEntry.headingSource } : {}),
  };
};

/** What a text block of the body shows at `p` (flow frame): the glyph, the
 *  line and the block, innermost first. */
function textChain(block: VDTBlock, p: Point, file: { file?: string }): SourceElement[] {
  const out: SourceElement[] = [];
  if (block.resourceBlock) {
    out.push({ level: 'resource', id: `${block.id}:resource`, source: { kind: 'resource', resourceId: block.resourceBlock.resource.id }, rect: { ...block.bbox } });
  } else {
    const hit = lineAt(block, p.y);
    if (hit) {
      const glyph = glyphAt(block, hit.line, p.x);
      if (glyph) out.push({ level: 'text', id: `${block.id}@${glyph.plain}`, source: { kind: 'markdown', start: glyph.start, end: glyph.end, ...file } });
      const range = lineRange(block, hit.line);
      if (range) out.push({ level: 'line', id: `${block.id}:l${hit.index}`, source: { kind: 'markdown', ...range, ...file }, rect: { ...hit.line.bbox } });
    }
  }
  const el = blockElement(block, file);
  if (el) out.push(el);
  return out;
}

/** The boxes enclosing `block` among `boxes` (innermost first). */
function enclosingBoxes(block: VDTBlock, boxes: readonly VDTBlock[], file: { file?: string }): SourceElement[] {
  const out: SourceElement[] = [];
  let id = block.id;
  for (let guard = 0; guard < 32; guard++) {
    const parent = boxes.find((b) => b.callout?.childIds.includes(id));
    if (!parent) break;
    const el = blockElement(parent, file);
    if (el) out.push({ ...el, level: 'box' });
    id = parent.id;
  }
  return out;
}

/** A design text block's glyph under `p`: its per-character map when it
 *  has one (lines laid from its bbox's left, their `xOffset`), else its
 *  whole range. */
function designTextSource(b: VDTDesignTextBlock, p: Point): { start: number; end: number } | undefined {
  if (b.sourceStart === undefined || b.sourceEnd === undefined) return undefined;
  const map = b.sourceMap;
  const text = b.sourceText;
  if (!map || !text || map.length !== text.length || b.lines.length === 0) return { start: b.sourceStart, end: b.sourceEnd };
  // The printed lines are the source text cut at its line breaks / wraps.
  let best = 0;
  let bestDy = Infinity;
  const lineH = b.bbox.height / Math.max(1, b.lines.length);
  b.lines.forEach((l, i) => {
    const mid = l.baselineY - lineH * 0.35;
    const dy = Math.abs(p.y - mid);
    if (dy < bestDy) { bestDy = dy; best = i; }
  });
  let at = 0;
  for (let i = 0; i < best; i++) {
    const t = b.lines[i]!.text;
    const found = text.indexOf(t, at);
    at = found >= 0 ? found + t.length : at + t.length;
    while (at < text.length && /\s/.test(text[at]!)) at++;
  }
  const line = b.lines[best]!;
  const lineStart = text.indexOf(line.text, at) >= 0 ? text.indexOf(line.text, at) : at;
  const x0 = b.bbox.x + line.xOffset;
  const frac = line.width > 0 ? Math.max(0, Math.min(0.9999, (p.x - x0) / line.width)) : 0;
  const k = Math.min(text.length - 1, lineStart + Math.floor(frac * Math.max(1, line.text.length)));
  const s = map[Math.max(0, k)]!;
  return { start: s, end: s + 1 };
}

/** The chain of a design block at `p` (`idOf` names its element),
 *  innermost first, or undefined when `p` misses it. */
function designChain(
  b: VDTDesignBlock,
  index: number,
  p: Point,
  idOf: (element: string) => string,
  composed: VDTComposedPage | undefined,
  file: { file?: string },
): SourceElement[] | undefined {
  if (!inside(b.bbox, p)) return undefined;
  const out: SourceElement[] = [];
  const elementId = idOf(b.elementId ?? `#${index}`);
  if (b.kind === 'text') {
    const src = designTextSource(b, p);
    if (src) {
      out.push(b.attr !== undefined
        ? { level: 'text', id: `${elementId}@${src.start}`, source: { kind: 'attr', name: b.attr, ...src, ...file } }
        : { level: 'text', id: `${elementId}@${src.start}`, source: { kind: 'markdown', ...src, ...file } });
    }
  } else if (b.kind === 'image' && b.attr !== undefined && composed?.attrSources[b.attr]) {
    const a = composed.attrSources[b.attr]!;
    out.push({ level: 'attr', id: `${elementId}:attr`, source: { kind: 'attr', name: b.attr, start: a.sourceStart, end: a.sourceEnd, ...file } });
  }
  if (b.kind === 'image' && b.attr !== undefined && composed?.attrs[b.attr]) {
    out.push({ level: 'resource', id: `${elementId}:resource`, source: { kind: 'resource', resourceId: composed.attrs[b.attr]! } });
  }
  if (b.configPath !== undefined) out.push({ level: 'design', id: elementId, source: { kind: 'config', path: b.configPath }, rect: { ...b.bbox } });
  return out.length > 0 ? out : undefined;
}

/** The slot element of a design slot, by the pointer its blocks share
 *  (`…/elements/<i>` taken off). */
function slotElement(slot: VDTDesignSlot, id: string): SourceElement | undefined {
  const path = slot.blocks.find((b) => b.configPath !== undefined)?.configPath;
  const at = path?.lastIndexOf('/elements/') ?? -1;
  if (!path || at < 0) return undefined;
  return { level: 'slot', id, source: { kind: 'config', path: path.slice(0, at) }, rect: { ...slot.bbox } };
}

const resolvedTemplates = new WeakMap<VDTDocument, Map<string, ReturnType<typeof resolvePageTemplate>>>();

/** The template a composed page was set with, as the layout resolved it. */
function templateOf(doc: VDTDocument, page: VDTPage): ReturnType<typeof resolvePageTemplate> {
  const composed = page.composed!;
  const parity = (page.index + (doc.pageIndexOffset ?? 0)) % 2 === 0 ? 'recto' : 'verso';
  const key = `${composed.template}|${parity}`;
  let cache = resolvedTemplates.get(doc);
  if (!cache) { cache = new Map(); resolvedTemplates.set(doc, cache); }
  if (!cache.has(key)) {
    cache.set(key, resolvePageTemplate({ pageTemplates: doc.config.pageTemplates, calloutStyles: doc.config.calloutStyles }, composed.template, { parity }));
  }
  return cache.get(key);
}

/** The frame element, its groups and the template, for a frame of `page`. */
function frameAncestors(doc: VDTDocument, page: VDTPage, frame: VDTFrame): SourceElement[] {
  const composed = page.composed!;
  const out: SourceElement[] = [{
    level: 'frame',
    id: frame.id,
    source: { kind: 'config', path: frame.configPath },
    ...(frame.sourceStart !== undefined && frame.sourceEnd !== undefined ? { content: { start: frame.sourceStart, end: frame.sourceEnd } } : {}),
    rect: { ...frame.rect },
    ...(frame.rotate ? { rotate: frame.rotate } : {}),
  }];
  const template = templateOf(doc, page);
  for (const g of template?.groups ?? []) {
    if (!g.frames.includes(frame.name)) continue;
    out.push({ level: 'group', id: groupElementId(composed.fenceIndex, g.name), source: { kind: 'config', path: g.configPath } });
  }
  out.push(templateElement(composed));
  return out;
}

function templateElement(composed: VDTComposedPage): SourceElement {
  return {
    level: 'template',
    id: composedPageElementId(composed.fenceIndex),
    source: { kind: 'config', path: composed.configPath },
    content: { start: composed.sourceStart, end: composed.sourceEnd },
  };
}

/** `p` in the upright frame of a turned frame. */
function intoFrame(frame: VDTFrame, p: Point): Point {
  const m = frameMatrix(frame);
  if (!m) return p;
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const x = p.x - e;
  const y = p.y - f;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}

/** What a frame shows at `p` (page px), innermost first. */
function frameChain(doc: VDTDocument, page: VDTPage, frame: VDTFrame, blocks: readonly VDTBlock[], pagePoint: Point, file: { file?: string }): SourceElement[] | undefined {
  const p = intoFrame(frame, pagePoint);
  const box = blocks.find((b) => b.id === frame.blockIds[0] && b.type === 'callout');
  // The tab and title of the frame's box (above its top edge, for a tab).
  const overlay = box?.designOverlay;
  if (overlay) {
    for (let i = overlay.blocks.length - 1; i >= 0; i--) {
      const b = overlay.blocks[i]!;
      if (b.kind !== 'text' || !inside(b.bbox, p)) continue;
      const src = designTextSource(b, p);
      if (!src) continue;
      const source: SourceRef = b.attr !== undefined ? { kind: 'attr', name: b.attr, ...src, ...file } : { kind: 'markdown', ...src, ...file };
      return [{ level: 'text', id: `${frame.id}:${b.attr ?? 'title'}@${src.start}`, source }, ...frameAncestors(doc, page, frame)];
    }
  }
  if (!inside(frame.rect, p)) return undefined;
  const boxes = blocks.filter((b) => b.type === 'callout');
  // Content: the leaf block under `p` (text, a picture), then its boxes.
  for (const b of blocks) {
    if (b.type === 'callout' || b.hidden) continue;
    if (!inside(b.bbox, p)) continue;
    const chain = textChain(b, p, file);
    const nested = enclosingBoxes(b, boxes, file).filter((e) => e.id !== frame.blockIds[0]);
    return [...chain, ...nested, ...frameAncestors(doc, page, frame)];
  }
  return frameAncestors(doc, page, frame);
}

/**
 * What page `pageIndex` of `doc` shows at `(x, y)` (page px, the sheet's
 * top-left origin), innermost first, each element followed by the ones
 * that hold it: on a composed page a glyph, its line, its paragraph, the
 * boxes round it, its frame, the frame's groups and the template; a design
 * element and its slot; on any other page the flow's text, pictures and
 * boxes, the running heads. Empty when nothing is there.
 */
export function sourceAt(doc: VDTDocument, pageIndex: number, x: number, y: number, options?: SourceMapOptions): SourceElement[] {
  const page = doc.pages[pageIndex];
  if (!page) return [];
  const file = fileOf(options, pageIndex);
  const p = { x, y };
  const composed = page.composed;
  const furniture = (slot: VDTDesignSlot | undefined, name: 'header' | 'footer'): SourceElement[] | undefined => {
    if (!slot) return undefined;
    const idOf = (el: string) => (composed ? designElementId(composed.fenceIndex, name, el) : `p${pageIndex}:${name}:${el}`);
    for (let i = slot.blocks.length - 1; i >= 0; i--) {
      const chain = designChain(slot.blocks[i]!, i, p, idOf, composed, file);
      if (!chain) continue;
      const own = slotElement(slot, composed ? `cp${composed.fenceIndex}:${name}` : `p${pageIndex}:${name}`);
      return [...chain, ...(own ? [own] : []), ...(composed ? [templateElement(composed)] : [])];
    }
    return undefined;
  };
  // The running heads paint over everything else.
  const head = furniture(page.header, 'header') ?? furniture(page.footer, 'footer');
  if (head) return head;
  if (composed) {
    const items = composedPaintOrder(page);
    // Topmost first: the paint order read backwards.
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if (item.kind === 'frame') {
        const chain = frameChain(doc, page, item.frame, item.blocks, p, file);
        if (chain) return chain;
        continue;
      }
      const deco = composed.decoration;
      if (!deco) continue;
      for (let k = deco.blocks.length - 1; k >= 0; k--) {
        const chain = designChain(deco.blocks[k]!, k, p, (el) => designElementId(composed.fenceIndex, 'decoration', el), composed, file);
        if (!chain) continue;
        const own = slotElement(deco, `cp${composed.fenceIndex}:decoration`);
        return [...chain, ...(own ? [own] : []), templateElement(composed)];
      }
    }
    return inside({ x: 0, y: 0, width: page.width, height: page.height }, p) ? [templateElement(composed)] : [];
  }
  // The flow: blocks are in the page's flow frame.
  const fp = pageIsMirrored(page) || page.flow ? pageToFlow(page, x, y) : p;
  const onPage = doc.blocks.filter((b) => b.pageIndex === pageIndex);
  const floats = page.floats ?? [];
  const all = [...onPage, ...floats.filter((f) => !onPage.includes(f))];
  const boxes = all.filter((b) => b.type === 'callout');
  for (const b of all) {
    if (b.type === 'callout' || b.hidden || b.designOverlay) continue;
    if (!inside(b.bbox, fp)) continue;
    return [...textChain(b, fp, file), ...enclosingBoxes(b, boxes, file)];
  }
  for (const b of boxes) {
    if (!inside(b.bbox, fp)) continue;
    const el = blockElement(b, file);
    if (el) return [el, ...enclosingBoxes(b, boxes, file)];
  }
  return [];
}

/** An element {@link elementsForSource} found, on its page. */
export interface SourceMatch {
  pageIndex: number;
  element: SourceElement;
}

const meets = (a: { start: number; end: number }, start: number, end: number): boolean =>
  end > start ? a.start < end && a.end > start : a.start <= start && a.end >= start;

/**
 * Everything of `doc` laid out from the Markdown range `[start, end)`
 * (absolute offsets; an empty range finds what holds the offset): the
 * lines and blocks of text, the frames whose slot content it touches, the
 * composed pages whose fence it touches, the design text that shows an
 * attribute written there; in page order, frames and pages before their
 * content. Lines laid past their frame's foot come with `clipped`.
 */
export function elementsForSource(doc: VDTDocument, start: number, end: number, options?: SourceMapOptions): SourceMatch[] {
  const out: SourceMatch[] = [];
  const blockFrame = new Map<string, { frame: VDTFrame; page: VDTPage }>();
  for (const page of doc.pages) {
    const composed = page.composed;
    if (!composed) continue;
    const file = fileOf(options, page.index);
    if (meets({ start: composed.sourceStart, end: composed.sourceEnd }, start, end)) out.push({ pageIndex: page.index, element: templateElement(composed) });
    for (const frame of composed.frames) {
      for (const id of frame.blockIds) blockFrame.set(id, { frame, page });
      if (frame.sourceStart === undefined || frame.sourceEnd === undefined) continue;
      if (!meets({ start: frame.sourceStart, end: frame.sourceEnd }, start, end)) continue;
      out.push({ pageIndex: page.index, element: frameAncestors(doc, page, frame)[0]! });
    }
    for (const [name, slot] of [['decoration', composed.decoration], ['header', page.header], ['footer', page.footer]] as const) {
      slot?.blocks.forEach((b, i) => {
        if (b.kind !== 'text' || b.sourceStart === undefined || b.sourceEnd === undefined) return;
        if (!meets({ start: b.sourceStart, end: b.sourceEnd }, start, end)) return;
        out.push({
          pageIndex: page.index,
          element: {
            level: 'text',
            id: designElementId(composed.fenceIndex, name, b.elementId ?? `#${i}`),
            source: b.attr !== undefined ? { kind: 'attr', name: b.attr, start: b.sourceStart, end: b.sourceEnd, ...file } : { kind: 'markdown', start: b.sourceStart, end: b.sourceEnd, ...file },
            rect: { ...b.bbox },
          },
        });
      });
    }
  }
  const seen = new Set<string>();
  for (const block of doc.blocks) {
    if (block.sourceStart === undefined || block.sourceEnd === undefined || block.pageIndex < 0 || seen.has(block.id)) continue;
    seen.add(block.id);
    if (block.type === 'callout') continue;
    if (!meets({ start: block.sourceStart, end: block.sourceEnd }, start, end)) continue;
    const file = fileOf(options, block.pageIndex);
    const held = blockFrame.get(block.id);
    const foot = held ? held.frame.rect.y + held.frame.rect.height : Infinity;
    block.lines.forEach((line, index) => {
      const range = lineRange(block, line);
      if (!range || !meets(range, start, end)) return;
      out.push({
        pageIndex: block.pageIndex,
        element: {
          level: 'line',
          id: `${block.id}:l${index}`,
          source: { kind: 'markdown', ...range, ...file },
          rect: { ...line.bbox },
          ...(held?.frame.rotate ? { rotate: held.frame.rotate } : {}),
          ...(line.bbox.y + line.bbox.height > foot + 0.5 ? { clipped: true as const } : {}),
        },
      });
    });
    const el = blockElement(block, file);
    if (el) out.push({ pageIndex: block.pageIndex, element: { ...el, ...(held?.frame.rotate ? { rotate: held.frame.rotate } : {}) } });
  }
  return out.sort((a, b) => a.pageIndex - b.pageIndex);
}

/** The element of `doc` with stable id `id` (a frame `cp0:dinero`, a
 *  composed page `cp0`, a block, a design element `cp0:decoration:tema`),
 *  on its page: what a host looks up again after a relayout. */
export function findElement(doc: VDTDocument, id: string, options?: SourceMapOptions): SourceMatch | undefined {
  for (const page of doc.pages) {
    const composed = page.composed;
    if (!composed) continue;
    if (composedPageElementId(composed.fenceIndex) === id) return { pageIndex: page.index, element: templateElement(composed) };
    for (const frame of composed.frames) if (frame.id === id) return { pageIndex: page.index, element: frameAncestors(doc, page, frame)[0]! };
    for (const [name, slot] of [['decoration', composed.decoration], ['header', page.header], ['footer', page.footer]] as const) {
      const i = slot?.blocks.findIndex((b, k) => designElementId(composed.fenceIndex, name, b.elementId ?? `#${k}`) === id) ?? -1;
      const b = i >= 0 ? slot!.blocks[i]! : undefined;
      if (b) return { pageIndex: page.index, element: { level: 'design', id, source: b.configPath !== undefined ? { kind: 'config', path: b.configPath } : { kind: 'config', path: '' }, rect: { ...b.bbox } } };
    }
  }
  const block = doc.blocks.find((b) => b.id === id && b.pageIndex >= 0);
  if (!block) return undefined;
  const el = blockElement(block, fileOf(options, block.pageIndex));
  return el ? { pageIndex: block.pageIndex, element: el } : undefined;
}
