/**
 * Where a slot of a composed page is written in the Markdown (#864): the
 * `:::frame{slot="…"}` fence, or the block that names `slot="…"`, inside a
 * `::::page{template}` fence. The canvas reads it to put the caret in the
 * slot of the frame clicked, to tell which frame the caret is in, and to
 * edit a frame's label tab on the page.
 *
 * Pure: offsets into the text given (the composed book, or a chapter).
 */

import { parseMarkdown, type ContentBlock } from 'postext';

/** One place a slot is written. */
export interface SlotSite {
  slot: string;
  /** `frame`: a `:::frame{slot}` fence; `block`: a block (or a fenced
   *  container) that names the slot. */
  kind: 'frame' | 'block';
  /** The whole site: fence to closing fence, or the block. */
  start: number;
  end: number;
  /** Where its content is: between the fence lines, or the block itself. */
  contentStart: number;
  contentEnd: number;
  /** A `:::frame` fence's `label="…"` value (the box's label tab), when it
   *  has one. */
  label?: { start: number; end: number; text: string };
}

/** What a composed page holds, as the Markdown writes it. */
export interface PageSites {
  /** The page fence, opening line to closing fence. */
  start: number;
  end: number;
  /** The end of the opening line (its newline excluded). */
  openerEnd: number;
  /** The start of the closing `::::` line (the fence's end when it has
   *  none). */
  closerStart: number;
  sites: SlotSite[];
  /** Blocks that name no slot (the flow frame's, or a `takes` frame's). */
  unslotted: { start: number; end: number; heading?: number }[];
}

const LABEL_RE = /\blabel\s*=\s*"([^"]*)"/;

function endMarker(blocks: readonly ContentBlock[], at: number): number {
  const id = blocks[at]!.containerId;
  for (let k = at + 1; k < blocks.length; k++) {
    const b = blocks[k]!;
    if (b.type === 'containerEnd' && b.containerId === id) return k;
  }
  return blocks.length - 1;
}

/** The slots of the composed page written at `[pageStart, pageEnd)` of
 *  `markdown` (the range a `VDTComposedPage` carries). Null when no page
 *  fence opens there. */
export function pageSites(markdown: string, pageStart: number, pageEnd: number): PageSites | null {
  const text = markdown.slice(pageStart, pageEnd);
  const blocks = parseMarkdown(text);
  const open = blocks.findIndex((b) => b.type === 'containerStart' && b.containerName === 'composedPage');
  if (open < 0) return null;
  const close = endMarker(blocks, open);
  const closing = blocks[close]!;
  const closed = closing.type === 'containerEnd' && closing.containerId === blocks[open]!.containerId && closing.sourceEnd > closing.sourceStart;
  const abs = (n: number): number => pageStart + n;
  const out: PageSites = {
    start: abs(blocks[open]!.sourceStart),
    end: abs(closed ? closing.sourceEnd : text.length),
    openerEnd: abs(blocks[open]!.sourceEnd),
    closerStart: abs(closed ? closing.sourceStart : text.length),
    sites: [],
    unslotted: [],
  };
  let k = open + 1;
  const last = closed ? close : blocks.length;
  while (k < last) {
    const b = blocks[k]!;
    if (b.type === 'containerStart') {
      const e = endMarker(blocks, k);
      const endBlock = blocks[e]!;
      if (b.slot) {
        const isFrame = b.containerName === 'frame';
        const opener = text.slice(b.sourceStart, b.sourceEnd);
        const m = isFrame ? LABEL_RE.exec(opener) : null;
        const labelStart = m ? b.sourceStart + m.index + m[0].indexOf('"') + 1 : -1;
        // The content starts on the line after the fence, ends where the
        // closing fence's line starts.
        const after = text.indexOf('\n', b.sourceEnd);
        const contentStart = isFrame ? (after < 0 ? b.sourceEnd : after + 1) : b.sourceStart;
        const contentEnd = isFrame ? Math.max(contentStart, endBlock.sourceStart) : endBlock.sourceEnd;
        out.sites.push({
          slot: b.slot.name,
          kind: isFrame ? 'frame' : 'block',
          start: abs(b.sourceStart),
          end: abs(endBlock.sourceEnd),
          contentStart: abs(contentStart),
          contentEnd: abs(contentEnd),
          ...(m ? { label: { start: abs(labelStart), end: abs(labelStart + m[1]!.length), text: m[1]! } } : {}),
        });
      } else if (b.containerName !== 'frame') {
        out.unslotted.push({ start: abs(b.sourceStart), end: abs(endBlock.sourceEnd) });
      }
      k = e + 1;
      continue;
    }
    if (b.type !== 'containerEnd') {
      if (b.slot) {
        out.sites.push({ slot: b.slot.name, kind: 'block', start: abs(b.sourceStart), end: abs(b.sourceEnd), contentStart: abs(b.sourceStart), contentEnd: abs(b.sourceEnd) });
      } else {
        out.unslotted.push({ start: abs(b.sourceStart), end: abs(b.sourceEnd), ...(b.type === 'heading' && b.level !== undefined ? { heading: b.level } : {}) });
      }
    }
    k++;
  }
  return out;
}

/** The sites of `slot`, in Markdown order. */
export function sitesOf(page: PageSites, slot: string): SlotSite[] {
  return page.sites.filter((s) => s.slot === slot);
}

/** The slot the offset is written in: the innermost site holding it (a
 *  fence's lines count as its own); null in the page's unslotted text or
 *  outside the page. */
export function slotAtOffset(page: PageSites, offset: number): SlotSite | null {
  if (offset < page.start || offset > page.end) return null;
  let best: SlotSite | null = null;
  for (const s of page.sites) {
    if (offset < s.start || offset > s.end) continue;
    if (!best || s.end - s.start < best.end - best.start) best = s;
  }
  return best;
}

/** Where the caret goes to write in a site: the first line of a fence's
 *  content (the blank line of an empty one), the start of a block. */
export function siteCaret(markdown: string, site: SlotSite): number {
  if (site.kind === 'block') return site.contentStart;
  const content = markdown.slice(site.contentStart, site.contentEnd);
  const lead = content.length - content.replace(/^\n+/, '').length;
  // An empty fence: its blank line, or right after the opener.
  if (content.trim() === '') return site.contentStart;
  return site.contentStart + lead;
}

/** An empty `:::frame{slot}` fence for `slot`, written at the end of the
 *  page (before its closing fence), and where the caret goes in it. */
export function emptyFrameInsertion(markdown: string, page: PageSites, slot: string): { at: number; insert: string; caret: number } {
  const at = page.closerStart;
  const before = markdown.slice(0, at);
  const lead = before.endsWith('\n\n') || at === page.openerEnd + 1 ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const open = `:::frame{slot="${slot}"}\n`;
  const insert = `${lead}${open}\n:::\n`;
  return { at, insert, caret: at + lead.length + open.length };
}

/** Where the caret goes to write text that names no slot (the flow
 *  frame's): the end of the page's last unslotted block, else a fresh
 *  line after the opening fence. */
export function flowInsertion(markdown: string, page: PageSites): { at: number; insert: string; caret: number } {
  const blocks = page.unslotted.filter((u) => u.heading === undefined);
  const last = blocks[blocks.length - 1];
  if (last) return { at: last.end, insert: '', caret: last.end };
  const at = page.openerEnd;
  const nextLine = markdown.slice(at, at + 3);
  // A blank line under the opener is reused; otherwise one is made.
  if (nextLine.startsWith('\n\n')) return { at, insert: '', caret: at + 1 };
  return { at, insert: '\n\n', caret: at + 1 };
}
