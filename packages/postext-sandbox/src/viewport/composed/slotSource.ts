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
  /** The `slot` value as written (inside the quotes). */
  slotRange?: { start: number; end: number };
  /** A site written inside another one (#1065): a member of a grid's item,
   *  `:::frame{slot="caption"}` inside `:::frame{slot="card"}`; the index
   *  of the holding site in `sites`. {@link sitesOf} leaves these out (on a
   *  page without grids they are the holding site's content). */
  within?: number;
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
  /** The page's `:::module` blocks (#1062): the instance name their slots
   *  are scoped by, fence to closing fence, and where the closing fence's
   *  line starts. */
  modules: { name: string; template: string; templateRange?: { start: number; end: number }; start: number; end: number; closerStart: number }[];
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

/** The site of a container that names a slot: a `:::frame` fence (its
 *  content between the fence lines) or another container. */
function containerSite(text: string, b: ContentBlock, endBlock: ContentBlock, abs: (n: number) => number): SlotSite {
  const isFrame = b.containerName === 'frame';
  const opener = text.slice(b.sourceStart, b.sourceEnd);
  const m = isFrame ? LABEL_RE.exec(opener) : null;
  const labelStart = m ? b.sourceStart + m.index + m[0].indexOf('"') + 1 : -1;
  // The content starts on the line after the fence, ends where the
  // closing fence's line starts.
  const after = text.indexOf('\n', b.sourceEnd);
  const contentStart = isFrame ? (after < 0 ? b.sourceEnd : after + 1) : b.sourceStart;
  const contentEnd = isFrame ? Math.max(contentStart, endBlock.sourceStart) : endBlock.sourceEnd;
  return {
    slot: b.slot!.name,
    kind: isFrame ? 'frame' : 'block',
    start: abs(b.sourceStart),
    end: abs(endBlock.sourceEnd),
    contentStart: abs(contentStart),
    contentEnd: abs(contentEnd),
    ...(m ? { label: { start: abs(labelStart), end: abs(labelStart + m[1]!.length), text: m[1]! } } : {}),
    ...slotRangeOf(b, abs),
  };
}

function blockSite(b: ContentBlock, abs: (n: number) => number): SlotSite {
  return { slot: b.slot!.name, kind: 'block', start: abs(b.sourceStart), end: abs(b.sourceEnd), contentStart: abs(b.sourceStart), contentEnd: abs(b.sourceEnd), ...slotRangeOf(b, abs) };
}

function slotRangeOf(b: ContentBlock, abs: (n: number) => number): { slotRange?: { start: number; end: number } } {
  const s = b.slot;
  return s && s.sourceEnd > s.sourceStart ? { slotRange: { start: abs(s.sourceStart), end: abs(s.sourceEnd) } } : {};
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
    modules: [],
  };
  let k = open + 1;
  const last = closed ? close : blocks.length;
  while (k < last) {
    const b = blocks[k]!;
    if (b.type === 'containerStart' && b.containerName === 'module' && b.module && !b.module.nested) {
      // A module (#1062): its slots are its own, named `<module>.<slot>`
      // by the parser; read inside it.
      const e = endMarker(blocks, k);
      const endBlock = blocks[e]!;
      const t = b.module.attrSources.template;
      out.modules.push({ name: b.module.name, template: b.module.template, ...(t ? { templateRange: { start: abs(t.sourceStart), end: abs(t.sourceEnd) } } : {}), start: abs(b.sourceStart), end: abs(endBlock.sourceEnd), closerStart: abs(endBlock.sourceStart) });
      k++;
      continue;
    }
    if (b.type === 'containerStart') {
      const e = endMarker(blocks, k);
      const endBlock = blocks[e]!;
      if (b.slot) {
        const holder = out.sites.length;
        out.sites.push(containerSite(text, b, endBlock, abs));
        // What a `:::frame` holds one level down that names a slot of its
        // own: a grid item's members (#1065).
        if (b.containerName === 'frame') {
          for (let j = k + 1; j < e; j++) {
            const inner = blocks[j]!;
            if (inner.type === 'containerStart') {
              const ie = endMarker(blocks, j);
              if (inner.slot) out.sites.push({ ...containerSite(text, inner, blocks[ie]!, abs), within: holder });
              j = ie;
              continue;
            }
            if (inner.type !== 'containerEnd' && inner.slot) out.sites.push({ ...blockSite(inner, abs), within: holder });
          }
        }
      } else if (b.containerName !== 'frame') {
        out.unslotted.push({ start: abs(b.sourceStart), end: abs(endBlock.sourceEnd) });
      }
      k = e + 1;
      continue;
    }
    if (b.type !== 'containerEnd') {
      if (b.slot) {
        out.sites.push(blockSite(b, abs));
      } else {
        out.unslotted.push({ start: abs(b.sourceStart), end: abs(b.sourceEnd), ...(b.type === 'heading' && b.level !== undefined ? { heading: b.level } : {}) });
      }
    }
    k++;
  }
  return out;
}

