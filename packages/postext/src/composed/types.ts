/**
 * Composed pages (#846): draft types from the design in `DESIGN.md` (#847).
 *
 * Nothing imports this module yet; P2 (#853) moves the config types into
 * `types.ts`, P3 (#854) the document nodes into the parser, P4 (#855) the
 * VDT nodes into `vdt.ts`.
 */
import type {
  CalloutPaddingConfig,
  ColorValue,
  DesignSlot,
  Dimension,
  ElementPlacement,
} from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** A frame size: fixed, `'auto'` (content, clamped to min/max) or `'fill'`
 *  (what is left up to the anchor's edge). A percentage is of the template's
 *  area. */
export type FrameSize = Dimension | { percent: number } | 'auto' | 'fill';

export interface FrameGridCell {
  /** 1-based column and row of the template grid. */
  col: number;
  row: number;
  cols?: number;
  rows?: number;
}

export interface FrameFitConfig {
  /** Shrink the frame's text when nothing else makes it fit. Default true. */
  shrinkText?: boolean;
  /** Smallest text scale. Default 0.9. */
  minScale?: number;
  /** Scale flexible pictures inside the frame. Default true. */
  scaleImages?: boolean;
  /** Smallest picture scale. Default 0.8. */
  imageMinScale?: number;
}

export interface FrameOverflowConfig {
  /** `'#frame'`, `'next-page'` or `'template:<id>'`. */
  continueIn?: string;
  /** Continuation mark at the end of a cut piece; unset = the localized
   *  default; `false` = none. */
  mark?: string | false;
}

export interface FrameConfig {
  /** The slot name. Unique per template. */
  name: string;
  placement?: ElementPlacement;
  grid?: FrameGridCell;
  width?: FrameSize;
  height?: FrameSize;
  minWidth?: Dimension;
  maxWidth?: Dimension;
  minHeight?: Dimension;
  maxHeight?: Dimension;
  /** A `calloutStyles` id. Unset: a frameless box. */
  style?: string;
  /** Paint order. Default 1; decoration is 0; negative paints below it. */
  layer?: number;
  /** Degrees, clockwise. Box and content turn together. */
  rotate?: number;
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'justify';
  columns?: number;
  columnGap?: Dimension;
  /** Overrides the style's padding. */
  padding?: CalloutPaddingConfig;
  /** `'push'`: text of other frames wraps around this one. Default `'none'`. */
  exclude?: 'none' | 'push';
  /** Receives content that names no slot. */
  flow?: boolean;
  /** Chain: content that does not fit continues in this frame. */
  next?: string;
  /** Receives the first heading of this level that names no slot. */
  takes?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  /** Never moves or resizes. */
  pin?: boolean;
  grow?: number;
  shrink?: number;
  /** Lower yields first. Default 0. */
  priority?: number;
  fit?: FrameFitConfig;
  overflow?: FrameOverflowConfig;
  /** No `slotEmpty` warning when nothing is poured in. */
  optional?: boolean;
  writingMode?: 'horizontal-tb' | 'vertical-rl';
  direction?: 'ltr' | 'rtl';
  /** In a template patch (`extends`, `variants`): drop the inherited frame. */
  remove?: boolean;
}

export interface FrameGroupConfig {
  name: string;
  kind: 'stack' | 'row';
  /** Order on the page: top to bottom (stack), start to end (row). */
  frames: string[];
  gap?: Dimension;
  placement?: ElementPlacement;
  grid?: FrameGridCell;
  align?: 'start' | 'center' | 'end' | 'space-between';
  remove?: boolean;
}

export interface PageTemplateGrid {
  columns: number;
  rows: number;
  columnGap?: Dimension;
  rowGap?: Dimension;
}

/** The fields a variant or a child template may override. */
export interface PageTemplatePatch {
  area?: 'content' | 'trim' | 'bleed';
  grid?: PageTemplateGrid;
  frames?: FrameConfig[];
  groups?: FrameGroupConfig[];
  decoration?: DesignSlot;
  /** `false` hides; unset inherits the running section's. */
  header?: DesignSlot | false;
  footer?: DesignSlot | false;
  overflowTemplate?: string;
  bodyStyle?: string;
  palette?: string;
}

export interface PageTemplate extends PageTemplatePatch {
  id: string;
  name?: string;
  extends?: string;
  /** Two facing pages laid as one sheet. */
  spread?: boolean;
  /** The spine band of a spread. Default 0. */
  gutter?: Dimension;
  variants?: { recto?: PageTemplatePatch; verso?: PageTemplatePatch };
  /** Page role reported to design slots. Default `'composed'`. */
  role?: string;
}

export interface LabelStyle {
  id: string;
  name?: string;
  /** A paragraph style whose type the label borrows. */
  paragraphStyle?: string;
  fontFamily?: string;
  fontSize?: Dimension;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  color?: ColorValue;
  textTransform?: 'none' | 'uppercase';
  letterSpacing?: number;
  halo?: { color: ColorValue; width: Dimension };
  background?: ColorValue;
  padding?: Dimension;
  /** Smallest scale when a label does not fit its width. Default 0.85. */
  minScale?: number;
}

/** Label fields added to the comics `ResourceAnchor` (#557). */
export interface ResourceAnchorLabelFields {
  /** Label measure, fraction of the picture width. */
  width?: number;
  align?: 'start' | 'center' | 'end';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Degrees, clockwise. */
  rotate?: number;
  /** A `labelStyles` id. */
  style?: string;
}

export interface ContentInConfigCheck {
  enabled?: boolean;
  allow?: string[];
  maxWords?: number;
  maxChars?: number;
}

/** New top-level config keys. */
export interface ComposedPagesConfigKeys {
  pageTemplates?: PageTemplate[];
  labelStyles?: LabelStyle[];
  checks?: { contentInConfig?: ContentInConfigCheck };
}

// ---------------------------------------------------------------------------
// Document (parser output)
// ---------------------------------------------------------------------------

export interface SourceRange {
  sourceStart: number;
  sourceEnd: number;
}

/** A `::::page{template}` fence. */
export interface ComposedPageNode extends SourceRange {
  type: 'composedPage';
  template: string;
  spread: boolean;
  attrs: Record<string, string>;
  attrSources: Record<string, SourceRange>;
  /** Ordinal of the fence in its chapter: the same in every locale. */
  fenceIndex: number;
  /** Indices of content blocks per slot, in Markdown order. */
  slots: Record<string, number[]>;
  /** Blocks that name no slot. */
  unassigned: number[];
}

export interface FigureLabelNode extends SourceRange {
  text: string;
  at: { anchor: string } | { x: number; y: number };
  style?: string;
  sourceMap?: number[];
}

// ---------------------------------------------------------------------------
// Layout (VDT)
// ---------------------------------------------------------------------------

export type ReflowEventKind =
  | 'grew'
  | 'moved'
  | 'resized'
  | 'imageScaled'
  | 'textScaled'
  | 'continued'
  | 'overflow';

export interface ReflowEvent {
  frame: string;
  kind: ReflowEventKind;
  fromMm?: number;
  toMm?: number;
  scale?: number;
  /** The frame whose growth caused this event. */
  cause?: string;
}

export interface VDTFrame {
  /** `cp<fenceIndex>:<slot>`, `~<n>` for the n-th continuation piece. */
  id: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  rotate: number;
  layer: number;
  styleId?: string;
  /** Text scale the ladder applied (1 = none). */
  scale: number;
  /** Height the content still lacks (0 = fits). */
  overflowPx: number;
  continuedFrom?: string;
  continuesTo?: string;
  /** Ids of the blocks (in `page.floats` / `doc.blocks`) set in this frame. */
  blockIds: string[];
  /** `/pageTemplates/<i>/frames/<j>`. */
  configPath: string;
  sourceStart?: number;
  sourceEnd?: number;
}

export interface VDTComposedPage extends SourceRange {
  template: string;
  variant?: 'recto' | 'verso';
  spread?: 'left' | 'right';
  fenceIndex: number;
  frames: VDTFrame[];
  log: ReflowEvent[];
}

export type FrameOverflowProposal =
  | { kind: 'allowShrink'; path: string; value: number }
  | { kind: 'raiseMax'; path: string; value: Dimension }
  | { kind: 'lowerMin'; path: string; value: Dimension }
  | { kind: 'continueNextPage'; path: string }
  | { kind: 'useTemplate'; template: string }
  | { kind: 'shortenText'; chars: number };

export interface FrameOverflowWarningData {
  pageIndex: number;
  template: string;
  frame: string;
  locale?: string;
  overflowMm: number;
  stepsTried: string[];
  scale: number;
  proposals: FrameOverflowProposal[];
}
