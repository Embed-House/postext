/**
 * The link between a frame on a composed page and its slot in the
 * Markdown (#864): where a click on a frame puts the caret, which frame
 * the caret is in, and what on a frame a double click edits.
 *
 * Pure: offsets are those of the text the page was laid out from (the
 * composed book), sheet px for points.
 */

import type { ResolvedPageTemplate, VDTBlock, VDTComposedPage, VDTDesignBlock, VDTDocument, VDTFrame, VDTPage } from 'postext';
import { frameAtSource, frameByName, pointInFrame } from './frameHit';
import { emptyFrameInsertion, flowInsertion, pageSites, siteCaret, sitesOf, slotAtOffset, type PageSites } from './slotSource';

/** The frame of the template whose content `name`'s content goes on
 *  from: the head of its chain (`next`, `overflow.continueIn: '#frame'`). */
export function chainHeadOf(template: Pick<ResolvedPageTemplate, 'frames'> | undefined, name: string): string {
  if (!template) return name;
  const prev = new Map<string, string>();
  for (const f of template.frames) {
    const ci = f.overflow?.continueIn;
    const target = f.next ?? (typeof ci === 'string' && ci.startsWith('#') && ci.length > 1 ? ci.slice(1) : undefined);
    if (target && target !== f.name && !prev.has(target)) prev.set(target, f.name);
  }
  let at = name;
  const seen = new Set([at]);
  for (let p = prev.get(at); p !== undefined && !seen.has(p); p = prev.get(at)) {
    seen.add(p);
    at = p;
  }
  return at;
}

/** What a click on a frame does to the source: put the caret somewhere,
 *  or first write an empty slot for it there. Book offsets. */
export type FrameClickTarget =
  | { kind: 'caret'; offset: number; slot: string }
  | { kind: 'insert'; at: number; insert: string; caret: number; slot: string };

/**
 * Where the caret goes for a click on `frame` (its padding or its empty
 * box; a click on its words places the caret at the word): the first line
 * of its slot, the content poured into it without a slot (a heading a
 * `takes` frame received, the flow), and for an empty frame a place to
 * write: an empty `:::frame{slot}` fence made before the page's closing
 * fence, or the flow's next line. A frame a chain continues into goes to
 * the chain's head.
 */
export function frameClickTarget(markdown: string, composed: VDTComposedPage, frame: Pick<VDTFrame, 'name'>, template?: Pick<ResolvedPageTemplate, 'frames'>): FrameClickTarget | null {
  const sites = pageSites(markdown, composed.sourceStart, composed.sourceEnd);
  if (!sites) return null;
  const name = chainHeadOf(template, frame.name);
  const own = sitesOf(sites, name)[0];
  if (own) return { kind: 'caret', offset: siteCaret(markdown, own), slot: name };
  const head = composed.frames.find((f) => f.name === name);
  if (head?.sourceStart != null && head.sourceEnd != null && head.sourceEnd > head.sourceStart) {
    return { kind: 'caret', offset: head.sourceStart, slot: name };
  }
  const resolved = template?.frames.find((f) => f.name === name);
  if (resolved?.flow) {
    const f = flowInsertion(markdown, sites);
    return f.insert ? { kind: 'insert', ...f, slot: name } : { kind: 'caret', offset: f.caret, slot: name };
  }
  return { kind: 'insert', ...emptyFrameInsertion(markdown, sites, name), slot: name };
}

/** The frame the source offset is written for on `page`: the frame its
 *  content was poured into, else the frame of the slot it is written in
 *  (an empty fence, the fence lines); null off the page's frames. */
export function frameAtCaret(markdown: string, page: Pick<VDTPage, 'composed'>, offset: number, sites?: PageSites | null): VDTFrame | null {
  const composed = page.composed;
  if (!composed || offset < composed.sourceStart || offset > composed.sourceEnd) return null;
  const s = sites === undefined ? pageSites(markdown, composed.sourceStart, composed.sourceEnd) : sites;
  const site = s ? slotAtOffset(s, offset) : null;
  if (site) return frameByName(page, site.slot);
  return frameAtSource(page, offset);
}

