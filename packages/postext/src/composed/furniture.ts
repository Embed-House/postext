import type { PageRole, ResolvedDesignElement } from '../types.js';
import type { ContentWarning, VDTDesignSlot, VDTPage } from '../vdt.js';
import { fenceDroppedIds, pageMatchesParity, pageMatchesRole } from '../design/layout.js';

/**
 * `folioMissing` (#1163): among the laid pages of one composed page template
 * and side, a page that draws no folio or running head that most of its
 * siblings draw. The layout records, per composed page, the furniture its
 * running heads and decoration mean to draw there (after the parity, page
 * role and `when` / `unless` filters); this module compares what each page
 * drew with its siblings.
 */

/** Where a furniture element is written. */
export type FurnitureSlot = 'header' | 'footer' | 'decoration';

/** One element a composed page's slots mean to draw on it. */
export interface FurnitureElement {
  slot: FurnitureSlot;
  id: string;
  /** Whether its text holds `{pageNumber}`. */
  folio: boolean;
}

/** What one composed page's running heads and decoration mean to draw. */
export interface PageFurniture {
  pageIndex: number;
  template: string;
  side: 'recto' | 'verso';
  expected: FurnitureElement[];
}

/** Placeholders that make a decoration text a running head or a folio: the
 *  page number, the running names and marks, and a fence attribute (the
 *  running foot a page fence writes, `{attr.foot}`). */
const RUNNING_PLACEHOLDER = /\{(?:pageNumber|chapterTitle|chapterTitleAtTop|chapterNumber|chapterNumberAtTop|partTitle|partNumber|firstMark\.|lastMark\.|attr\.)/;

/** The furniture elements of a slot that are drawn on a page: text
 *  elements (of a running head, any; of a decoration, those that read a
 *  running placeholder) that the parity, the page-role filter and the page
 *  fence's `when` / `unless` let draw there. `pageNumberIndex` is the index
 *  the parity filter reads (`page.index + pageIndexOffset`). */
export function expectedFurniture(
  elements: readonly ResolvedDesignElement[],
  slot: FurnitureSlot,
  pageNumberIndex: number,
  role: PageRole | undefined,
  attrs: Readonly<Record<string, string>> | undefined,
): FurnitureElement[] {
  const dropped = fenceDroppedIds(elements, attrs);
  const out: FurnitureElement[] = [];
  for (const el of elements) {
    if (el.kind !== 'text' || dropped.has(el.id)) continue;
    if (slot === 'decoration' && !RUNNING_PLACEHOLDER.test(el.content)) continue;
    if (!pageMatchesParity(pageNumberIndex, el.parity) || !pageMatchesRole(el.pages, role)) continue;
    out.push({ slot, id: el.id, folio: el.content.includes('{pageNumber}') });
  }
  return out;
}

/** The ids of the elements a laid slot drew with some visible text. */
function drawnTextIds(slot: VDTDesignSlot | undefined): Set<string> {
  const out = new Set<string>();
  for (const b of slot?.blocks ?? []) {
    if (b.kind !== 'text' || b.elementId === undefined) continue;
    if (b.lines.some((l) => l.text.trim().length > 0)) out.add(b.elementId);
  }
  return out;
}

function slotOf(page: VDTPage, slot: FurnitureSlot): VDTDesignSlot | undefined {
  return slot === 'header' ? page.header : slot === 'footer' ? page.footer : page.composed?.decoration;
}

/** The `folioMissing` warnings of a laid document: for each template and
 *  side, an element that at least two pages draw and that more than half
 *  of the other pages meant to draw it do, reported on each page that
 *  meant to draw it and drew nothing. A page whose fence switches the
 *  element off (`when` / `unless`), or whose slot has no such element (a
 *  template with `footer: false`, a styled section's running heads on an
 *  opener), never meant to draw it. */
export function folioMissingWarnings(pages: readonly VDTPage[], records: readonly PageFurniture[]): ContentWarning[] {
  const groups = new Map<string, PageFurniture[]>();
  for (const r of records) {
    const key = `${r.template}\u0000${r.side}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: ContentWarning[] = [];
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    const drawnOn = new Map<number, Map<FurnitureSlot, Set<string>>>();
    const drawn = (r: PageFurniture, slot: FurnitureSlot): Set<string> => {
      let bySlot = drawnOn.get(r.pageIndex);
      if (!bySlot) drawnOn.set(r.pageIndex, (bySlot = new Map()));
      let ids = bySlot.get(slot);
      if (!ids) {
        const page = pages.find((p) => p.index === r.pageIndex);
        ids = page ? drawnTextIds(slotOf(page, slot)) : new Set();
        bySlot.set(slot, ids);
      }
      return ids;
    };
    // Every element any page of the group means to draw, in first-met order.
    const keys = new Map<string, FurnitureElement>();
    for (const r of group) for (const e of r.expected) if (!keys.has(`${e.slot}:${e.id}`)) keys.set(`${e.slot}:${e.id}`, e);
    for (const [key, el] of keys) {
      const meaning = group.filter((r) => r.expected.some((e) => `${e.slot}:${e.id}` === key));
      const drawers = meaning.filter((r) => drawn(r, el.slot).has(el.id));
      const missing = meaning.filter((r) => !drawn(r, el.slot).has(el.id));
      if (missing.length === 0 || drawers.length < 2) continue;
      // Most of the other pages that meant to draw it did.
      if (drawers.length * 2 <= meaning.length - 1) continue;
      for (const r of missing) {
        // Pointed at the page fence.
        const fence = pages.find((p) => p.index === r.pageIndex)?.composed;
        out.push({
          ...(fence ? { sourceStart: fence.sourceStart, sourceEnd: fence.sourceEnd } : {}),
          kind: 'folioMissing',
          template: r.template,
          elementId: el.id,
          slot: el.slot,
          folio: el.folio,
          side: r.side,
          drawnOn: drawers.length,
          siblings: meaning.length - 1,
          pageIndex: r.pageIndex,
        });
      }
    }
  }
  return out.sort((a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0));
}
