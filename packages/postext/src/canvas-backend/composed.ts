/**
 * A composed page's frames on the canvas (#855): each frame's blocks
 * painted as floats are, turned by the frame's matrix and clipped to its
 * box when its content overflows, in layer order, with the template's
 * decoration at layer 0 (`composedPaintOrder`). On a page of a spread
 * (#861) all of it is clipped to the page's share of the sheet.
 */
import type { VDTBlock, VDTComicPage, VDTDesignSlot, VDTFrame, VDTPage } from '../vdt';
import { comicFramePaintOrder, composedPaintOrder, decorationOver, decorationUnder, composedSheetClip, composedSheetClipOnSheet, frameClips, frameContentRect, frameMatrix, type ComposedPaintPart } from '../composed/paint';
import { renderBlock } from './blockRender';
import { setVerticalPaint } from './verticalText';
import { withoutMirroredPaint } from './mirrorFrame';
import type { CjkRegion } from '../types';
import { renderHeaderFooterSlot } from './headerFooter';
import { restoreContext, saveContext } from './contextState';

/**
 * Paint the frames of `page.composed` in their paint order. With
 * `decoration` the template's decoration is painted between the layers
 * below 0 and the rest; without it (a page painted through a flow frame,
 * whose decoration stands on the sheet) it is left to the caller, who
 * paints the frames under it (`part: 'below'`) and over it (`'above'`)
 * in two calls.
 */
/** What a vertical frame's text is painted with (#944): the document's
 *  `cjk.region` and `cjk.uprightDigits`. */
export interface FrameCjkPaint {
  region: CjkRegion;
  uprightDigits: number;
}

export function renderComposedFrames(
  ctx: CanvasRenderingContext2D,
  page: VDTPage,
  inkHex: string | null,
  decoration: VDTDesignSlot | undefined,
  part?: ComposedPaintPart,
  cjk: FrameCjkPaint = { region: 'mainland', uprightDigits: 2 },
): void {
  const sheet = composedSheetClip(page);
  if (sheet) {
    saveContext(ctx);
    ctx.beginPath();
    ctx.rect(sheet.x, sheet.y, sheet.width, sheet.height);
    ctx.clip();
  }
  for (const item of composedPaintOrder(page, part)) {
    if (item.kind === 'decoration' || item.kind === 'over') {
      // The decoration at layer 0, and its connectors over the frames
      // (#1076) after them.
      const slot = item.kind === 'over' ? decorationOver(decoration) : decorationUnder(decoration);
      if (slot) renderHeaderFooterSlot(ctx, slot, inkHex);
      continue;
    }
    renderFrameBlocks(ctx, item.frame, item.blocks, inkHex, cjk);
  }
  if (sheet) restoreContext(ctx);
}

/** A frame's blocks, turned (and scaled) by its matrix and clipped to its
 *  box when its content overflows; a frame with an outline of its own (a
 *  comic panel cut by a slanted line, #885) is clipped to it. */
function renderFrameBlocks(ctx: CanvasRenderingContext2D, frame: VDTFrame, blocks: readonly VDTBlock[], inkHex: string | null, cjk?: FrameCjkPaint): void {
  if (blocks.length === 0) return;
  // A vertical frame of a right-to-left page (#960) is placed by a matrix
  // that includes the page's mirror: its text is not turned back again.
  if (frame.unmirrorX !== undefined) withoutMirroredPaint(() => renderFrameInMode(ctx, frame, blocks, inkHex, cjk));
  else renderFrameInMode(ctx, frame, blocks, inkHex, cjk);
}

function renderFrameInMode(ctx: CanvasRenderingContext2D, frame: VDTFrame, blocks: readonly VDTBlock[], inkHex: string | null, cjk?: FrameCjkPaint): void {
  // A frame set in its own writing mode (#944): its text is painted as a
  // page of that mode paints its flow, the vertical painter on (or off).
  if (frame.writingMode) {
    const outer = setVerticalPaint(frame.writingMode === 'vertical-rl'
      ? { region: cjk?.region ?? 'mainland', uprightDigits: cjk?.uprightDigits ?? 2, ...(frame.centralBaselines ? { axes: frame.centralBaselines } : {}) }
      : null);
    try {
      paintFrameBlocks(ctx, frame, blocks, inkHex);
    } finally {
      setVerticalPaint(outer);
    }
    return;
  }
  paintFrameBlocks(ctx, frame, blocks, inkHex);
}

function paintFrameBlocks(ctx: CanvasRenderingContext2D, frame: VDTFrame, blocks: readonly VDTBlock[], inkHex: string | null): void {
  const m = frameMatrix(frame);
  const clips = frameClips(frame);
  const outline = frame.polygon && frame.polygon.length >= 3 ? frame.polygon : undefined;
  if (!m && !clips && !outline) {
    for (const b of blocks) renderBlock(ctx, b, b.bbox.width, b.bbox.x, inkHex);
    return;
  }
  saveContext(ctx);
  if (outline) {
    ctx.beginPath();
    ctx.moveTo(outline[0]!.x, outline[0]!.y);
    for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i]!.x, outline[i]!.y);
    ctx.closePath();
    ctx.clip();
  }
  if (m) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  if (clips) {
    // In the blocks' own frame: a frame whose text is scaled (#858) was
    // laid out larger than its box.
    const box = frameContentRect(frame);
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
  }
  for (const b of blocks) renderBlock(ctx, b, b.bbox.width, b.bbox.x, inkHex);
  restoreContext(ctx);
}

/** The text frames of a comic page (`::panel{text}`, #885), over its
 *  panels (`comicFramePaintOrder`). */
export function renderComicTextFrames(ctx: CanvasRenderingContext2D, page: VDTPage, inkHex: string | null, comic: VDTComicPage | undefined = page.comic): void {
  for (const item of comicFramePaintOrder(page, comic)) if (item.kind === 'frame') renderFrameBlocks(ctx, item.frame, item.blocks, inkHex);
}

/** A composed page's decoration painted on the sheet (a page painted
 *  through a flow frame), clipped to its share of a spread's sheet: the
 *  part under the frames of layer 0 and up, or (`'over'`, #1076) the part
 *  painted after every frame. */
export function renderComposedDecoration(ctx: CanvasRenderingContext2D, page: VDTPage, inkHex: string | null, which: 'under' | 'over' = 'under'): void {
  const decoration = which === 'over' ? decorationOver(page.composed?.decoration) : decorationUnder(page.composed?.decoration);
  if (!decoration) return;
  const sheet = composedSheetClipOnSheet(page);
  if (!sheet) {
    renderHeaderFooterSlot(ctx, decoration, inkHex);
    return;
  }
  saveContext(ctx);
  ctx.beginPath();
  ctx.rect(sheet.x, sheet.y, sheet.width, sheet.height);
  ctx.clip();
  renderHeaderFooterSlot(ctx, decoration, inkHex);
  restoreContext(ctx);
}