/** The sites of `slot`, in Markdown order (not those written inside
 *  another site). */
export function sitesOf(page: PageSites, slot: string): SlotSite[] {
  return page.sites.filter((s) => s.slot === slot && s.within === undefined);
}

/** The frame sets a template's grids repeat (#1061), by frame: each frame
 *  of a set mapped to the whole set (the main frame first). */
export function repeatSetsOf(template: { groups: readonly { repeat?: { frames: readonly string[] } }[] } | undefined): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const g of template?.groups ?? []) {
    const set = g.repeat?.frames ?? [];
    for (const f of set) if (!out.has(f)) out.set(f, set);
  }
  return out;
}

/**
 * The instance (`<frame>[n]`, #1061) a site of a grid's frame is written
 * for: item `n` is the n-th top-level piece sent to a frame of the set, in
 * Markdown order (the engine's `pageRepeats`); a member written inside a
 * piece is that piece's instance. Null for a site of a frame no grid
 * repeats (`sets`: {@link repeatSetsOf} of the page's template).
 */
export function instanceOfSite(page: PageSites, site: SlotSite, sets: ReadonlyMap<string, readonly string[]>): string | null {
  const set = sets.get(site.slot);
  if (!set) return null;
  const top = site.within !== undefined ? page.sites[site.within]! : site;
  if (!set.includes(top.slot)) return null;
  let n = 0;
  for (const s of page.sites) {
    if (s.within !== undefined || !set.includes(s.slot)) continue;
    n++;
    if (s === top) return `${site.slot}[${n}]`;
  }
  return null;
}

/** The site grid instance `frame`[`item`] (`card[2]`, `caption[2]`) is
 *  written in: the item's piece for its own frame, the member written
 *  inside it for another (none yet: the item's piece). */
export function siteOfInstance(page: PageSites, frame: string, item: number, sets: ReadonlyMap<string, readonly string[]>): SlotSite | null {
  const set = sets.get(frame);
  if (!set) return null;
  let n = 0;
  for (let i = 0; i < page.sites.length; i++) {
    const s = page.sites[i]!;
    if (s.within !== undefined || !set.includes(s.slot)) continue;
    n++;
    if (n !== item) continue;
    if (s.slot === frame) return s;
    return page.sites.find((m) => m.within === i && m.slot === frame) ?? s;
  }
  return null;
}

/** The slot the offset is written in: the innermost site holding it (a
 *  fence's lines count as its own); null in the page's unslotted text or
 *  outside the page. A site written inside another counts only when
 *  `nested` accepts it (a grid item's member). */
export function slotAtOffset(page: PageSites, offset: number, nested?: (site: SlotSite) => boolean): SlotSite | null {
  if (offset < page.start || offset > page.end) return null;
  let best: SlotSite | null = null;
  for (const s of page.sites) {
    if (s.within !== undefined && !nested?.(s)) continue;
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
  // A frame of a module (#1062): inside its `:::module`, by the module's
  // own slot name.
  const module = page.modules.find((m) => slot.startsWith(`${m.name}.`));
  const at = module ? module.closerStart : page.closerStart;
  const before = markdown.slice(0, at);
  const lead = before.endsWith('\n\n') || (!module && at === page.openerEnd + 1) ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const open = `:::frame{slot="${module ? slot.slice(module.name.length + 1) : slot}"}\n`;
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
