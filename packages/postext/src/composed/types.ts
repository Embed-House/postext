/**
 * Composed pages (#846): the types of the design in `DESIGN.md` (#847).
 *
 * The configuration part (page templates, frames, groups, label styles) is
 * public since P2 (#853): `types.ts` re-exports it and `PostextConfig`
 * carries `pageTemplates` and `labelStyles`. The document nodes are the
 * parser's (P3, #854) and the VDT nodes the layout's (P4, #855).
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

/** A frame size: fixed (a `Dimension`), a percentage of the template's
 *  area (`{ percent: 50 }`), `'auto'` (the content's own size, clamped to
 *  the frame's min/max) or `'fill'` (what is left up to the edge the frame
 *  is anchored to, as in design slots). */
export type FrameSize = Dimension | { percent: number } | 'auto' | 'fill';

export interface FrameGridCell {
  /** 1-based column and row of the template grid. */
  col: number;
  row: number;
  /** Columns and rows the frame spans. Default 1. */
  cols?: number;
  rows?: number;
}

export interface FrameFitConfig {
  /** Shrink the frame's text when nothing else makes it fit. Default true. */
  shrinkText?: boolean;
  /** Smallest text scale, above 0 and at most 1. Default 0.9. */
  minScale?: number;
  /** Scale flexible pictures inside the frame. Default true. */
  scaleImages?: boolean;
  /** Smallest picture scale, above 0 and at most 1. Default 0.8. */
  imageMinScale?: number;
  /** A frame whose `overflow.continueIn` sends content to another page
   *  (`'next-page'`, `'template:<id>'`, `'page:<id>'`) goes on there
   *  before its pictures or its text shrink, so a story keeps one size
   *  from page to page (#920). `false`: shrink first and go on only when
   *  shrinking is not enough. Default true. */
  preferContinue?: boolean;
}

export interface FrameOverflowConfig {
  /** Where content that does not fit goes on: `'#frame'` (another frame of
   *  the same page, as `next`), `'next-page'` (the same frame on a page
   *  added after this one) or `'template:<id>'` (a page of that template).
   *  Unset: nowhere; the frame runs the reflow ladder and warns. */
  continueIn?: string;
  /** Continuation mark at the end of a cut piece; unset = the localized
   *  default; `false` = none. */
  mark?: string | false;
}

export interface FrameConfig {
  /** The slot name. Unique per template. */
  name: string;
  /** Anchor, offset and size, in the language of design slots;
   *  `anchor.to` may be `'#frame'` or `'#group'`. Ignored when `grid` is
   *  set. Neither: the frame takes the whole area. */
  placement?: ElementPlacement;
  /** A cell of the template's `grid`. Wins over `placement`; ignored when
   *  the template has no grid. */
  grid?: FrameGridCell;
  /** Default: `placement.size.width`, else `'fill'`. */
  width?: FrameSize;
  /** Default: `placement.size.height`, else `'auto'`. */
  height?: FrameSize;
  minWidth?: Dimension;
  maxWidth?: Dimension;
  minHeight?: Dimension;
  maxHeight?: Dimension;
  /** A `calloutStyles` id. Unset: a frameless box. */
  style?: string;
  /** Paint order. Default 1; decoration is 0; negative paints below it. */
  layer?: number;
  /** Degrees, clockwise. Box and content turn together. Default 0. */
  rotate?: number;
  /** Where the content sits in a frame taller than it. Default `'top'`. */
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'justify';
  /** Default 1. */
  columns?: number;
  columnGap?: Dimension;
  /** Overrides the style's padding, side by side. */
  padding?: CalloutPaddingConfig;
  /** `'push'`: text of other frames wraps around this one. Default `'none'`. */
  exclude?: 'none' | 'push';
  /** What the text of other frames runs round when this frame pushes it
   *  (`exclude: 'push'`, #883): `'box'` (the default), the frame's box;
   *  `'contour'`, the shape of the pictures it holds (`Resource.contour`:
   *  a polygon or the bitmap's alpha channel), each line set as short as
   *  the shape is wide beside it. A frame whose pictures have no known
   *  shape, or a turned frame, pushes with its box. */
  wrap?: 'box' | 'contour';
  /** Receives content that names no slot. */
  flow?: boolean;
  /** Chain: content that does not fit continues in this frame. */
  next?: string;
  /** Receives the first heading of this level that names no slot. */
  takes?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  /** Never moves or resizes. */
  pin?: boolean;
  /** Share of a group's spare space this frame takes. Default 0. */
  grow?: number;
  /** Whether (and how much) this frame gives space back in a group. Default 0. */
  shrink?: number;
  /** Lower yields first. Default 0. */
  priority?: number;
  fit?: FrameFitConfig;
  overflow?: FrameOverflowConfig;
  /** No `slotEmpty` warning when nothing is poured in. */
  optional?: boolean;
  /** On a spread template: the frame may cross the spine band (`gutter`). */
  crossGutter?: boolean;
  writingMode?: 'horizontal-tb' | 'vertical-rl';
  direction?: 'ltr' | 'rtl';
  /** In a template patch (`extends`, `variants`): drop the inherited frame. */
  remove?: boolean;
}

