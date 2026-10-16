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
import type { ContentBlock } from '../parse/types';
import type { ComposedPageNode, SourceRange } from './types';

/** Heading levels a template frame may `take`. */
export type HeadingTake = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/** A composed page as the parser read it: the design's
 *  {@link ComposedPageNode} plus what the slot checks need. */
export interface ParsedComposedPage extends ComposedPageNode {
  /** Source range of the first `slot="…"` value of each slot. */
  slotSources: Record<string, SourceRange>;
  /** The first heading of each level that names no slot (its block
   *  index), which a frame with `takes` receives. */
  firstHeadings: Partial<Record<HeadingTake, number>>;
  /** Source range of the fence line. */
  fence: SourceRange;
  /** The fence had no closing fence of its length (reported by the
   *  parser as `unclosedContainer`). */
  unclosed: boolean;
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
    let k = i + 1;
    while (k < end) {
      const b = blocks[k]!;
      if (b.type === 'containerStart') {
        const e = endOf(blocks, k);
        if (b.containerName === 'frame') put(b.slot, range(k + 1, e - 1));
        else put(b.slot, range(k, e));
        k = e + 1;
        continue;
      }
      if (b.type === 'heading' && !b.slot && b.level !== undefined) {
        const take = `h${b.level}` as HeadingTake;
        if (firstHeadings[take] === undefined) firstHeadings[take] = k;
      }
      put(b.slot, [k]);
      k++;
    }
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
