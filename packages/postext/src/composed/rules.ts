/**
 * Ruled frames (#914): `FrameConfig.rules` draws one rule at the foot of
 * each line slot of a frame's content box, as many as its height holds, so
 * an answer space follows its frame: an `'auto'` frame given
 * `:::space{lines=4}` gets four rules, one that grows gets more.
 *
 * A frame that holds a box (content, or a style) carries its rules on the
 * box's decoration (`VDTBlock.designOverlay`), over its background and
 * under its text, in the box's laid-out coordinates (a frame whose text the
 * ladder scales is laid out `1 / scale` as large: the rules keep their
 * drawn pitch and thickness). An empty frame carries them on
 * `VDTFrame.rules` in page coordinates; the template's decoration paints
 * them (`headerFooter.ts`).
 */
import type { ResolvedCalloutStyleConfig } from '../types.js';
import type { VDTDesignRuleBlock } from '../vdt.js';
import { createBoundingBox } from '../vdt.js';
import { dimensionToPx } from '../units.js';
import type { Rect } from './geometry.js';
import type { FrameRulesConfig } from './types.js';

/** The rules' colour when the frame sets none. */
export const DEFAULT_RULE_COLOR = '#9a9a9a';
/** Their thickness when it sets none (pt). */
const DEFAULT_RULE_PT = 0.5;

/** The leading of a frame's text: its style's body (px). */
export function frameLinePx(style: ResolvedCalloutStyleConfig, dpi: number): number {
  const sizePx = dimensionToPx(style.body.fontSize, dpi);
  return dimensionToPx(style.body.lineHeight, dpi, sizePx);
}

/**
 * The rules across `inner` (a content box): one at the foot of each slot
 * of the pitch, as many as fit, each `inset` short of both sides. Lengths
 * the frame writes are divided by `scale` (the box is laid out that much
 * larger and painted at `scale`); the `'line'` pitch is the text's own,
 * `linePx`, which scales with it.
 */
export function frameRuleBlocks(
  rules: FrameRulesConfig,
  inner: Rect,
  linePx: number,
  scale: number,
  dpi: number,
  emPx: number,
): VDTDesignRuleBlock[] {
  const len = (d: Parameters<typeof dimensionToPx>[0]): number => dimensionToPx(d, dpi, emPx) / scale;
  const pitch = rules.every === undefined || rules.every === 'line' ? linePx : len(rules.every);
  if (!(pitch > 0.5)) return [];
  const thickness = rules.width ? len(rules.width) : (DEFAULT_RULE_PT / 72) * dpi / scale;
  const inset = rules.inset;
  const left = !inset ? 0 : 'value' in inset ? len(inset) : inset.left ? len(inset.left) : 0;
  const right = !inset ? 0 : 'value' in inset ? len(inset) : inset.right ? len(inset.right) : 0;
  const width = inner.width - left - right;
  if (width <= 0) return [];
  const count = Math.floor((inner.height + 0.5) / pitch);
  const color = rules.color?.hex ?? DEFAULT_RULE_COLOR;
  const out: VDTDesignRuleBlock[] = [];
  for (let k = 1; k <= count; k++) {
    out.push({
      kind: 'rule',
      bbox: createBoundingBox(inner.x + left, inner.y + k * pitch - thickness, width, thickness),
      color,
      thicknessPx: thickness,
      direction: 'horizontal',
    });
  }
  return out;
}
