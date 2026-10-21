/**
 * Composed pages in the parsed document (#854, DESIGN §3, §4): the content
 * of each `::::page{template=…}` fence gathered by slot.
 *
 * The parser leaves a composed page in the block stream as a
 * `containerStart` / `containerEnd` pair (`containerName: 'composedPage'`,
 * the fence on `ContentBlock.composedPage`), its frames as `:::frame`
 * containers and the slot each block names on `ContentBlock.slot`.
 * {@link composedPages} reads that stream into one node per page. It is
 * pure and reads any block array, so the layout (P4) can call it on its own
 * transformed `contentBlocks` and get indices into them.
 */
import type { ComposedModuleFence, ContentBlock } from '../parse/types.js';
import type { ComposedPageNode, SourceRange } from './types.js';

/** Heading levels a template frame may `take`. */
export type HeadingTake = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/** What a template frame may `take`: the first heading of a level, or the
 *  page's contents (`'toc'`, #983). */
export type FrameTake = HeadingTake | 'toc';

/** A composed page as the parser read it: the design's
 *  {@link ComposedPageNode} plus what the slot checks need. */
export interface ParsedComposedPage extends ComposedPageNode {
  /** Source range of the first `slot="…"` value of each slot. */
  slotSources: Record<string, SourceRange>;
  /** The first heading of each level that names no slot (its block
   *  index), which a frame with `takes` receives. */
  firstHeadings: Partial<Record<HeadingTake, number>>;
  /** The `:::toc` of the page that names no slot (#983): the directive,
   *  or, once the contents are expanded into their rows, every row and
   *  the page breaks between parts. A frame with `takes: 'toc'` receives
   *  them. */
  tocRows: number[];
  /** Every piece of the page that names a slot, in Markdown order
   *  (#1061): a grid that repeats a frame takes each piece as one item. */
  pieces: SlotPiece[];
  /** The page's `:::module` blocks (#1062), in Markdown order. Their
   *  slotted blocks are in `slots` and `pieces` under scoped names
   *  (`<module>.<slot>`); the blocks that name no slot are the module's,
   *  not in `unassigned`. */
  modules: ParsedModule[];
  /** Modules written inside a module (#1062, `moduleNested`): their blocks
   *  are the outer module's. */
  nestedModules: ComposedModuleFence[];
  /** Source range of the fence line. */
  fence: SourceRange;
  /** The fence had no closing fence of its length (reported by the
   *  parser as `unclosedContainer`). */
  unclosed: boolean;
}

/** A `:::module` of a composed page (#1062). */
export interface ParsedModule {
  fence: ComposedModuleFence;
  /** Its opening and closing markers. */
  start: number;
  end: number;
  /** Its blocks that name no slot, which go to the module's flow frame. */
  unassigned: number[];
  /** Its first heading of each level that names no slot, which the
   *  module's `takes` frame receives. */
  firstHeadings: Partial<Record<HeadingTake, number>>;
}

/** A piece of a composed page sent to a slot (#1061): a `:::frame{slot}`
 *  container (its blocks, its own markers left out), or any other block or
 *  container that names a slot (markers included). */
export interface SlotPiece {
  slot: string;
  /** The `slot="…"` value. */
  source: SourceRange;
  /** Block indices, in order. */
  indices: number[];
  /** The opening marker of a `:::frame` piece. */
  fence?: number;
  /** Within a `:::frame` piece, the blocks and containers one level down
   *  that name a slot of their own (a frame's blocks stay with it, except
   *  in a grid that repeats both). */
  inner: SlotPiece[];
}

/** Index of the marker closing the container opened at `start`, or the
 *  last index when it never closes. */
function endOf(blocks: readonly ContentBlock[], start: number): number {
  const id = blocks[start]!.containerId;
  for (let k = start + 1; k < blocks.length; k++) {
    const b = blocks[k]!;
    if (b.type === 'containerEnd' && b.containerId === id) return k;
  }
  return blocks.length - 1;
}

/**
 * Every composed page of `blocks`, in order, with its content by slot.
 *
 * - The blocks of a `:::frame{slot="x"}` go to slot `x` (the frame's own
 *   markers are left out); a frame without a slot goes to `unassigned`.
 * - Any other block, or container (markers included), goes to the slot it
 *   names (`# T {slot=…}`, `::resource{… slot=…}`, a fence's `slot=`),
 *   else to `unassigned`.
 * - Slots keep Markdown order, and so do the indices of each slot: several
 *   pieces with the same slot concatenate.
 */
