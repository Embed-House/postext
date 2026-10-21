/**
 * Drawn icons (#1120): a ring or a dot the engine draws for a box's icon,
 * its marker or a label tab's icon (`kind: 'shape'`), so a coloured ring
 * before black words needs no font and no picture. The icon is a path
 * block (DESIGN §12.1), which every backend paints alike: a dot is a
 * filled circle, a ring the band between two circles filled even-odd.
 */
import type { CalloutIconShape } from '../types';
import { createBoundingBox, type VDTDesignPathBlock, type VDTPathCommand } from '../vdt';

/** Kappa: the control-point distance of a cubic quarter circle, as a
 *  fraction of its radius. */
const KAPPA = 0.5522847498307936;

/** A closed circle of radius `r` about `(cx, cy)`, four cubics walked
 *  clockwise on the sheet (y down). */
export function circleSubpath(cx: number, cy: number, r: number): VDTPathCommand[] {
  const k = r * KAPPA;
  return [
    { op: 'M', x: cx + r, y: cy },
    { op: 'C', x1: cx + r, y1: cy + k, x2: cx + k, y2: cy + r, x: cx, y: cy + r },
    { op: 'C', x1: cx - k, y1: cy + r, x2: cx - r, y2: cy + k, x: cx - r, y: cy },
    { op: 'C', x1: cx - r, y1: cy - k, x2: cx - k, y2: cy - r, x: cx, y: cy - r },
    { op: 'C', x1: cx + k, y1: cy - r, x2: cx + r, y2: cy - k, x: cx + r, y: cy },
    { op: 'Z' },
  ];
}

/** The line of a ring `diameter` across when the style names none: an
 *  eighth of it. */
export function defaultRingStroke(diameter: number): number {
  return diameter / 8;
}

/**
 * The drawn icon `shape`, `diameter` across, centred on `(cx, cy)`, in
 * `color`: a dot filled, a ring `strokePx` wide inside its outer edge
 * (held to half the diameter, where it is a dot). Marked `drawnIcon`, so
 * part palettes recolour it as the frame's icon.
 */
export function iconShapeBlock(
  shape: CalloutIconShape,
  cx: number,
  cy: number,
  diameter: number,
  color: string,
  strokePx = defaultRingStroke(diameter),
): VDTDesignPathBlock {
  const r = Math.max(0, diameter / 2);
  const bbox = createBoundingBox(cx - r, cy - r, 2 * r, 2 * r);
  const line = Math.max(0, Math.min(strokePx, r));
  if (shape === 'dot' || line >= r) {
    return { kind: 'path', bbox, subpaths: [circleSubpath(cx, cy, r)], fill: color, drawnIcon: true };
  }
  return {
    kind: 'path',
    bbox,
    subpaths: [circleSubpath(cx, cy, r), circleSubpath(cx, cy, r - line)],
    fill: color,
    fillRule: 'evenodd',
    drawnIcon: true,
  };
}
