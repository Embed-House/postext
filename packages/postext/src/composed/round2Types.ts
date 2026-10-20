/**
 * Composed pages, round 2 (#1051): draft types of DESIGN.md §12 (#1052).
 *
 * Not exported and not imported: each issue of the round moves its part
 * into `types.ts`, `composed/types.ts` or `vdt.ts` and deletes it here. When
 * the file is empty the last issue removes it.
 */
import type { BoundingBox, VDTDesignBlockOrigin } from '../vdt';
import type { ColorValue, Dimension, ElementPlacement, PageParity, PageRoleFilter } from '../types';

// §12.1 (C5 lands it; C8, C9 reuse it) -------------------------------------

export type VDTPathCommand =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Q'; x1: number; y1: number; x: number; y: number }
  | { op: 'Z' };

export interface VDTPathStroke {
  color: string;
  widthPx: number;
  dash?: number[];
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
}

export interface VDTPathMarker {
  kind: 'dot' | 'arrow';
  x: number;
  y: number;
  /** Radians, the direction the line arrives in (arrows point along it). */
  angle: number;
  sizePx: number;
  color: string;
}

export interface VDTDesignPathBlock extends VDTDesignBlockOrigin {
  kind: 'path';
  bbox: BoundingBox;
  subpaths: VDTPathCommand[][];
  fill?: string;
  fillRule?: 'nonzero' | 'evenodd';
  stroke?: VDTPathStroke;
  markers?: VDTPathMarker[];
}

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

/** `CalloutLabelConfig` additions (joined tab, §12.8; glyph icon, §12.9). */
export interface CalloutLabelRound2 {
  joined?: boolean;
  fillet?: Dimension;
  icon?: {
    kind?: 'resource' | 'glyph';
    glyph?: string;
    fontFamily?: string;
    fontWeight?: number;
    scale?: number;
    color?: ColorValue;
  };
}

// §12.2 (C4) ----------------------------------------------------------------

export type SidePosition = 'start' | 'center' | 'end' | number;

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

/** `LabelStyle` additions. */
export interface LabelStyleRound2 {
  align?: 'start' | 'center' | 'end';
  border?: { color: ColorValue; width: Dimension };
  radius?: Dimension;
  kind?: 'legend';
  leader?: LeaderStyle;
}

// §12.6 (C10), §12.7 (C11) --------------------------------------------------

/** `FrameGroupConfig` additions. */
export interface FrameGroupRound2 {
  kind?: 'stack' | 'row' | 'grid';
  columns?: number;
  columnGap?: Dimension;
  rowGap?: Dimension;
  rowAlign?: 'start' | 'center' | 'end' | 'stretch';
  repeat?: { frames: string[]; max?: number };
  /** C11: the group takes the page's `:::module` blocks in Markdown order. */
  modules?: boolean;
  /** C11: where whole modules that do not fit go on. */
  overflow?: { continueIn?: string };
}

/** `FrameConfig` addition (§12.10). */
export interface FrameRound2 {
  overlap?: 'check' | 'allow';
}

// §12.8 (C9) ----------------------------------------------------------------

export interface DesignPathElement {
  kind: 'path';
  id: string;
  parity?: PageParity;
  pages?: PageRoleFilter;
  pin?: boolean;
  reserve?: boolean;
  placement: ElementPlacement;
  d: string;
  viewBox?: [number, number];
  fill?: ColorValue;
  stroke?: ColorValue;
  width?: Dimension;
  dash?: Dimension[];
  preserveAspectRatio?: 'none' | 'meet';
}
