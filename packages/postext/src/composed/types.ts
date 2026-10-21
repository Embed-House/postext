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
  DesignElement,
  DesignSlot,
  Dimension,
  ElementPlacement,
  LeaderStyle,
} from '../types.js';

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
   *  added after this one), `'template:<id>'` (a page of that template)
   *  or `'page:<id>'` (#917: a frame of the later page fence
   *  `::::page{id=…}`, the one it leaves empty, or the one named by
   *  `'page:<id>#<frame>'`; `<id>` may be `{attr.name}`, read from the
   *  fence). Unset: nowhere; the frame runs the reflow ladder and warns. */
  continueIn?: string;
  /** Continuation mark at the end of a cut piece; unset = the localized
   *  default; `false` = none. `{page}` is the number of the page the rest
   *  goes on on (#917). */
  mark?: string | false;
  /** Words at the head of the piece that goes on on another page, `{page}`
   *  being the number of the page it comes from (#917): "Continued from
   *  page {page}". The receiving frame's own, else the sending frame's.
   *  Unset: none. */
  fromMark?: string;
}

/** Ruled lines across a frame (#914): an answer space, a writing frame.
 *  One rule at the foot of each line slot of the frame's content box (its
 *  box less its padding), as many as fit its height, so an `'auto'` frame
 *  that receives `:::space{lines=4}` is ruled four times and a frame that
 *  grows gets more. */
export interface FrameRulesConfig {
  /** The pitch: `'line'` (the default), the leading of the frame's text
   *  (its style's body, else the book's), or a length. */
  every?: 'line' | Dimension;
  /** Default: a mid grey. */
  color?: ColorValue;
  /** The rules' thickness. Default 0.5 pt. */
  width?: Dimension;
  /** Room left at both ends of each rule, inside the content box, or per
   *  side. Default 0. */
  inset?: Dimension | { left?: Dimension; right?: Dimension };
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
  /** Receives the first heading of this level that names no slot, or
   *  (`'toc'`, #983) the rows of the page's `:::toc` that name no slot,
   *  laid by the contents' own rules (part rows, leaders, `keep`). */
  takes?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'toc';
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
  /** Ruled lines across the frame at a pitch (#914). */
  rules?: FrameRulesConfig;
  /** What this frame changes of its callout style's look (#976): colours,
   *  and the tracking of the body. A book with one box in a dozen tints
   *  keeps one style and writes the tint here. Merged key by key over the
   *  parent's in a patch. */
  look?: FrameLook;
  /** The overlap checks (#1053): `'allow'` leaves the frame out of
   *  `frameCovered`, as the frame painted over another (art meant to sit
   *  over text) and as the one painted under, and out of
   *  `frameOutsideArea` (a badge hung half off its card on purpose).
   *  Default `'check'`. */
  overlap?: 'check' | 'allow';
  /** In a template patch (`extends`, `variants`): drop the inherited frame. */
  remove?: boolean;
}

/** The fields of a callout style a frame may set for itself (#976), named
 *  and nested as in {@link CalloutStyleConfig}. A `background` also turns
 *  the style's fill on. */
export interface FrameLook {
  background?: ColorValue;
  border?: { color?: ColorValue };
  stripe?: { color?: ColorValue };
  icon?: { color?: ColorValue };
  marker?: { color?: ColorValue; rule?: { color?: ColorValue } };
  titleStyle?: { color?: ColorValue };
  /** Colours of the box's text, and its tracking (see
   *  `CalloutBodyStyleConfig.letterSpacing`, #974). */
  body?: { color?: ColorValue; boldColor?: ColorValue; italicColor?: ColorValue; letterSpacing?: Dimension };
  /** The label tab's colours; only on a style that has a tab. */
  label?: { color?: ColorValue; background?: ColorValue; rule?: { color?: ColorValue } };
}

/** A named look (#1089, `PostextConfig.frameLooks`): the fields of a
 *  {@link FrameLook} under an id a `:::frame{slot="…" look="<id>"}` piece
 *  names. The Markdown names the look, the config defines it; it is laid
 *  over the frame's style and the template frame's own `look`, for that
 *  piece only, so the items of a repeating grid can each wear a colour of
 *  their own. */
export interface FrameLookEntry extends FrameLook {
  /** Required, unique among `frameLooks`. */
  id: string;
  /** Shown in the Sandbox only. */
  name?: string;
}

