/**
 * Composed pages, round 2 (#1051): draft types of DESIGN.md §12 (#1052).
 *
 * Not exported and not imported: each issue of the round moves its part
 * into `types.ts`, `composed/types.ts` or `vdt.ts` and deletes it here. When
 * the file is empty the last issue removes it.
 */
import type { ColorValue, Dimension, LineCap } from '../types';

// §12.4 (C6; the connector of §12.3 and `LineCap` are in `types.ts` since C5)

export interface LeaderStyle {
  color?: ColorValue;
  width?: Dimension;
  dash?: Dimension[];
  startCap?: LineCap;
  endCap?: LineCap;
}

/** `ResourceAnchor` additions (§12.4). */
export interface ResourceAnchorRound2 {
  labelAt?: { x: number; y: number };
  leader?: boolean | LeaderStyle;
}

// §12.5 (C7) ----------------------------------------------------------------

/** `LabelStyle` additions (`align`, `border`, `radius` and `kind` are in
 *  `composed/types.ts` since C7, #1058). */
export interface LabelStyleRound2 {
  leader?: LeaderStyle;
}
