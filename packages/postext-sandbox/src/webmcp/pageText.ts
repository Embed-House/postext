// A laid-out page put into words: what is on it, block by block, with the
// measures an agent tunes a layout by (how full each column is, which
// lines are loose, where a word was broken). The picture of the page says
// how it looks; this says what the engine did.

import { describeReflowEvent, type BoundingBox, type VDTBlock, type VDTDocument, type VDTLine, type VDTPage } from 'postext';

/** A justified line whose spaces are this much wider than set reads as
 *  loose (the Checks panel's own default threshold is higher: it lists
 *  only what needs fixing; this lists what is worth a look). */
const LOOSE_SPACE_RATIO = 1.6;

const round = (n: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export interface PageBlockSummary {
  type: VDTBlock['type'];
  /** Heading level, for a heading. */
  level?: number;
  column: number;
  /** The block's text as set, line breaks as spaces; clipped when long. */
  text: string;
  lines: number;
  /** Lines ending in a broken word. */
  hyphenated?: number;
  /** Justified lines set loose, and the widest spaces among them, as a
   *  multiple of the normal space. */
  loose?: number;
  widestSpaces?: number;
  /** The resource the block places. */
  resource?: string;
  /** Where the block sits, as fractions of the page (x, y, width, height). */
  box: [number, number, number, number];
  /** Where the block's text starts in the chapter's source. */
  sourceOffset?: number;
}

export interface PageSummary {
  /** Position in the chapter's pages, from 1. */
  position: number;
  /** The number the page carries, as printed (`iv`, `12`). */
  label: string;
  number: number;
  role: string;
  blank: boolean;
  /** Recto (right-hand) or verso. */
  side: 'recto' | 'verso';
  /** Page size in millimetres, cut lines included when the layout has them. */
  sizeMm: [number, number];
  columns: { blocks: number; lines: number; /** Share of the column's height its blocks take. */ fill: number }[];
  blocks: PageBlockSummary[];
  floats?: PageBlockSummary[];
  marginNotes?: number;
  footnotes?: number;
  header?: string;
  footer?: string;
  /** A composed page (#846): its template, and what the layout moved,
   *  grew or scaled so its content fits (the reflow log in words, #868). */
  composed?: { template: string; reflow: string[] };
}

const blockText = (lines: readonly VDTLine[], max: number): string => {
  let text = '';
  for (const line of lines) {
    // A broken word is one word again; other lines meet with a space.
    text += line.hyphenated && !line.hardHyphen ? line.text.replace(/[-­‐]$/, '') : `${line.text} `;
    if (text.length > max) return `${text.slice(0, max).trimEnd()}…`;
  }
  return text.trimEnd();
};

const boxOf = (bbox: BoundingBox, page: VDTPage): [number, number, number, number] => [
  round(bbox.x / page.width),
  round(bbox.y / page.height),
  round(bbox.width / page.width),
  round(bbox.height / page.height),
];

/** A block of a page in words. `maxText` clips its text. */
export function summariseBlock(block: VDTBlock, page: VDTPage, maxText: number): PageBlockSummary {
  const justified = block.lines.filter((l) => l.justifiedSpaceRatio !== undefined);
  const loose = justified.filter((l) => l.justifiedSpaceRatio! >= LOOSE_SPACE_RATIO);
  const hyphenated = block.lines.filter((l) => l.hyphenated).length;
  const resource = block.resourceBlock?.resource.id;
  return {
    type: block.type,
    ...(block.headingLevel !== undefined ? { level: block.headingLevel } : {}),
    column: block.columnIndex,
    text: blockText(block.lines, maxText),
    lines: block.lines.length,
    ...(hyphenated > 0 ? { hyphenated } : {}),
    ...(loose.length > 0 ? { loose: loose.length, widestSpaces: round(Math.max(...loose.map((l) => l.justifiedSpaceRatio!)), 2) } : {}),
    ...(resource ? { resource } : {}),
    box: boxOf(block.bbox, page),
    ...(block.sourceStart !== undefined ? { sourceOffset: block.sourceStart } : {}),
  };
}

const slotText = (slot: VDTPage['header']): string | undefined => {
  const blocks = (slot as { blocks?: readonly { lines?: readonly { text?: string }[] }[] } | undefined)?.blocks;
  if (!blocks) return undefined;
  const text = blocks.flatMap((b) => b.lines ?? []).map((l) => l.text ?? '').filter(Boolean).join(' · ');
  return text || undefined;
};

/** Page `index` of `doc` (a chapter's document) in words. `maxText` clips
 *  each block's text. */
export function summarisePage(doc: VDTDocument, index: number, maxText = 400): PageSummary {
  const page = doc.pages[index]!;
  const dpi = (doc.config as { page?: { dpi?: number } }).page?.dpi ?? 300;
  const mm = (px: number): number => round((px / dpi) * 25.4, 1);
  const blocks = page.columns.flatMap((c) => c.blocks).filter((b) => !b.hidden);
  const physical = (doc.pageIndexOffset ?? 0) + index;
  // The first physical page of a book is a recto, whichever side it is
  // bound on.
  const recto = physical % 2 === 0;
  return {
    position: index + 1,
    label: page.pageLabel,
    number: page.pageNumberValue,
    role: page.role ?? 'body',
    blank: !!(page.blankForParity || page.blankForForce) || (blocks.length === 0 && !(page.floats?.length) && !page.comic),
    side: recto ? 'recto' : 'verso',
    sizeMm: [mm(page.width), mm(page.height)],
    columns: page.columns.map((c) => {
      const visible = c.blocks.filter((b) => !b.hidden);
      const used = visible.reduce((bottom, b) => Math.max(bottom, b.bbox.y + b.bbox.height - c.bbox.y), 0);
      return {
        blocks: visible.length,
        lines: visible.reduce((n, b) => n + b.lines.length, 0),
        fill: c.bbox.height > 0 ? round(Math.min(1, used / c.bbox.height), 2) : 0,
      };
    }),
    blocks: blocks.map((b) => summariseBlock(b, page, maxText)),
    ...(page.floats?.length ? { floats: page.floats.map((b) => summariseBlock(b, page, maxText)) } : {}),
    ...(page.marginNotes.length ? { marginNotes: page.marginNotes.length } : {}),
    ...(page.footnoteAreas?.length ? { footnotes: page.footnoteAreas.reduce((n, a) => n + a.noteIds.length, 0) } : {}),
    ...(slotText(page.header) ? { header: slotText(page.header) } : {}),
    ...(slotText(page.footer) ? { footer: slotText(page.footer) } : {}),
    ...(page.composed ? { composed: { template: page.composed.template, reflow: page.composed.log.map((e) => describeReflowEvent(e)) } } : {}),
  };
}

/** One line per page of a chapter's document: enough to pick the page to
 *  look at. */
export function outlinePages(doc: VDTDocument): { position: number; label: string; role: string; blank: boolean; lines: number; figures: number; starts: string }[] {
  return doc.pages.map((page, index) => {
    const blocks = page.columns.flatMap((c) => c.blocks).filter((b) => !b.hidden);
    const first = blocks.find((b) => b.lines.some((l) => l.text.trim() !== ''));
    const figures = blocks.filter((b) => b.type === 'resource').length + (page.floats?.filter((b) => b.type === 'resource').length ?? 0);
    return {
      position: index + 1,
      label: page.pageLabel,
      role: page.role ?? 'body',
      blank: !!(page.blankForParity || page.blankForForce) || (blocks.length === 0 && !(page.floats?.length) && !page.comic),
      lines: blocks.reduce((n, b) => n + b.lines.length, 0),
      figures,
      starts: first ? blockText(first.lines, 60) : '',
    };
  });
}

/** The pages of `doc` on which `offset` (a chapter source offset) is set:
 *  the page positions (from 1) of the blocks whose source spans it. */
export function pagesOfOffset(doc: VDTDocument, offset: number): number[] {
  const found = new Set<number>();
  doc.pages.forEach((page, index) => {
    for (const column of page.columns) {
      for (const block of column.blocks) {
        if (block.sourceStart === undefined || block.sourceEnd === undefined) continue;
        if (offset < block.sourceStart || offset >= block.sourceEnd) continue;
        // A block split over pages repeats its span: its lines say which.
        const lines = block.lines.filter((l) => l.sourceStart !== undefined && l.sourceEnd !== undefined);
        if (lines.length === 0 || lines.some((l) => offset >= l.sourceStart! && offset < l.sourceEnd!)) found.add(index + 1);
      }
    }
  });
  return [...found].sort((a, b) => a - b);
}