/** What a double click on a frame edits in place. */
export type FrameTextTarget =
  | {
      kind: 'label';
      frame: VDTFrame;
      /** The tab on the sheet. */
      rect: { x: number; y: number; width: number; height: number };
      /** The `label="…"` value in the source (book offsets). */
      start: number;
      end: number;
      text: string;
      fontPx: number;
    }
  | {
      kind: 'block';
      frame: VDTFrame;
      block: VDTBlock;
      rect: { x: number; y: number; width: number; height: number };
      /** The block's source (book offsets): its Markdown as written. */
      start: number;
      end: number;
      text: string;
      fontPx: number;
    };

const EDITABLE_BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'listItem', 'blockquote']);

const inRect = (r: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

function fontPxOf(font: string | undefined, fallback: number): number {
  const m = font ? /(\d+(?:\.\d+)?)px/.exec(font) : null;
  return m ? Number(m[1]) : fallback;
}

/** The label tab of a frame's box: the design text of the box that sets
 *  the fence's `label` (on the sheet, as the box's overlay is). */
function labelTabRect(box: VDTBlock, label: string): { rect: { x: number; y: number; width: number; height: number }; fontPx: number } | null {
  const blocks = box.designOverlay?.blocks ?? [];
  for (const b of blocks as VDTDesignBlock[]) {
    if (b.kind !== 'text') continue;
    const line = b.lines?.[0];
    if (!line || line.text !== label) continue;
    return {
      rect: { x: b.bbox.x, y: b.bbox.y, width: b.bbox.width, height: b.bbox.height },
      fontPx: fontPxOf(b.fontString, 12),
    };
  }
  return null;
}

/**
 * The text of a frame under the sheet point `(x, y)` that a double click
 * edits on the page: the label tab of its box (the fence's `label`), or one
 * of its paragraphs, headings or list items (its Markdown source). Null on
 * a turned frame (edited in the editor), off any frame's text, or when the
 * page's source cannot be read.
 */
export function frameTextTargetAt(doc: Pick<VDTDocument, 'blocks'>, page: VDTPage, markdown: string, frame: VDTFrame, x: number, y: number): FrameTextTarget | null {
  const composed = page.composed;
  if (!composed || frame.rotate) return null;
  if (!pointInFrame(frame, x, y)) return null;
  const floats = page.floats ?? [];
  const byId = new Map<string, VDTBlock>();
  for (const b of floats) byId.set(b.id, b);
  for (const b of doc.blocks) if (!byId.has(b.id)) byId.set(b.id, b);
  const ids = frame.blockIds;
  const box = ids.length > 0 ? byId.get(ids[0]!) : undefined;
  // The label tab first: it rises over the box's edge.
  if (box) {
    const sites = pageSites(markdown, composed.sourceStart, composed.sourceEnd);
    const site = sites ? sitesOf(sites, frame.name).find((s) => s.label) : undefined;
    if (site?.label) {
      const tab = labelTabRect(box, site.label.text);
      if (tab && inRect(tab.rect, x, y)) {
        return { kind: 'label', frame, rect: tab.rect, start: site.label.start, end: site.label.end, text: site.label.text, fontPx: tab.fontPx };
      }
    }
  }
  for (const id of ids.slice(1)) {
    const b = byId.get(id);
    if (!b || !EDITABLE_BLOCKS.has(b.type) || b.sourceStart == null || b.sourceEnd == null) continue;
    if (!inRect(b.bbox, x, y)) continue;
    const start = b.sourceStart;
    const end = b.sourceEnd;
    if (end <= start || end > markdown.length) return null;
    const first = b.lines[0];
    return { kind: 'block', frame, block: b, rect: { ...b.bbox }, start, end, text: markdown.slice(start, end), fontPx: first ? Math.max(6, first.bbox.height * 0.7) : 14 };
  }
  return null;
}

/** The source change that writes `text` in place of a target's. A label
 *  keeps to its quotes (a `"` typed becomes `”`). */
export function frameTextChange(target: Pick<FrameTextTarget, 'kind' | 'start' | 'end' | 'text'>, text: string): { from: number; to: number; insert: string } | null {
  const insert = target.kind === 'label' ? text.replace(/[\r\n]+/g, ' ').replace(/"/g, '”') : text.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n');
  if (insert === target.text) return null;
  return { from: target.start, to: target.end, insert };
}