export interface FrameGroupConfig {
  /** Unique per template, and distinct from every frame name (anchors
   *  name both as `'#name'`). */
  name: string;
  /** Default `'stack'`. */
  kind?: 'stack' | 'row';
  /** Order on the page: top to bottom (stack), start to end (row). A frame
   *  belongs to at most one group. */
  frames?: string[];
  /** Default 0. */
  gap?: Dimension;
  /** The group's own box. Neither this nor `grid`: the union of its
   *  frames' declared boxes. */
  placement?: ElementPlacement;
  grid?: FrameGridCell;
  /** Where spare space goes. Default `'start'`. */
  align?: 'start' | 'center' | 'end' | 'space-between';
  /** In a template patch: drop the inherited group. */
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
  /** The rectangle frame coordinates refer to. Default `'content'` (the
   *  page's content area, mirrored per parity like the flow). */
  area?: 'content' | 'trim' | 'bleed';
  /** Merged key by key over the parent's. */
  grid?: PageTemplateGrid;
  /** Merged by `name` over the parent's (`remove: true` drops one). */
  frames?: FrameConfig[];
  /** Merged by `name` over the parent's (`remove: true` drops one). */
  groups?: FrameGroupConfig[];
  /** Elements merged by `id` over the parent's; elements with no id are
   *  added. */
  decoration?: DesignSlot;
  /** `false` hides; unset inherits the running section's. */
  header?: DesignSlot | false;
  footer?: DesignSlot | false;
  /** Template of the pages added by continuation (`overflow.continueIn:
   *  'next-page'`). Default: this template with only the continued frames
   *  filled. */
  overflowTemplate?: string;
  /** A paragraph style for the page's text. */
  bodyStyle?: string;
  /** A palette override, as heading styles have. */
  palette?: string;
}

export interface PageTemplate extends PageTemplatePatch {
  /** Required, unique among `pageTemplates`. */
  id: string;
  /** Shown in the Sandbox only. */
  name?: string;
  /** Id of a template whose fields this one inherits. */
  extends?: string;
  /** Two facing pages laid as one sheet, starting on a verso. */
  spread?: boolean;
  /** The spine band of a spread. Default 0. */
  gutter?: Dimension;
  /** Patches applied on a recto or a verso page, after `extends`. */
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
  /** Default `'normal'`. */
  fontStyle?: 'normal' | 'italic';
  color?: ColorValue;
  /** Default `'none'`. */
  textTransform?: 'none' | 'uppercase';
  letterSpacing?: number;
  halo?: { color: ColorValue; width: Dimension };
  background?: ColorValue;
  padding?: Dimension;
  /** Smallest scale when a label does not fit its width. Default 0.85. */
  minScale?: number;
}

/** New top-level config keys. `checks.contentInConfig` (DESIGN §2.8)
 *  belongs to #849, which adds it to `PostextConfig` itself. */
export interface ComposedPagesConfigKeys {
  pageTemplates?: PageTemplate[];
  labelStyles?: LabelStyle[];
}

// ---------------------------------------------------------------------------
// Configuration, resolved (`resolvePageTemplate`)
// ---------------------------------------------------------------------------

