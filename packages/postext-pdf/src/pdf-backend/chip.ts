import type { Color, PDFFont } from 'pdf-lib';
import type { VDTChip, VDTChipRun } from 'postext';
import { parseFontString } from '../fontString.js';
import type { FontCache } from '../fontCache.js';
import { type PageCtx, drawChipBoxPx, drawTextDotsPx, drawTextPx, invisibleText } from './primitives.js';
import { tagArtifact, tagContent, type StructElem } from './tagging.js';
import { drawRightToLeftRun } from './rtlRun.js';

/**
 * Inline chip (`:chip[…]`): the box, flagged as a layout artifact in a
 * tagged render, then the words as real text joining `elem` — selectable
 * and read in order with the rest of the line. Without `elem` the drawing
 * joins whatever sequence is open. Shared with the resource-line painter.
 */
export function paintChip(
  ctx: PageCtx,
  chip: VDTChip,
  xPx: number,
  baselinePx: number,
  fontCache: FontCache,
  fallbackFont: PDFFont,
  fallbackSize: number,
  elem: StructElem | undefined,
  colorFor: (run: VDTChipRun) => Color,
): void {
  if (elem) tagArtifact(ctx, { type: 'Layout' });
  drawChipBoxPx(ctx, chip, xPx, baselinePx);
  tagContent(ctx, elem);
  let tx = xPx + chip.marginLeft + chip.borderWidth + chip.paddingX;
  // The runs in the chip's paint order (`VDTChip.order`), a right-to-left
  // one shaped so.
  const order = chip.order && chip.order.length === chip.runs.length ? chip.order : undefined;
  for (let k = 0; k < chip.runs.length; k++) {
    const run = chip.runs[order ? order[k]! : k]!;
    const font = fontCache.get(run.fontString) ?? fallbackFont;
    const size = parseFontString(run.fontString)?.sizePx ?? fallbackSize;
    const y = baselinePx + (run.baselineShift ?? 0);
    const color = colorFor(run);
    // Letters to trace (#1017): the dots, the text invisible under them.
    const outline = chip.dotted && drawTextDotsPx(ctx, run.text, tx, y, run.fontString, chip.dotted, color, run.rtl === true) ? invisibleText(color) : undefined;
    if (run.rtl) drawRightToLeftRun(ctx, run.text, tx, y, font, size, color, outline);
    else drawTextPx(ctx, run.text, tx, y, font, size, color, outline);
    tx += run.width;
  }
}
