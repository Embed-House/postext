/**
 * Start and end edges of a placement (#936): `top-start`, `start`,
 * `bottom-start`, their `end` counterparts and `align-start` /
 * `align-end`, read on the side the page's lines start from. A template's
 * decoration and running heads are laid on the sheet, where that side is
 * the right of a right-to-left page (and of a vertical one, whose lines
 * follow each other from the right); its frames are laid in the page's
 * flow frame, already mirrored or turned, where it is always the left. So
 * one element written `top-start` stands by the title frame in every
 * edition.
 *
 * With such an edge the offset's `x` runs from the start side to the end
 * side: on a page that starts on the right a positive `x` moves the
 * element left, so the element is the mirror image of the left-to-right
 * one.
 */
import type { AnchorEdge, ElementPlacement } from '../types';

const LOGICAL: Record<string, readonly [AnchorEdge, AnchorEdge]> = {
  // [the start on the left, the start on the right]
  'top-start': ['top-left', 'top-right'],
  start: ['left', 'right'],
  'bottom-start': ['bottom-left', 'bottom-right'],
  'top-end': ['top-right', 'top-left'],
  end: ['right', 'left'],
  'bottom-end': ['bottom-right', 'bottom-left'],
  'align-start': ['align-left', 'align-right'],
  'align-end': ['align-right', 'align-left'],
};

/** Whether `edge` is a start or end edge. */
export function isLogicalEdge(edge: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOGICAL, edge);
}

/** The physical edge `edge` names when the start is on the right
 *  (`startRight`) or on the left; any other edge unchanged. */
export function physicalEdge(edge: AnchorEdge, startRight: boolean): AnchorEdge {
  const pair = LOGICAL[edge];
  return pair ? pair[startRight ? 1 : 0] : edge;
}

/** `placement` with a start or end edge turned into the physical one, the
 *  offset's `x` reversed when the start is on the right; any other
 *  placement as it is. */
export function physicalPlacement<P extends ElementPlacement>(placement: P, startRight: boolean): P {
  const edge = placement.anchor.edge;
  if (!isLogicalEdge(edge)) return placement;
  const x = placement.offset?.x;
  return {
    ...placement,
    anchor: { ...placement.anchor, edge: physicalEdge(edge, startRight) },
    ...(startRight && x && x.value !== 0 ? { offset: { ...placement.offset, x: { ...x, value: -x.value } } } : {}),
  };
}