export function composedPages(blocks: readonly ContentBlock[]): ParsedComposedPage[] {
  const out: ParsedComposedPage[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const start = blocks[i]!;
    if (start.type !== 'containerStart' || start.containerName !== 'composedPage' || !start.composedPage) continue;
    const end = endOf(blocks, i);
    const fence = start.composedPage;
    const slots: Record<string, number[]> = {};
    const slotSources: Record<string, SourceRange> = {};
    const unassigned: number[] = [];
    const firstHeadings: Partial<Record<HeadingTake, number>> = {};
    const put = (slot: ContentBlock['slot'], indices: number[]): void => {
      if (!slot) {
        unassigned.push(...indices);
        return;
      }
      (slots[slot.name] ??= []).push(...indices);
      slotSources[slot.name] ??= { sourceStart: slot.sourceStart, sourceEnd: slot.sourceEnd };
    };
    const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);
    const pieces: SlotPiece[] = [];
    /** The piece of the block or container at `k` (it names a slot), and
     *  the index past it. */
    const pieceAt = (k: number, outer: boolean): { piece?: SlotPiece; next: number } => {
      const b = blocks[k]!;
      const e = b.type === 'containerStart' ? endOf(blocks, k) : k;
      if (!b.slot) return { next: e + 1 };
      const source = { sourceStart: b.slot.sourceStart, sourceEnd: b.slot.sourceEnd };
      if (b.type === 'containerStart' && b.containerName === 'frame') {
        const inner: SlotPiece[] = [];
        if (outer) {
          for (let j = k + 1; j < e;) {
            const at = pieceAt(j, false);
            if (at.piece) inner.push(at.piece);
            j = at.next;
          }
        }
        return { piece: { slot: b.slot.name, source, indices: range(k + 1, e - 1), fence: k, inner }, next: e + 1 };
      }
      return { piece: { slot: b.slot.name, source, indices: range(k, e), inner: [] }, next: e + 1 };
    };
    const modules: ParsedModule[] = [];
    const nestedModules: ComposedModuleFence[] = [];
    /** The blocks `from`…`to - 1`, by slot; what names none goes to
     *  `sink` (the page, or the module it is written in, #1062). */
    const walk = (from: number, to: number, sink: Pick<ParsedModule, 'unassigned' | 'firstHeadings'>, inModule: boolean): void => {
      let k = from;
      while (k < to) {
        const b = blocks[k]!;
        if (b.type === 'containerStart' && b.containerName === 'module' && b.module) {
          // A module (#1062): its blocks that name no slot are its own; one
          // inside a module is not a module of its own (`moduleNested`).
          const e = endOf(blocks, k);
          if (b.module.nested || inModule) {
            nestedModules.push(b.module);
            walk(k + 1, e, sink, true);
          } else {
            const m: ParsedModule = { fence: b.module, start: k, end: e, unassigned: [], firstHeadings: {} };
            modules.push(m);
            walk(k + 1, e, m, true);
          }
          k = e + 1;
          continue;
        }
        if (b.slot) pieces.push(pieceAt(k, true).piece!);
        if (b.type === 'containerStart') {
          const e = endOf(blocks, k);
          const indices = b.containerName === 'frame' ? range(k + 1, e - 1) : range(k, e);
          if (b.slot) put(b.slot, indices);
          else sink.unassigned.push(...indices);
          k = e + 1;
          continue;
        }
        if (b.type === 'heading' && !b.slot && b.level !== undefined) {
          const take = `h${b.level}` as HeadingTake;
          if (sink.firstHeadings[take] === undefined) sink.firstHeadings[take] = k;
        }
        if (b.slot) put(b.slot, [k]);
        else sink.unassigned.push(k);
        k++;
      }
    };
    walk(i + 1, end, { unassigned, firstHeadings }, false);
    // The page's contents: the directive, or its expanded rows (they and
    // the breaks between parts map to the directive's line).
    const tocLines = new Set<number>();
    for (const k of unassigned) {
      const b = blocks[k]!;
      if (b.toc !== undefined || (b.type === 'directive' && b.directiveName === 'toc')) tocLines.add(b.sourceStart);
    }
    const tocRows = unassigned.filter((k) => {
      const b = blocks[k]!;
      return b.toc !== undefined
        || (b.type === 'directive' && (b.directiveName === 'toc' || (b.directiveName === 'pagebreak' && tocLines.has(b.sourceStart))));
    });
    const closing = blocks[end]!;
    const unclosed = closing.type !== 'containerEnd' || closing.containerId !== start.containerId || closing.sourceEnd === closing.sourceStart;
    out.push({
      type: 'composedPage',
      template: fence.template,
      spread: fence.spread,
      attrs: fence.attrs,
      attrSources: fence.attrSources,
      fenceIndex: fence.fenceIndex,
      slots,
      unassigned,
      slotSources,
      firstHeadings,
      tocRows,
      pieces,
      modules,
      nestedModules,
      fence: { sourceStart: start.sourceStart, sourceEnd: start.sourceEnd },
      unclosed,
      sourceStart: start.sourceStart,
      sourceEnd: closing.sourceEnd,
    });
    // A page never holds another (the parser closes one before opening
    // the next), so the scan goes on past it.
    i = end;
  }
  return out;
}

/** The block indices of `page` that a frame with `takes: take` receives
 *  (#983): the first heading of that level, or the page's contents. */
export function takenBlocks(page: Pick<ParsedComposedPage, 'firstHeadings' | 'tocRows'>, take: FrameTake | undefined): readonly number[] {
  if (take === undefined) return [];
  if (take === 'toc') return page.tocRows;
  const at = page.firstHeadings[take];
  return at === undefined ? [] : [at];
}

/** The modules `page` lays (#1062), as `resolvePageTemplate` takes them. */
export function pageModuleUses(page: Pick<ParsedComposedPage, 'modules'>): { name: string; template: string }[] {
  return page.modules.map((m) => ({ name: m.fence.name, template: m.fence.template }));
}
