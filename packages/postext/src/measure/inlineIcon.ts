/**
 * Inline symbols (`:icon[alt]{…}`, #1058, DESIGN §12.5): the size of the
 * box each kind takes on a line. The box stands on the baseline; its
 * height is the text's capital height (0.75 em, as a swatch's side) unless
 * `size` gives it in ems. A picture keeps its proportions, a glyph is set
 * at the size whose capitals are that high and takes its advance, and a
 * line sample is twice as long as it is high, its stroke at half height.
 */

import type { InlineIcon } from '../parse/index.js';
import type { ResolvedResourceBlock, VDTInlineIcon, VDTLine } from '../vdt.js';
import { buildFontString } from './font.js';
import { measureTextWidth } from './canvas.js';
import { fontEm } from './vertical.js';
import { withPxSize } from './fontString.js';

/** The height of a capital, in ems: an icon's default height. */
export const ICON_CAP_EM = 0.75;
/** A line sample's length over its height. */
const LINE_SAMPLE_RATIO = 2;
/** A line sample's stroke, in ems of the text (one px at least). */
const LINE_SAMPLE_STROKE_EM = 0.09;

/** The symbol `icon` measured against the text's `font` (a CSS font
 *  string): its box and what the painters need. `color` is the tint as
 *  resolved (a hex), `''` for none. */
export function measureInlineIcon(icon: InlineIcon, color: string, font: string): VDTInlineIcon {
  const em = fontEm(font);
  const heightPx = Math.max(1, (icon.size ?? ICON_CAP_EM) * em);
  const tint = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color) ? color : undefined;
  const base = { alt: icon.alt, heightPx, ...(tint ? { color: tint } : {}) };
  if (icon.resource !== undefined) {
    const p = icon.picture;
    return {
      kind: 'resource',
      ...base,
      widthPx: heightPx * (p && p.aspect > 0 ? p.aspect : 1),
      resourceId: icon.resource,
      ...(p ? { fileId: p.fileId, ...(p.format ? { format: p.format } : {}), svg: p.svg } : {}),
    };
  }
  if (icon.glyph !== undefined) {
    const glyphPx = heightPx / ICON_CAP_EM;
    const fontString = icon.font ? buildFontString(icon.font, glyphPx) : withPxSize(font, () => glyphPx);
    return { kind: 'glyph', ...base, widthPx: measureTextWidth(icon.glyph, fontString), glyph: icon.glyph, fontString };
  }
  return {
    kind: 'line',
    ...base,
    widthPx: heightPx * LINE_SAMPLE_RATIO,
    line: icon.line ?? 'solid',
    strokePx: Math.max(1, LINE_SAMPLE_STROKE_EM * em),
  };
}

/** The dash pattern of a line sample (px, on and off), none when solid.
 *  A dotted line is drawn with round caps: dots of zero length. */
export function iconLineDash(icon: Pick<VDTInlineIcon, 'line' | 'strokePx'>): number[] | undefined {
  const w = icon.strokePx ?? 1;
  if (icon.line === 'dashed') return [3 * w, 2 * w];
  if (icon.line === 'dotted') return [0, 2 * w];
  return undefined;
}

/** The inline symbols a resource block paints (#1058): in its caption,
 *  its notes, its labels and its table's cells. What a renderer that
 *  embeds pictures up front (the PDF) reads. */
export function resourceBlockIcons(rb: ResolvedResourceBlock | undefined): VDTInlineIcon[] {
  if (!rb) return [];
  const out: VDTInlineIcon[] = [];
  const add = (lines: readonly VDTLine[] | undefined): void => {
    for (const line of lines ?? []) for (const seg of line.segments ?? []) if (seg.swatch?.icon) out.push(seg.swatch.icon);
  };
  add(rb.captionLines);
  add(rb.noteLines);
  add(rb.continuesLines);
  for (const label of rb.labels ?? []) add(label.layout?.lines);
  for (const cell of rb.table?.cells ?? []) add(cell.lines);
  return out;
}

/** Where a symbol is drawn on its segment: its box from the segment's left
 *  edge `x` and the line's `baseline`, and, for a line sample, the stroke's
 *  ends at half height. */
export function inlineIconBox(icon: VDTInlineIcon, x: number, baseline: number): { x: number; y: number; width: number; height: number; strokeY: number } {
  const left = x + (icon.insetPx ?? 0);
  return { x: left, y: baseline - icon.heightPx, width: icon.widthPx, height: icon.heightPx, strokeY: baseline - icon.heightPx / 2 };
}