/** The physical side of a page: its variant. */
export type PageSide = 'recto' | 'verso';

export interface ResolvePageTemplateOptions {
  /** The side of the page the template is laid on: picks
   *  `variants.recto` or `variants.verso`. */
  parity?: PageSide;
  /** The caller lays a sheet of two pages: no variant applies (a spread
   *  has both sides). A `spread` template is always laid this way. */
  spread?: boolean;
}

export interface ResolvedFrameFit {
  shrinkText: boolean;
  minScale: number;
  scaleImages: boolean;
  imageMinScale: number;
  preferContinue: boolean;
}

export interface ResolvedFrame {
  name: string;
  placement?: ElementPlacement;
  /** Clamped to the template grid; absent when the template has none. */
  grid?: Required<FrameGridCell>;
  width: FrameSize;
  height: FrameSize;
  minWidth?: Dimension;
  maxWidth?: Dimension;
  minHeight?: Dimension;
  maxHeight?: Dimension;
  style?: string;
  layer: number;
  rotate: number;
  verticalAlign: 'top' | 'middle' | 'bottom' | 'justify';
  columns: number;
  columnGap?: Dimension;
  padding?: CalloutPaddingConfig;
  exclude: 'none' | 'push';
  /** `'contour'`: a pushing frame pushes with its pictures' shape (#883).
   *  Absent: with its box. */
  wrap?: 'contour';
  flow: boolean;
  next?: string;
  takes?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  pin: boolean;
  grow: number;
  shrink: number;
  priority: number;
  fit: ResolvedFrameFit;
  overflow: FrameOverflowConfig;
  optional: boolean;
  crossGutter: boolean;
  writingMode?: 'horizontal-tb' | 'vertical-rl';
  direction?: 'ltr' | 'rtl';
  /** JSON pointer of the most specific entry that sets this frame
   *  (`/pageTemplates/3/frames/2`, `/pageTemplates/3/variants/recto/frames/0`). */
  configPath: string;
  /** Per field as written: the JSON pointer of the entry whose value won. */
  fieldPaths: Record<string, string>;
}

export interface ResolvedFrameGroup {
  name: string;
  kind: 'stack' | 'row';
  frames: string[];
  gap: Dimension;
  placement?: ElementPlacement;
  grid?: Required<FrameGridCell>;
  align: 'start' | 'center' | 'end' | 'space-between';
  configPath: string;
  fieldPaths: Record<string, string>;
}

export interface ResolvedPageTemplate {
  id: string;
  name?: string;
  area: 'content' | 'trim' | 'bleed';
  grid?: Required<PageTemplateGrid>;
  /** In template order: the root's frames first, then each child's new ones. */
  frames: ResolvedFrame[];
  groups: ResolvedFrameGroup[];
  decoration: DesignSlot;
  /** JSON pointer of each decoration element, in `decoration.elements` order. */
  decorationPaths: string[];
  header?: DesignSlot | false;
  footer?: DesignSlot | false;
  /** JSON pointers of the `header` / `footer` the template takes (its
   *  own, or the one of the template it extends), when it sets one (#857). */
  headerPath?: string;
  footerPath?: string;
  overflowTemplate?: string;
  bodyStyle?: string;
  palette?: string;
  spread: boolean;
  gutter: Dimension;
  role: string;
  /** The variant applied, if any. */
  variant?: PageSide;
  /** The template and its ancestors, nearest first. */
  chain: string[];
  /** `/pageTemplates/<i>`. */
  configPath: string;
}

export interface ResolvedLabelStyle extends LabelStyle {
  fontStyle: 'normal' | 'italic';
  textTransform: 'none' | 'uppercase';
  minScale: number;
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

// `ReflowEventKind`, `ReflowEvent`, `VDTFrame` and `VDTComposedPage` live
// in `vdt.ts` with the rest of the VDT (#855).
export type { ReflowEventKind, ReflowEvent, VDTFrame, VDTComposedPage } from '../vdt';

// `FrameOverflowProposal` and `FrameFitStep` live in `vdt.ts` with the
// `frameOverflow` warning that carries them (#858).
export type { FrameOverflowProposal, FrameFitStep } from '../vdt';
