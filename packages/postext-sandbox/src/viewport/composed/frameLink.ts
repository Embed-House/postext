/**
 * The link between a frame on a composed page and its slot in the
 * Markdown (#864): where a click on a frame puts the caret, which frame
 * the caret is in, and where a comic's text frame puts it.
 *
 * Pure: offsets are those of the text the page was laid out from (the
 * composed book), sheet px for points.
 */

import type { ResolvedPageTemplate, VDTComposedPage, VDTFrame, VDTPage } from 'postext';
import { frameAtSource, frameByName } from './frameHit.js';
import { emptyFrameInsertion, flowInsertion, instanceOfSite, pageSites, repeatSetsOf, siteCaret, siteOfInstance, sitesOf, slotAtOffset, type PageSites, type SlotSite } from './slotSource.js';

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
export function frameClickTarget(markdown: string, composed: VDTComposedPage, frame: Pick<VDTFrame, 'name'> & Partial<Pick<VDTFrame, 'repeat'>>, template?: Pick<ResolvedPageTemplate, 'frames'> & Partial<Pick<ResolvedPageTemplate, 'groups'>>): FrameClickTarget | null {
  const sites = pageSites(markdown, composed.sourceStart, composed.sourceEnd);
  if (!sites) return null;
  // An instance of a grid's frame (#1061, #1065): its item's piece, or the
  // member written inside it; a member not written yet gets an empty
  // `:::frame{slot}` inside the item's piece.
  const repeat = frame.repeat;
  const sets = repeatSetsOf(template && template.groups ? { groups: template.groups } : undefined);
  if (repeat && sets.has(repeat.frame)) {
    const site = siteOfInstance(sites, repeat.frame, repeat.item, sets);
    if (site && site.slot === repeat.frame) return { kind: 'caret', offset: siteCaret(markdown, site), slot: repeat.frame };
    if (site && site.kind === 'frame') return { kind: 'insert', ...memberInsertion(markdown, site, repeat.frame), slot: repeat.frame };
    if (site) return { kind: 'caret', offset: siteCaret(markdown, site), slot: site.slot };
  }
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
export function frameAtCaret(
  markdown: string,
  page: Pick<VDTPage, 'composed'>,
  offset: number,
  sites?: PageSites | null,
  template?: { groups: readonly { repeat?: { frames: readonly string[] } }[] },
): VDTFrame | null {
  const composed = page.composed;
  if (!composed || offset < composed.sourceStart || offset > composed.sourceEnd) return null;
  const s = sites === undefined ? pageSites(markdown, composed.sourceStart, composed.sourceEnd) : sites;
  // A grid's frames (#1061, #1065): the slot is read as the instance of
  // the item it is written in; a member written inside an item counts.
  const sets = repeatSetsOf(template);
  const site = s ? slotAtOffset(s, offset, (inner) => sets.has(inner.slot)) : null;
  if (site && s) {
    const instance = sets.size > 0 ? instanceOfSite(s, site, sets) : null;
    if (instance) return frameByName(page, instance) ?? frameAtSource(page, offset);
    return frameByName(page, site.slot);
  }
  return frameAtSource(page, offset);
}

/** An empty `:::frame{slot}` fence for a grid member written inside its
 *  item's piece (before the piece's closing fence), and where the caret
 *  goes in it. */
export function memberInsertion(markdown: string, item: SlotSite, slot: string): { at: number; insert: string; caret: number } {
  const at = item.contentEnd;
  const before = markdown.slice(0, at);
  const lead = before.endsWith('\n\n') || at === item.contentStart ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const open = `:::frame{slot="${slot}"}\n`;
  return { at, insert: `${lead}${open}\n:::\n`, caret: at + lead.length + open.length };
}

/** Where a click on a comic's text frame off its words puts the caret
 *  (#885): the start of the Markdown poured into it. */
export function comicTextCaret(page: Pick<VDTPage, 'floats'>, frame: Pick<VDTFrame, 'blockIds'>): number | null {
  const ids = new Set(frame.blockIds.slice(1));
  let best: number | null = null;
  for (const b of page.floats ?? []) {
    if (!ids.has(b.id) || b.sourceStart == null) continue;
    if (best === null || b.sourceStart < best) best = b.sourceStart;
  }
  return best;
}
