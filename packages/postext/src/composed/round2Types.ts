/**
 * Composed pages, round 2 (#1051): draft types of DESIGN.md §12 (#1052).
 *
 * Not exported and not imported: each issue of the round moves its part
 * into `types.ts`, `composed/types.ts` or `vdt.ts` and deletes it here. When
 * the file is empty the last issue removes it.
 */
import type { ColorValue, Dimension, PageParity, PageRoleFilter, SidePosition } from '../types';

// §12.1, §12.8 (C8) ---------------------------------------------------------

export interface VDTDesignBoxStyleRound2 {
  borderRadiiPx?: [number, number, number, number];
  borderSides?: Record<'top' | 'right' | 'bottom' | 'left', { color: string; widthPx: number } | null>;
}

export type CornerRadius =
  | Dimension
  | { topLeft?: Dimension; topRight?: Dimension; bottomRight?: Dimension; bottomLeft?: Dimension };

export interface BorderSide {
  enabled?: boolean;
  color?: ColorValue;
  width?: Dimension;
}

export interface BorderSides {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
}

/** `CalloutLabelConfig` additions (joined tab, §12.8; the glyph icon of
 *  §12.9 is in `types.ts` since C3). */
export interface CalloutLabelRound2 {
  joined?: boolean;
  fillet?: Dimension;
}

// §12.3, §12.4 (C5, C6) -----------------------------------------------------

export type LineCap = 'none' | 'dot' | 'arrow';

export interface ConnectorEnd {
  to: `#${string}`;
  side?: 'top' | 'bottom' | 'left' | 'right' | 'start' | 'end';
  at?: SidePosition;
  gap?: Dimension;
  /** C6: an anchor of the picture the frame holds. */
  anchor?: string;
}

export interface DesignConnectorElement {
  kind: 'connector';
  id: string;
  parity?: PageParity;
  pages?: PageRoleFilter;
  pin?: boolean;
  from: ConnectorEnd;
  to: ConnectorEnd | ConnectorEnd[];
  routing?: 'straight' | 'elbow' | 'tree';
  radius?: Dimension;
  trunk?: number;
  color?: ColorValue;
  width?: Dimension;
  dash?: Dimension[];
  startCap?: LineCap;
  endCap?: LineCap;
  capSize?: Dimension;
}

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

// §12.7 (C11) --------------------------------------------------

/** `FrameGroupConfig` additions (C10's grid and repeat are in `types.ts`). */
export interface FrameGroupRound2 {
  /** C11: the group takes the page's `:::module` blocks in Markdown order. */
  modules?: boolean;
  /** C11: where whole modules that do not fit go on. */
  overflow?: { continueIn?: string };
}