/** The frame set a grid group lays once per content item (#1061, DESIGN
 *  §12.6). */
export interface FrameRepeatConfig {
  /** The frames of the set. The first is the cell's main frame: it takes
   *  the cell's width, and each `:::frame{slot="<main>"}` piece of the page
   *  is one item. The others are laid as the template draws them, anchored
   *  to the main frame or to each other. */
  frames: string[];
  /** The most items the grid takes; the rest goes to the flow frame
   *  (`repeatOverflow`). Unset: no limit. */
  max?: number;
}

export interface FrameGroupConfig {
  /** Unique per template, and distinct from every frame name (anchors
   *  name both as `'#name'`). */
  name: string;
  /** Default `'stack'`. `'grid'` (#1061): cells of `columns` columns,
   *  filled row by row from the start side, each row as tall as its
   *  tallest cell. */
  kind?: 'stack' | 'row' | 'grid';
  /** Order on the page: top to bottom (stack), start to end (row), cell
   *  after cell (grid). A frame belongs to at most one group. A grid that
   *  `repeat`s takes the set's frames instead. */
  frames?: string[];
  /** Grid: the number of columns. Default 1. */
  columns?: number;
  /** Grid: the space between columns, and between rows. Default 0 (a
   *  grid's `gap` is read for both when these are unset). */
  columnGap?: Dimension;
  rowGap?: Dimension;
  /** Grid: where a cell shorter than its row sits: `'stretch'` (the
   *  default) makes its main frame as tall as the row. A modules row or
   *  grid (#1088): where a module shorter than its row sits; `'stretch'`
   *  lays it in a box as tall as the row (its `'fill'` frames grow). */
  rowAlign?: 'start' | 'center' | 'end' | 'stretch';
  /** Grid: the frame set laid once per item of the page's content. */
  repeat?: FrameRepeatConfig;
  /** The group takes the page's `:::module` blocks (#1062, DESIGN §12.7),
   *  in Markdown order, `gap` between them. Its `frames` are not read. A
   *  `'stack'` lays them one under another, each as wide as the group (or
   *  its template's `width`) and as tall as its frames; a `'row'` (#1088)
   *  side by side, start to end, each as wide as its template's `width`
   *  or an equal share of what is left, the row as tall as its tallest
   *  module (`rowAlign`); a `'grid'` (#1088) in `columns` equal columns,
   *  row after row. */
  modules?: boolean;
  /** A modules group laid inside the modules group of this name (#1088):
   *  each run of the page's modules it takes (`templates`), one after
   *  another in Markdown order, is one item of that group, a row or a grid
   *  of its own where the first of the run comes. Only on a modules group,
   *  naming a modules group of the template; groups may lie inside each
   *  other to any depth (#1095), the outermost being the page's modules
   *  group. Inside a stack a run's rows are rows of the stack; inside a
   *  row or a grid a run is one cell (a share of the row). */
  within?: string;
  /** A modules group inside another (`within`, #1088): the module
   *  templates it takes. Unset: every module, unless other groups lie
   *  inside it (#1095): then only theirs. */
  templates?: string[];
  /** A modules group (#1062): where a module that does not fit goes on,
   *  whole (`'next-page'`, `'template:<id>'`). Unset: the module is laid
   *  cut at the group's foot and its frames run the reflow ladder. */
  overflow?: { continueIn?: string };
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

/** In a template patch (`extends`, `variants`): takes the decoration
 *  element `id` of the template it inherits out (#975), as `remove: true`
 *  does for a frame or a group. An id the patch inherits no element under
 *  changes nothing. */
export interface DecorationRemoval {
  id: string;
  remove: true;
}

/** The decoration of a template or of a patch: elements, and in a patch
 *  the removals of inherited ones. */
export interface TemplateDecoration {
  elements: (DesignElement | DecorationRemoval)[];
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
   *  added; `{ id, remove: true }` takes an inherited one out (#975). */
  decoration?: TemplateDecoration;
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
  /** Page role reported to design slots. Default `'composed'`.
   *  `'module'` (#1062, DESIGN §12.7): the template is a module, a box of
   *  frames, groups and decoration a page stacks in its modules group
   *  (`:::module{template="…"}`); it has no `area`, header, footer,
   *  variants, spread or overflow template, and no page fence lays it. */
  role?: string;
  /** A module (#1088): its width in a modules row or stack: a length, a
   *  percentage of the group's width, or `'fill'` (an equal share of what
   *  the row's other modules leave). Unset: `'fill'`. A grid's cells are
   *  its columns. */
  width?: ModuleWidth;
  /** A module (#1095): its share of the room a row of modules leaves past
   *  the widths of its modules (`width`). Default 0 for a module with a
   *  width, 1 for a `'fill'` one (which then grows by its share of what is
   *  left, as before). Not read in a stack or a grid. */
  grow?: number;
  /** A module with a `width` (#1095): how much of the room a row of modules
   *  is short by it gives back, in proportion to its width. Default 0
   *  (the row runs past the group's end side). */
  shrink?: number;
}

/** A module's width in its group (#1088). */
export type ModuleWidth = Dimension | { percent: number } | 'fill';

export interface LabelStyle {
  id: string;
  name?: string;
  /** A paragraph style whose type the label borrows. */
  paragraphStyle?: string;
  fontFamily?: string;
  fontSize?: Dimension;
  fontWeight?: number;
  /** Default `'normal'`. Written, `'normal'` also switches off the slant
   *  of a borrowed `paragraphStyle` (#955); left out, that style's slant
   *  holds. */
  fontStyle?: 'normal' | 'italic';
  color?: ColorValue;
  /** Default `'none'`. Written, `'none'` also switches off the capitals
   *  of a borrowed `paragraphStyle` (#955). */
  textTransform?: 'none' | 'uppercase';
  letterSpacing?: number;
  halo?: { color: ColorValue; width: Dimension };
  background?: ColorValue;
  padding?: Dimension;
  /** Smallest scale when a label does not fit its width. Default 0.85. */
  minScale?: number;
  /** `'vertical-rl'` sets the label in vertical writing (#902), unless its
   *  anchor says otherwise. Default `'horizontal-tb'`. */
  writingMode?: 'horizontal-tb' | 'vertical-rl';
  /** `'allow'` leaves the labels set in this style out of the
   *  `labelOverlap` check: a map whose names touch in the source (#977).
   *  An anchor's `overlap` wins. Default `'check'`. */
  overlap?: 'check' | 'allow';
  /** How the lines of a label line up inside its box (#1058): `'start'`
   *  and `'end'` in the label's own direction. Left out: as the anchor
   *  places the box (`ResourceAnchor.align`, centred by default), and
   *  `'start'` in a legend. */
  align?: 'start' | 'center' | 'end';
  /** A line round the label's plate (its box grown by `padding`), with or
   *  without a `background` (#1058). */
  border?: { color: ColorValue; width: Dimension };
  /** The corners of the plate (#1058). */
  radius?: Dimension;
  /** `'legend'` (#1058): a map's key. Each line of the label is a row; the
   *  first inline symbol (`:icon`) that opens a row hangs in a column as
   *  wide as the widest of them, so the words of every row line up. */
  kind?: 'legend';
  /** The look of the leaders of labels set in this style (#1057): the line
   *  from a label's box to its anchor's point. A label set away from its
   *  point (`ResourceAnchor.labelAt`) gets one; `leader` on the anchor or
   *  on the label turns it on or off. */
  leader?: LeaderStyle;
}

/** New top-level config keys. `checks.contentInConfig` (DESIGN §2.8)
 *  belongs to #849, which adds it to `PostextConfig` itself. */
export interface ComposedPagesConfigKeys {
  pageTemplates?: PageTemplate[];
  labelStyles?: LabelStyle[];
  /** Named frame looks (#1089). */
  frameLooks?: FrameLookEntry[];
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
  /** The modules the page lays (#1062), in Markdown order: the template
   *  comes back with each one's frames, groups and decoration in its
   *  modules group, scoped by the instance name (`expandModules`). */
  modules?: readonly ComposedModuleUse[];
}

/** A module a page lays (#1062): its instance name (the fence's `name`,
 *  else `<template>[n]`) and its module template. */
export interface ComposedModuleUse {
  name: string;
  template: string;
}

/** A module laid in a template's modules group (#1062), after
 *  `expandModules`: what of the template belongs to it, by scoped name
 *  (`<name>.<frame>`). */
export interface ResolvedModule extends ComposedModuleUse {
  /** The modules group it is laid in. */
  group: string;
  /** JSON pointer of the module template. */
  configPath: string;
  /** Its frames, groups and decoration element ids, scoped, in the module
   *  template's order. */
  frames: string[];
  groups: string[];
  elements: string[];
  /** The module's flow frame: the content of its `:::module` that names
   *  no slot. */
  flow?: string;
  /** The module's frames that take the first heading of a level (or the
   *  contents) inside its `:::module`. */
  takes?: Partial<Record<'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'toc', string>>;
  /** Its template's `width` (#1088). */
  width?: ModuleWidth;
  /** Its template's `grow` and `shrink` (#1095), when it writes them. */
  grow?: number;
  shrink?: number;
  /** The modules group inside `group` it is laid in (`within`, #1088): the
   *  innermost, when groups lie inside each other (#1095). */
  nested?: string;
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
  takes?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'toc';
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
  /** Ruled lines across the frame (#914), as written (lengths checked). */
  rules?: FrameRulesConfig;
  /** What the frame changes of its style's look (#976), colours and
   *  lengths checked. */
  look?: FrameLook;
  /** `'allow'`: the frame is left out of the overlap checks (#1053).
   *  Absent: checked. */
  overlap?: 'allow';
  /** JSON pointer of the most specific entry that sets this frame
   *  (`/pageTemplates/3/frames/2`, `/pageTemplates/3/variants/recto/frames/0`). */
  configPath: string;
  /** Per field as written: the JSON pointer of the entry whose value won. */
  fieldPaths: Record<string, string>;
}

export interface ResolvedFrameGroup {
  name: string;
  kind: 'stack' | 'row' | 'grid';
  /** For a grid that repeats: the set's frames (before `expandRepeats`),
   *  or its instances, cell after cell (after). */
  frames: string[];
  gap: Dimension;
  /** Grid only (#1061): set when `kind` is `'grid'`. */
  columns?: number;
  columnGap?: Dimension;
  rowGap?: Dimension;
  rowAlign?: 'start' | 'center' | 'end' | 'stretch';
  repeat?: { frames: string[]; max?: number };
  /** After `expandRepeats` (#1061): the items laid, each its number and its
   *  instances (the main frame's first), in cell order. For a modules group
   *  after `expandModules` (#1062): each module, its frames, `module` its
   *  instance name. */
  items?: { item: number; frames: string[]; module?: string; nested?: string }[];
  /** The group takes the page's modules (#1062). */
  modules?: true;
  /** A modules group inside the modules stack of this name (#1088). */
  within?: string;
  /** A modules group inside another (#1088): the module templates it
   *  takes; unset, every one. */
  templates?: string[];
  /** A modules group's `overflow.continueIn` (#1062). */
  overflow?: { continueIn?: string };
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
  /** The modules laid in the template's modules group (#1062), in order:
   *  set by `expandModules`. */
  modules?: ResolvedModule[];
  /** A module's width in its group (#1088): set on a module that writes
   *  one. */
  width?: ModuleWidth;
  /** A module's `grow` and `shrink` in a row (#1095): set on a module that
   *  writes them. */
  grow?: number;
  shrink?: number;
  /** The template and its ancestors, nearest first. */
  chain: string[];
  /** `/pageTemplates/<i>`. */
  configPath: string;
}

export interface ResolvedLabelStyle extends LabelStyle {
  /** Left out when the style does not say: a borrowed paragraph style's
   *  slant holds then, while `'normal'` written overrides it (#955). */
  fontStyle?: 'normal' | 'italic';
  textTransform?: 'none' | 'uppercase';
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
  /** The `leader` attribute (#1057): on (`leader`), off (`leader="none"`). */
  leader?: boolean;
  sourceMap?: number[];
}

// ---------------------------------------------------------------------------
// Layout (VDT)
// ---------------------------------------------------------------------------

// `ReflowEventKind`, `ReflowEvent`, `VDTFrame` and `VDTComposedPage` live
// in `vdt.ts` with the rest of the VDT (#855).
export type { ReflowEventKind, ReflowEvent, VDTFrame, VDTComposedPage } from '../vdt.js';

// `FrameOverflowProposal` and `FrameFitStep` live in `vdt.ts` with the
// `frameOverflow` warning that carries them (#858).
export type { FrameOverflowProposal, FrameFitStep } from '../vdt.js';
