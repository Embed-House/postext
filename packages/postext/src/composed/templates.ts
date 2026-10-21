// Page templates (composed pages, #853): defaults, `extends` and variant
// resolution, and the normalisation of frames, groups and label styles.
// Pure; nothing here lays anything out (that is P4, #855).

import { expandModules, modulesGroupRoot } from './modules';
import type { ColorValue, DesignElement, DesignSlot, Dimension, ElementPlacement } from '../types';
import type {
  FrameConfig,
  FrameGridCell,
  FrameGroupConfig,
  FrameLook,
  FrameLookEntry,
  FrameOverflowConfig,
  FrameRulesConfig,
  FrameSize,
  LabelStyle,
  ModuleWidth,
  PageSide,
  PageTemplate,
  PageTemplateGrid,
  PageTemplatePatch,
  ResolvedFrame,
  ResolvedFrameFit,
  ResolvedFrameGroup,
  ResolvedLabelStyle,
  ResolvedPageTemplate,
  ResolvePageTemplateOptions,
} from './types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const ZERO: Dimension = { value: 0, unit: 'mm' };

export const DEFAULT_FRAME_FIT: Readonly<ResolvedFrameFit> = {
  shrinkText: true,
  minScale: 0.9,
  scaleImages: true,
  imageMinScale: 0.8,
  preferContinue: true,
};

/** What a frame that sets nothing comes to (besides its name). */
export const DEFAULT_FRAME = {
  width: 'fill' as FrameSize,
  height: 'auto' as FrameSize,
  layer: 1,
  rotate: 0,
  verticalAlign: 'top' as const,
  columns: 1,
  exclude: 'none' as const,
  flow: false,
  pin: false,
  grow: 0,
  shrink: 0,
  priority: 0,
  optional: false,
  crossGutter: false,
};

export const DEFAULT_FRAME_GROUP = {
  kind: 'stack' as const,
  gap: ZERO,
  align: 'start' as const,
};

export const DEFAULT_PAGE_TEMPLATE = {
  area: 'content' as const,
  spread: false,
  gutter: ZERO,
  role: 'composed',
};

/** The `role` of a module template (#1062, DESIGN §12.7). */
export const MODULE_ROLE = 'module';

/** Whether a resolved template is a module (#1062): a page fence never lays
 *  one (`moduleAsPage`). */
export function isModuleTemplate(template: Pick<ResolvedPageTemplate, 'role'> | undefined): boolean {
  return template?.role === MODULE_ROLE;
}

export const DEFAULT_LABEL_STYLE = {
  fontStyle: 'normal' as const,
  textTransform: 'none' as const,
  minScale: 0.85,
};

export const FRAME_VERTICAL_ALIGNS = ['top', 'middle', 'bottom', 'justify'] as const;
export const FRAME_EXCLUDES = ['none', 'push'] as const;
export const FRAME_WRAPS = ['box', 'contour'] as const;
export const FRAME_OVERLAPS = ['check', 'allow'] as const;
export const FRAME_TAKES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'toc'] as const;
export const FRAME_GROUP_KINDS = ['stack', 'row', 'grid'] as const;
export const FRAME_GRID_ROW_ALIGNS = ['start', 'center', 'end', 'stretch'] as const;
export const FRAME_GROUP_ALIGNS = ['start', 'center', 'end', 'space-between'] as const;
export const TEMPLATE_AREAS = ['content', 'trim', 'bleed'] as const;
export const FRAME_WRITING_MODES = ['horizontal-tb', 'vertical-rl'] as const;
export const FRAME_DIRECTIONS = ['ltr', 'rtl'] as const;
export const LABEL_FONT_STYLES = ['normal', 'italic'] as const;
export const LABEL_TEXT_TRANSFORMS = ['none', 'uppercase'] as const;
export const LABEL_OVERLAPS = ['check', 'allow'] as const;
/** `LabelStyle.align` and `LabelStyle.kind` (#1058). */
export const LABEL_ALIGNS = ['start', 'center', 'end'] as const;
export const LABEL_KINDS = ['legend'] as const;

/** The shape of a frame's `look` (#976): which keys it has and what each
 *  holds, a colour or a length. */
export const LOOK_TREE = {
  background: 'color',
  border: { color: 'color' },
  stripe: { color: 'color' },
  icon: { color: 'color' },
  marker: { color: 'color', rule: { color: 'color' } },
  titleStyle: { color: 'color' },
  body: { color: 'color', boldColor: 'color', italicColor: 'color', letterSpacing: 'tracking' },
  label: { color: 'color', background: 'color', rule: { color: 'color' } },
} as const;
type LookTree = { readonly [key: string]: 'color' | 'tracking' | LookTree };

const DIMENSION_UNITS = ['cm', 'mm', 'in', 'pt', 'px', 'em', 'rem'];

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** A length the engine can use: a finite, non-negative value in a known
 *  unit. */
export function isFrameDimension(v: unknown): v is Dimension {
  return isRecord(v) && finite(v.value) && v.value >= 0 && typeof v.unit === 'string' && DIMENSION_UNITS.includes(v.unit);
}

/** `v` as a frame size, or undefined when it is none. A percentage is
 *  clamped to 0 … 100. */
export function normalizeFrameSize(v: unknown): FrameSize | undefined {
  if (v === 'auto' || v === 'fill') return v;
  if (isRecord(v) && 'percent' in v) {
    return finite(v.percent) ? { percent: Math.min(100, Math.max(0, v.percent)) } : undefined;
  }
  return isFrameDimension(v) ? { value: v.value, unit: v.unit } : undefined;
}

/** The id an anchor names (`'#dinero'` → `'dinero'`), or undefined. */
export function anchorTarget(placement: ElementPlacement | undefined): string | undefined {
  const to = isRecord(placement) && isRecord(placement.anchor) ? placement.anchor.to : undefined;
  return typeof to === 'string' && to.startsWith('#') && to.length > 1 ? to.slice(1) : undefined;
}

/** The frame a `continueIn` of the form `'#frame'` names. */
export function continueInFrame(continueIn: unknown): string | undefined {
  return typeof continueIn === 'string' && continueIn.startsWith('#') && continueIn.length > 1 ? continueIn.slice(1) : undefined;
}

/** The template a `continueIn` of the form `'template:<id>'` names. */
export function continueInTemplate(continueIn: unknown): string | undefined {
  return typeof continueIn === 'string' && continueIn.startsWith('template:') && continueIn.length > 9 ? continueIn.slice(9) : undefined;
}

/** The later page fence `'page:<id>'` names, and the frame of it
 *  `'page:<id>#<frame>'` names (#917): a story that jumps there. `<id>`
 *  may be `{attr.name}`, the fence's attribute (`resolveContinueIn`). */
export function continueInPage(continueIn: unknown): { page: string; frame?: string } | undefined {
  if (typeof continueIn !== 'string' || !continueIn.startsWith('page:')) return undefined;
  const rest = continueIn.slice(5);
  const hash = rest.indexOf('#');
  const page = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
  const frame = hash >= 0 ? rest.slice(hash + 1).trim() : '';
  return page.length > 0 ? { page, ...(frame.length > 0 ? { frame } : {}) } : undefined;
}

/** `continueIn` with each `{attr.name}` read from the page fence's
 *  attributes (#917): `'page:{attr.sigue}'` with `sigue="p47"` is
 *  `'page:p47'`. An attribute the fence lacks reads as nothing. */
export function resolveContinueIn(continueIn: string, attrs: Readonly<Record<string, string>>): string {
  return continueIn.includes('{attr.') ? continueIn.replace(/\{attr\.([A-Za-z0-9_-]+)\}/g, (_, k: string) => attrs[k] ?? '') : continueIn;
}

// ---------------------------------------------------------------------------
// The template table: which template each id means
// ---------------------------------------------------------------------------

/** id → index of the first template with it. */
function idTable(templates: readonly PageTemplate[]): Map<string, number> {
  const byId = new Map<string, number>();
  templates.forEach((t, i) => {
    if (isRecord(t) && typeof t.id === 'string' && t.id !== '' && !byId.has(t.id)) byId.set(t.id, i);
  });
  return byId;
}

/** The chain of template indices from `index` up to its root, nearest
 *  first; `null` when it loops back on itself. A parent that does not
 *  exist ends the chain (the template stands alone). */
export function templateChain(templates: readonly PageTemplate[], index: number, byId = idTable(templates)): number[] | null {
  const chain: number[] = [];
  const seen = new Set<number>();
  let at: number | undefined = index;
  while (at !== undefined) {
    if (seen.has(at)) return null;
    seen.add(at);
    chain.push(at);
    const parent: unknown = templates[at]?.extends;
    at = typeof parent === 'string' ? byId.get(parent) : undefined;
  }
  return chain;
}

/** The index of the template `id` means: the first with that id. */
export function templateIndex(templates: readonly PageTemplate[] | undefined, id: string): number | undefined {
  return templates ? idTable(templates).get(id) : undefined;
}

// ---------------------------------------------------------------------------
// Merging (`extends`, `variants`)
// ---------------------------------------------------------------------------

/** An entry of a named list being merged, with where each field came from. */
interface NamedEntry<T> {
  value: T;
  configPath: string;
  fieldPaths: Record<string, string>;
}

interface Merged {
  fields: Record<string, unknown>;
  fieldPaths: Record<string, string>;
  frames: NamedEntry<FrameConfig>[];
  groups: NamedEntry<FrameGroupConfig>[];
  elements: { value: DesignElement; configPath: string }[];
}

/** The template-level keys a child or a variant inherits and overrides. */
const SCALAR_KEYS = ['area', 'overflowTemplate', 'bodyStyle', 'palette', 'header', 'footer'] as const;
const INHERITED_KEYS = ['spread', 'gutter', 'role', 'width', 'grow', 'shrink'] as const;
/** Frame fields merged key by key rather than replaced. */
const MERGED_OBJECT_KEYS = new Set(['fit', 'overflow', 'padding', 'rules']);

/** A problem resolution met, with the JSON pointer of the field at fault.
 *  `validatePageTemplates` reports them as config warnings. */
export interface TemplateIssue {
  kind:
    | 'frameDuplicate'
    | 'frameStyleUnknown'
    | 'frameAnchorUnknown'
    | 'groupFrameUnknown'
    | 'groupFrameTwice'
    | 'frameChainLoop'
    | 'overflowTargetUnknown';
  path: string;
  value: string;
  used: string;
  /** For a name that does not exist: the closest that does (filled by the
   *  validator). */
  known?: readonly string[];
}

function mergeNamed<T extends { name?: unknown; remove?: unknown }>(
  list: NamedEntry<T>[],
  entries: unknown,
  basePath: string,
  issues: TemplateIssue[],
): void {
  if (!Array.isArray(entries)) return;
  const seen = new Set<string>();
  entries.forEach((raw, j) => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name === '') return;
    const name = raw.name;
    const path = `${basePath}/${j}`;
    if (seen.has(name)) {
      issues.push({ kind: 'frameDuplicate', path, value: name, used: '' });
      return;
    }
    seen.add(name);
    const at = list.findIndex((e) => e.value.name === name);
    if (raw.remove === true) {
      if (at >= 0) list.splice(at, 1);
      return;
    }
    const entry: NamedEntry<T> = at >= 0
      ? { value: { ...list[at]!.value }, configPath: path, fieldPaths: { ...list[at]!.fieldPaths } }
      : { value: { name } as T, configPath: path, fieldPaths: {} };
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'name' || key === 'remove' || value === undefined) continue;
      const target = entry.value as Record<string, unknown>;
      if (key === 'look' && isRecord(value)) {
        target.look = mergeLook(target.look, value);
        entry.fieldPaths.look = `${path}/look`;
        continue;
      }
      if (MERGED_OBJECT_KEYS.has(key) && isRecord(value)) {
        const before = target[key];
        const merged: Record<string, unknown> = isRecord(before) ? { ...before } : {};
        for (const [sub, v] of Object.entries(value)) {
          if (v === undefined) continue;
          merged[sub] = v;
          entry.fieldPaths[`${key}/${sub}`] = `${path}/${key}/${sub}`;
        }
        target[key] = merged;
      } else {
        target[key] = value;
      }
      entry.fieldPaths[key] = `${path}/${key}`;
    }
    if (at >= 0) list[at] = entry;
    else list.push(entry);
  });
}

function mergePatch(target: Merged, patch: PageTemplatePatch, path: string, issues: TemplateIssue[]): void {
  if (!isRecord(patch)) return;
  for (const key of SCALAR_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    target.fields[key] = value;
    target.fieldPaths[key] = `${path}/${key}`;
  }
  if (isRecord(patch.grid)) {
    const before = target.fields.grid;
    const merged: Record<string, unknown> = isRecord(before) ? { ...before } : {};
    for (const [k, v] of Object.entries(patch.grid)) if (v !== undefined) merged[k] = v;
    target.fields.grid = merged;
    target.fieldPaths.grid = `${path}/grid`;
  }
  mergeNamed(target.frames, patch.frames, `${path}/frames`, issues);
  mergeNamed(target.groups, patch.groups, `${path}/groups`, issues);
  const elements = isRecord(patch.decoration) ? patch.decoration.elements : undefined;
  if (Array.isArray(elements)) {
    elements.forEach((el, j) => {
      if (!isRecord(el)) return;
      const element = el as unknown as DesignElement;
      const elementPath = `${path}/decoration/elements/${j}`;
      const id = typeof el.id === 'string' && el.id !== '' ? el.id : undefined;
      const at = id === undefined ? -1 : target.elements.findIndex((e) => e.value.id === id);
      // `remove: true` takes the inherited element out (#975); a removal
      // naming nothing inherited changes nothing.
      if (el.remove === true) {
        if (at >= 0) target.elements.splice(at, 1);
        return;
      }
      if (at >= 0) {
        const merged = { ...target.elements[at]!.value } as Record<string, unknown>;
        for (const [k, v] of Object.entries(el)) if (v !== undefined) merged[k] = v;
        target.elements[at] = { value: merged as unknown as DesignElement, configPath: elementPath };
      } else {
        target.elements.push({ value: element, configPath: elementPath });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeGrid(raw: unknown): Required<PageTemplateGrid> | undefined {
  if (!isRecord(raw)) return undefined;
  const columns = finite(raw.columns) && raw.columns >= 1 ? Math.round(raw.columns) : undefined;
  const rows = finite(raw.rows) && raw.rows >= 1 ? Math.round(raw.rows) : undefined;
  if (columns === undefined || rows === undefined) return undefined;
  return {
    columns,
    rows,
    columnGap: isFrameDimension(raw.columnGap) ? raw.columnGap : ZERO,
    rowGap: isFrameDimension(raw.rowGap) ? raw.rowGap : ZERO,
  };
}

/** A grid cell clamped to the grid; undefined without a grid or a cell. */
function normalizeCell(raw: unknown, grid: Required<PageTemplateGrid> | undefined): Required<FrameGridCell> | undefined {
  if (!grid || !isRecord(raw) || !finite(raw.col) || !finite(raw.row)) return undefined;
  const col = Math.min(grid.columns, Math.max(1, Math.round(raw.col)));
  const row = Math.min(grid.rows, Math.max(1, Math.round(raw.row)));
  const cols = finite(raw.cols) ? Math.min(grid.columns - col + 1, Math.max(1, Math.round(raw.cols))) : 1;
  const rows = finite(raw.rows) ? Math.min(grid.rows - row + 1, Math.max(1, Math.round(raw.rows))) : 1;
  return { col, row, cols, rows };
}

const scale = (v: unknown, fallback: number): number => (finite(v) && v > 0 ? Math.min(1, v) : fallback);

function normalizeFit(raw: unknown): ResolvedFrameFit {
  const f = isRecord(raw) ? raw : {};
  return {
    shrinkText: typeof f.shrinkText === 'boolean' ? f.shrinkText : DEFAULT_FRAME_FIT.shrinkText,
    minScale: scale(f.minScale, DEFAULT_FRAME_FIT.minScale),
    scaleImages: typeof f.scaleImages === 'boolean' ? f.scaleImages : DEFAULT_FRAME_FIT.scaleImages,
    imageMinScale: scale(f.imageMinScale, DEFAULT_FRAME_FIT.imageMinScale),
    preferContinue: typeof f.preferContinue === 'boolean' ? f.preferContinue : DEFAULT_FRAME_FIT.preferContinue,
  };
}

function normalizeOverflow(raw: unknown): FrameOverflowConfig {
  if (!isRecord(raw)) return {};
  const out: FrameOverflowConfig = {};
  if (typeof raw.continueIn === 'string' && raw.continueIn !== '') out.continueIn = raw.continueIn;
  if (typeof raw.mark === 'string' || raw.mark === false) out.mark = raw.mark;
  if (typeof raw.fromMark === 'string' && raw.fromMark.trim() !== '') out.fromMark = raw.fromMark;
  return out;
}

const dim = (v: unknown): Dimension | undefined => (isFrameDimension(v) ? v : undefined);

/** A module's `width` (#1088) the engine can use: a length, a percentage
 *  above 0, or `'fill'`. */
export function moduleWidth(v: unknown): ModuleWidth | undefined {
  if (v === 'fill') return v;
  if (isRecord(v) && 'percent' in v) return finite(v.percent) && v.percent > 0 ? { percent: v.percent } : undefined;
  return dim(v);
}
/** A module's `grow` or `shrink` (#1095) the engine can use: a finite
 *  number, 0 or more. */
export function moduleFactor(v: unknown): number | undefined {
  return finite(v) && v >= 0 ? v : undefined;
}

const nonNegative = (v: unknown, fallback: number): number => (finite(v) && v >= 0 ? v : fallback);

/** A frame's `growWith` (#1117) the engine can use: `'children'`, or the
 *  names of a list (a name that is no string, or empty, is left out; a
 *  list with none is no list). */
export function growWithOf(v: unknown): { growWith?: 'children' | string[] } {
  if (v === 'children') return { growWith: 'children' };
  if (!Array.isArray(v)) return {};
  const names = [...new Set(v.filter((n): n is string => typeof n === 'string' && n.trim() !== ''))];
  return names.length > 0 ? { growWith: names } : {};
}

/** A frame as the layout reads it: every default filled in, sizes read
 *  from `width`/`height` and else `placement.size`, values the engine
 *  cannot use replaced by their default. */
export function normalizeFrame(
  frame: FrameConfig,
  grid?: Required<PageTemplateGrid>,
  where: { configPath: string; fieldPaths: Record<string, string> } = { configPath: '', fieldPaths: {} },
): ResolvedFrame {
  const f = frame as FrameConfig & Record<string, unknown>;
  const placement = isRecord(f.placement) ? f.placement : undefined;
  const cell = normalizeCell(f.grid, grid);
  const out: ResolvedFrame = {
    name: f.name,
    ...(placement ? { placement } : {}),
    ...(cell ? { grid: cell } : {}),
    width: normalizeFrameSize(f.width) ?? normalizeFrameSize(placement?.size?.width) ?? DEFAULT_FRAME.width,
    height: normalizeFrameSize(f.height) ?? normalizeFrameSize(placement?.size?.height) ?? DEFAULT_FRAME.height,
    layer: finite(f.layer) ? f.layer : DEFAULT_FRAME.layer,
    rotate: finite(f.rotate) ? f.rotate : DEFAULT_FRAME.rotate,
    verticalAlign: oneOf(FRAME_VERTICAL_ALIGNS, f.verticalAlign) ? f.verticalAlign : DEFAULT_FRAME.verticalAlign,
    columns: finite(f.columns) && f.columns >= 1 ? Math.round(f.columns) : DEFAULT_FRAME.columns,
    exclude: oneOf(FRAME_EXCLUDES, f.exclude) ? f.exclude : DEFAULT_FRAME.exclude,
    ...(f.wrap === 'contour' ? { wrap: 'contour' as const } : {}),
    ...(f.overlap === 'allow' ? { overlap: 'allow' as const } : {}),
    flow: f.flow === true,
    pin: f.pin === true,
    grow: nonNegative(f.grow, DEFAULT_FRAME.grow),
    shrink: nonNegative(f.shrink, DEFAULT_FRAME.shrink),
    priority: finite(f.priority) ? f.priority : DEFAULT_FRAME.priority,
    ...growWithOf(f.growWith),
    fit: normalizeFit(f.fit),
    overflow: normalizeOverflow(f.overflow),
    optional: f.optional === true,
    crossGutter: f.crossGutter === true,
    configPath: where.configPath,
    fieldPaths: where.fieldPaths,
  };
  for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'columnGap'] as const) {
    const d = dim(f[key]);
    if (d) out[key] = d;
  }
  if (typeof f.style === 'string' && f.style !== '') out.style = f.style;
  if (isRecord(f.padding)) {
    const padding: Record<string, Dimension> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const d = dim(f.padding[side]);
      if (d) padding[side] = d;
    }
    out.padding = padding;
  }
  if (typeof f.next === 'string' && f.next !== '') out.next = f.next;
  if (oneOf(FRAME_TAKES, f.takes)) out.takes = f.takes;
  if (oneOf(FRAME_WRITING_MODES, f.writingMode)) out.writingMode = f.writingMode;
  if (oneOf(FRAME_DIRECTIONS, f.direction)) out.direction = f.direction;
  const rules = normalizeRules(f.rules);
  if (rules) out.rules = rules;
  const look = normalizeLook(f.look, LOOK_TREE);
  if (look) out.look = look as FrameLook;
  return out;
}

/** A frame's `look` (#976) with what the engine cannot use left out: a
 *  key that is not in the tree, a colour with no `hex`, a bad length. */
function normalizeLook(raw: unknown, tree: LookTree): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(tree)) {
    const value = raw[key];
    if (kind === 'color') {
      if (isRecord(value) && typeof value.hex === 'string') out[key] = value;
    } else if (kind === 'tracking') {
      // A length that may be negative.
      if (isRecord(value) && finite(value.value) && typeof value.unit === 'string' && DIMENSION_UNITS.includes(value.unit)) out[key] = { value: value.value, unit: value.unit };
    } else {
      const inner = normalizeLook(value, kind);
      if (inner) out[key] = inner;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The named looks of `frameLooks` (#1089) the engine can use: entries
 *  with an id (the first of each id wins), each with what a frame's
 *  `look` could not use left out (`normalizeLook`); an entry that keeps no
 *  field still names a look (it changes nothing). None when the list
 *  holds no entry with an id. */
export function normalizeFrameLooks(raw: unknown): FrameLookEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FrameLookEntry[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (!isRecord(e) || typeof e.id !== 'string' || e.id === '' || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, ...(typeof e.name === 'string' ? { name: e.name } : {}), ...(normalizeLook(e, LOOK_TREE) ?? {}) });
  }
  return out.length > 0 ? out : undefined;
}

/** The look a frame wears with a named look laid over its own (#1089):
 *  `over`'s fields (an entry's `id` and `name` left out) over `below`'s,
 *  key by key at every level. */
export function lookOver(below: FrameLook | undefined, over: FrameLook): FrameLook {
  const fields: Record<string, unknown> = { ...over };
  delete fields.id;
  delete fields.name;
  return mergeLook(below, fields) as FrameLook;
}

/** `look` over `below`, key by key at every level (colours and lengths
 *  replaced whole). */
function mergeLook(below: unknown, look: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(below) ? { ...below } : {};
  for (const [key, value] of Object.entries(look)) {
    if (value === undefined) continue;
    const here = out[key];
    out[key] = isRecord(value) && !('hex' in value) && !('unit' in value) && isRecord(here) ? mergeLook(here, value) : value;
  }
  return out;
}

/** A frame's `rules` (#914) with the values the engine cannot use left
 *  out (their defaults apply); none when it is not an object. */
function normalizeRules(raw: unknown): FrameRulesConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const out: FrameRulesConfig = {};
  const every = raw.every === 'line' ? 'line' : dim(raw.every);
  if (every) out.every = every;
  if (isRecord(raw.color) && typeof raw.color.hex === 'string') out.color = raw.color as unknown as ColorValue;
  const width = dim(raw.width);
  if (width) out.width = width;
  if (isFrameDimension(raw.inset)) out.inset = raw.inset;
  else if (isRecord(raw.inset)) {
    const left = dim(raw.inset.left);
    const right = dim(raw.inset.right);
    out.inset = { ...(left ? { left } : {}), ...(right ? { right } : {}) };
  }
  return out;
}

function normalizeGroup(entry: NamedEntry<FrameGroupConfig>, grid: Required<PageTemplateGrid> | undefined): ResolvedFrameGroup {
  const g = entry.value as FrameGroupConfig & Record<string, unknown>;
  const placement = isRecord(g.placement) ? g.placement : undefined;
  const cell = normalizeCell(g.grid, grid);
  const kind = oneOf(FRAME_GROUP_KINDS, g.kind) ? g.kind : DEFAULT_FRAME_GROUP.kind;
  const gap = dim(g.gap) ?? DEFAULT_FRAME_GROUP.gap;
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : []);
  // A grid's own fields (#1061), only on a grid: other groups resolve as
  // they always did.
  const repeat = kind === 'grid' && isRecord(g.repeat) ? g.repeat : undefined;
  const repeatFrames = repeat ? [...new Set(names(repeat.frames))] : [];
  const max = repeat && finite(repeat.max) && repeat.max >= 1 ? Math.floor(repeat.max) : undefined;
  const gridFields: Partial<ResolvedFrameGroup> = kind === 'grid'
    ? {
      columns: finite(g.columns) && g.columns >= 1 ? Math.floor(g.columns) : 1,
      columnGap: dim(g.columnGap) ?? gap,
      rowGap: dim(g.rowGap) ?? gap,
      rowAlign: oneOf(FRAME_GRID_ROW_ALIGNS, g.rowAlign) ? g.rowAlign : 'stretch',
      ...(repeatFrames.length > 0 ? { repeat: { frames: repeatFrames, ...(max !== undefined ? { max } : {}) } } : {}),
    }
    : {};
  // A modules group (#1062), only when it says so: it takes the page's
  // modules, not frames of its own: a stack, or (#1088) a row or a grid of
  // them, or a group of them inside the modules stack it names (`within`).
  const modules = g.modules === true;
  const continueIn = modules && isRecord(g.overflow) && typeof g.overflow.continueIn === 'string' && g.overflow.continueIn !== '' ? g.overflow.continueIn : undefined;
  const within = modules && typeof g.within === 'string' && g.within !== '' && g.within !== g.name ? g.within : undefined;
  const templates = within !== undefined && Array.isArray(g.templates) ? [...new Set(names(g.templates))] : undefined;
  const moduleFields: Partial<ResolvedFrameGroup> = modules
    ? {
      modules: true,
      ...(continueIn !== undefined && within === undefined ? { overflow: { continueIn } } : {}),
      ...(within !== undefined ? { within } : {}),
      ...(templates ? { templates } : {}),
      // A grid of modules has no repeat; a row of them aligns its modules.
      ...(kind === 'grid' ? { ...gridFields, repeat: undefined } : {}),
      ...(kind === 'row' ? { rowAlign: oneOf(FRAME_GRID_ROW_ALIGNS, g.rowAlign) ? g.rowAlign : 'stretch' } : {}),
    }
    : {};
  if (moduleFields.repeat === undefined) delete moduleFields.repeat;
  return {
    name: g.name,
    kind,
    // A grid that repeats holds its set's frames.
    frames: modules ? [] : gridFields.repeat ? repeatFrames : names(g.frames),
    gap,
    ...(modules ? {} : gridFields),
    ...moduleFields,
    ...(placement ? { placement } : {}),
    ...(cell ? { grid: cell } : {}),
    align: oneOf(FRAME_GROUP_ALIGNS, g.align) ? g.align : DEFAULT_FRAME_GROUP.align,
    configPath: entry.configPath,
    fieldPaths: entry.fieldPaths,
  };
}

/** `name` read as an instance of a repeated frame (#1061): `card[2]` is
 *  item 2 of frame `card`. Undefined for any other name. */
export function repeatInstance(name: string): { frame: string; item: number } | undefined {
  const open = name.lastIndexOf('[');
  if (open <= 0 || !name.endsWith(']')) return undefined;
  const digits = name.slice(open + 1, -1);
  if (digits.length === 0 || digits.length > 6) return undefined;
  for (const ch of digits) if (ch < '0' || ch > '9') return undefined;
  const item = Number(digits);
  return item >= 1 ? { frame: name.slice(0, open), item } : undefined;
}

/** The name of item `item`'s instance of frame `frame` (#1061). */
export function repeatInstanceName(frame: string, item: number): string {
  return `${frame}[${item}]`;
}

/** The frames a template's grids repeat (#1061), each with its grid. */
export function repeatedFrames(template: Pick<ResolvedPageTemplate, 'groups'>): Map<string, ResolvedFrameGroup> {
  const out = new Map<string, ResolvedFrameGroup>();
  for (const g of template.groups) for (const f of g.repeat?.frames ?? []) if (!out.has(f)) out.set(f, g);
  return out;
}

// ---------------------------------------------------------------------------
// References: groups, anchors, chains
// ---------------------------------------------------------------------------

/** Where a placement's anchor sits among a frame's or group's fields. */
const ANCHOR_FIELD = 'placement/anchor/to';

function withContainerAnchor(placement: ElementPlacement): ElementPlacement {
  return { ...placement, anchor: { ...placement.anchor, to: 'container' } };
}

/** The first loop of `edges` reachable in `order`, as the node list from
 *  the node it closes on back to it, or undefined. */
function findLoop(order: readonly string[], edges: Map<string, string[]>): string[] | undefined {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): string[] | undefined => {
    state.set(n, 1);
    stack.push(n);
    for (const m of edges.get(n) ?? []) {
      const s = state.get(m);
      if (s === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (s === undefined) {
        const found = visit(m);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(n, 2);
    return undefined;
  };
  for (const n of order) {
    if (state.has(n)) continue;
    const found = visit(n);
    if (found) return found;
  }
  return undefined;
}

/** Settle the references of a merged template: group members that do not
 *  exist or are claimed twice are skipped, anchors to nothing (or in a
 *  loop) read as `'container'`, `next`/`continueIn` links to nothing (or
 *  closing a loop) are dropped. Each fix is an issue. */
function settleReferences(
  frames: ResolvedFrame[],
  groups: ResolvedFrameGroup[],
  decoration: { value: DesignElement; configPath: string }[],
  context: { templateIds: ReadonlySet<string>; calloutStyleIds?: ReadonlySet<string>; module?: boolean },
  overflowTemplate: { value: unknown; path: string } | undefined,
  issues: TemplateIssue[],
): { overflowTemplate?: string } {
  const frameNames = frames.map((f) => f.name);
  const frameSet = new Set(frameNames);
  // A group named like a frame: anchors read the frame.
  for (const g of groups) {
    if (frameSet.has(g.name)) issues.push({ kind: 'frameDuplicate', path: g.configPath, value: g.name, used: '' });
  }
  const boxNames = [...frameNames, ...groups.map((g) => g.name).filter((n) => !frameSet.has(n))];
  const boxSet = new Set(boxNames);

  // Styles.
  if (context.calloutStyleIds) {
    for (const f of frames) {
      if (f.style !== undefined && !context.calloutStyleIds.has(f.style)) {
        issues.push({ kind: 'frameStyleUnknown', path: f.fieldPaths.style ?? `${f.configPath}/style`, value: f.style, used: '', known: [...context.calloutStyleIds] });
        delete f.style;
      }
    }
  }

  // Group members. A grid's repeated frames (#1061) are claimed first:
  // another group that lists one of them loses it.
  const claimed = new Set<string>();
  const claimOrder = [...groups.filter((g) => g.repeat), ...groups.filter((g) => !g.repeat)];
  for (const g of claimOrder) {
    const raw = g.frames;
    const kept: string[] = [];
    raw.forEach((name, k) => {
      const path = g.repeat ? `${g.fieldPaths.repeat ?? `${g.configPath}/repeat`}/frames/${k}` : `${g.fieldPaths.frames ?? `${g.configPath}/frames`}/${k}`;
      if (!frameSet.has(name)) {
        issues.push({ kind: 'groupFrameUnknown', path, value: name, used: '', known: frameNames });
      } else if (claimed.has(name)) {
        issues.push({ kind: 'groupFrameTwice', path, value: name, used: '' });
      } else {
        claimed.add(name);
        kept.push(name);
      }
    });
    g.frames = kept;
    if (g.repeat) {
      if (kept.length > 0) g.repeat = { ...g.repeat, frames: kept };
      else delete g.repeat;
    }
  }
  /** `card[2]` names an instance of a repeated frame (#1061): decoration
   *  and other frames may anchor to it. */
  const repeated = new Set(groups.flatMap((g) => g.repeat?.frames ?? []));
  const isInstance = (name: string): boolean => {
    const at = repeatInstance(name);
    return at !== undefined && repeated.has(at.frame);
  };

  // Anchors: unknown targets first, then loops.
  type Box = ResolvedFrame | ResolvedFrameGroup;
  const boxes = new Map<string, Box>();
  for (const f of frames) if (!boxes.has(f.name)) boxes.set(f.name, f);
  for (const g of groups) if (!boxes.has(g.name)) boxes.set(g.name, g);
  const anchorPath = (b: Box) => b.fieldPaths.placement ? `${b.fieldPaths.placement}/anchor/to` : `${b.configPath}/${ANCHOR_FIELD}`;
  const anchored = (b: Box): string | undefined => (b.grid ? undefined : anchorTarget(b.placement));
  for (const b of boxes.values()) {
    const target = anchored(b);
    if (target !== undefined && !boxSet.has(target) && !isInstance(target)) {
      issues.push({ kind: 'frameAnchorUnknown', path: anchorPath(b), value: `#${target}`, used: 'container', known: boxNames.map((n) => `#${n}`) });
      b.placement = withContainerAnchor(b.placement!);
    }
  }
  for (;;) {
    const edges = new Map<string, string[]>();
    for (const [name, b] of boxes) {
      const out: string[] = [];
      const target = anchored(b);
      if (target !== undefined) out.push(target);
      // A group with no box of its own is the union of its frames' boxes.
      if ('kind' in b && !b.placement && !b.grid) out.push(...b.frames);
      edges.set(name, out);
    }
    const loop = findLoop(boxNames, edges);
    if (!loop) break;
    // Drop the explicit anchor of the loop set latest in template order.
    let drop: Box | undefined;
    for (let k = 0; k < loop.length - 1; k++) {
      const b = boxes.get(loop[k]!)!;
      if (anchored(b) === loop[k + 1] && (!drop || boxNames.indexOf(b.name) > boxNames.indexOf(drop.name))) drop = b;
    }
    if (!drop) break; // cannot happen: a group's members never loop by themselves
    issues.push({ kind: 'frameAnchorUnknown', path: anchorPath(drop), value: loop.join(' → '), used: 'container' });
    drop.placement = withContainerAnchor(drop.placement!);
  }

  // Decoration anchors: another element of the decoration, or a box.
  const elementIds = new Set(decoration.map((e) => e.value.id).filter((id): id is string => typeof id === 'string'));
  decoration.forEach((e) => {
    if (e.value.kind === 'connector') {
      // A connector's ends (#1056): a box, an instance (`#card[2]`), every
      // instance (`#card[*]`, in `to` only) or another element. An end on
      // nothing is left out; a connector left with no `from` or no `to` is
      // not drawn.
      const known = (to: unknown, many: boolean): boolean => {
        if (typeof to !== 'string' || !to.startsWith('#')) return false;
        const name = to.slice(1);
        if (elementIds.has(name) || boxSet.has(name) || isInstance(name)) return true;
        if (many && name.endsWith('[*]') && repeated.has(name.slice(0, -3))) return true;
        // A module's connector may end on a frame of the page that stacks
        // it (an org chart's head, #1069): the module does not know the
        // page, so the end is kept and laid when the page has that frame,
        // else dropped there (`connectorDropped`).
        return context.module === true && name !== '';
      };
      const report = (to: unknown, path: string) => issues.push({ kind: 'frameAnchorUnknown', path, value: String(to), used: '', known: [...boxNames, ...elementIds].map((n) => `#${n}`) });
      const c = e.value;
      const fromTo = (c.from as { to?: unknown } | undefined)?.to;
      let from = c.from;
      if (!known(fromTo, false)) {
        report(fromTo, `${e.configPath}/from/to`);
        from = undefined as unknown as typeof c.from;
      }
      const list = Array.isArray(c.to) ? c.to : [c.to];
      const kept = list.filter((end, k) => {
        const to = (end as { to?: unknown } | undefined)?.to;
        if (known(to, true)) return true;
        report(to, Array.isArray(c.to) ? `${e.configPath}/to/${k}/to` : `${e.configPath}/to/to`);
        return false;
      });
      if (from !== c.from || kept.length !== list.length) e.value = { ...c, from, to: kept };
      return;
    }
    const target = anchorTarget(e.value.placement);
    if (target !== undefined && !elementIds.has(target) && !boxSet.has(target) && !isInstance(target)) {
      issues.push({ kind: 'frameAnchorUnknown', path: `${e.configPath}/${ANCHOR_FIELD}`, value: `#${target}`, used: 'container', known: [...boxNames, ...elementIds].map((n) => `#${n}`) });
      e.value = { ...e.value, placement: withContainerAnchor(e.value.placement) } as DesignElement;
    }
  });

  // Chains: `next` and `overflow.continueIn`.
  for (const f of frames) {
    if (f.next !== undefined && !frameSet.has(f.next)) {
      issues.push({ kind: 'overflowTargetUnknown', path: f.fieldPaths.next ?? `${f.configPath}/next`, value: f.next, used: '', known: frameNames });
      delete f.next;
    }
    const continueIn = f.overflow.continueIn;
    if (continueIn !== undefined) {
      const frameTarget = continueInFrame(continueIn);
      const templateTarget = continueInTemplate(continueIn);
      const ok = continueIn === 'next-page'
        || continueInPage(continueIn) !== undefined
        || (frameTarget !== undefined && frameSet.has(frameTarget))
        || (templateTarget !== undefined && context.templateIds.has(templateTarget));
      if (!ok) {
        const known = frameTarget !== undefined ? frameNames.map((n) => `#${n}`)
          : templateTarget !== undefined ? [...context.templateIds].map((id) => `template:${id}`)
            : ['next-page', 'page:<id>'];
        issues.push({ kind: 'overflowTargetUnknown', path: f.fieldPaths['overflow/continueIn'] ?? `${f.configPath}/overflow/continueIn`, value: continueIn, used: '', known });
        f.overflow = { ...f.overflow };
        delete f.overflow.continueIn;
      }
    }
  }
  const byName = new Map(frames.map((f) => [f.name, f] as const));
  for (;;) {
    const edges = new Map<string, string[]>();
    for (const f of frames) {
      const out: string[] = [];
      if (f.next !== undefined) out.push(f.next);
      const target = continueInFrame(f.overflow.continueIn);
      if (target !== undefined) out.push(target);
      edges.set(f.name, out);
    }
    const loop = findLoop(frameNames, edges);
    if (!loop) break;
    // The link that closes the loop: from its last frame back to its first.
    const from = byName.get(loop[loop.length - 2]!)!;
    const to = loop[loop.length - 1]!;
    if (from.next === to) {
      issues.push({ kind: 'frameChainLoop', path: from.fieldPaths.next ?? `${from.configPath}/next`, value: loop.join(' → '), used: '' });
      delete from.next;
    } else {
      issues.push({ kind: 'frameChainLoop', path: from.fieldPaths['overflow/continueIn'] ?? `${from.configPath}/overflow/continueIn`, value: loop.join(' → '), used: '' });
      from.overflow = { ...from.overflow };
      delete from.overflow.continueIn;
    }
  }

  if (overflowTemplate && overflowTemplate.value !== undefined) {
    const id = overflowTemplate.value;
    if (typeof id === 'string' && context.templateIds.has(id)) return { overflowTemplate: id };
    issues.push({ kind: 'overflowTargetUnknown', path: overflowTemplate.path, value: String(id), used: '', known: [...context.templateIds] });
  }
  return {};
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** What `resolvePageTemplate` reads of a configuration: the raw or the
 *  resolved one alike. */
export interface PageTemplateSource {
  pageTemplates?: readonly PageTemplate[];
  /** The callout style ids frames may name. Unset: not checked. */
  calloutStyles?: readonly { id: string }[];
}

/** The usable template ids: the first of each id, chains that do not loop. */
function usableIds(templates: readonly PageTemplate[]): Set<string> {
  const ids = new Set<string>();
  const byId = idTable(templates);
  for (const [id, index] of byId) if (templateChain(templates, index, byId)) ids.add(id);
  return ids;
}

/**
 * Resolve the template at `index` of `templates` (see
 * {@link resolvePageTemplate}), with the issues met on the way. `prefix`
 * is the JSON pointer of the list (`/pageTemplates`).
 * @internal the validator's; hosts call `resolvePageTemplate`.
 */
export function resolveTemplateAt(
  templates: readonly PageTemplate[],
  index: number,
  options: ResolvePageTemplateOptions & { calloutStyleIds?: ReadonlySet<string>; prefix?: string } = {},
): { template: ResolvedPageTemplate; issues: TemplateIssue[] } | undefined {
  const chain = templateChain(templates, index);
  const own = templates[index];
  if (!chain || !isRecord(own) || typeof own.id !== 'string') return undefined;
  const prefix = options.prefix ?? '/pageTemplates';
  const issues: TemplateIssue[] = [];
  const merged: Merged = { fields: {}, fieldPaths: {}, frames: [], groups: [], elements: [] };
  const inherited: Record<string, unknown> = {};
  for (const i of [...chain].reverse()) {
    const t = templates[i]!;
    mergePatch(merged, t, `${prefix}/${i}`, issues);
    for (const key of INHERITED_KEYS) if (t[key] !== undefined) inherited[key] = t[key];
  }
  const spread = inherited.spread === true;
  const side: PageSide | undefined = spread || options.spread ? undefined : options.parity;
  let variant: PageSide | undefined;
  if (side) {
    for (const i of [...chain].reverse()) {
      const patch = templates[i]!.variants?.[side];
      if (isRecord(patch)) {
        mergePatch(merged, patch, `${prefix}/${i}/variants/${side}`, issues);
        variant = side;
      }
    }
  }
  const grid = normalizeGrid(merged.fields.grid);
  const frames = merged.frames.map((e) => normalizeFrame(e.value, grid, { configPath: e.configPath, fieldPaths: e.fieldPaths }));
  const groups = merged.groups.map((e) => normalizeGroup(e, grid));
  const settled = settleReferences(
    frames,
    groups,
    merged.elements,
    { templateIds: usableIds(templates), calloutStyleIds: options.calloutStyleIds, module: inherited.role === MODULE_ROLE },
    merged.fields.overflowTemplate !== undefined ? { value: merged.fields.overflowTemplate, path: merged.fieldPaths.overflowTemplate! } : undefined,
    issues,
  );
  const f = merged.fields;
  const template: ResolvedPageTemplate = {
    id: own.id,
    ...(typeof own.name === 'string' ? { name: own.name } : {}),
    area: oneOf(TEMPLATE_AREAS, f.area) ? f.area : DEFAULT_PAGE_TEMPLATE.area,
    ...(grid ? { grid } : {}),
    frames,
    groups,
    decoration: { elements: merged.elements.map((e) => e.value) },
    decorationPaths: merged.elements.map((e) => e.configPath),
    ...(f.header === false || isRecord(f.header) ? { header: f.header as DesignSlot | false } : {}),
    ...(f.footer === false || isRecord(f.footer) ? { footer: f.footer as DesignSlot | false } : {}),
    ...(isRecord(f.header) && merged.fieldPaths.header ? { headerPath: merged.fieldPaths.header } : {}),
    ...(isRecord(f.footer) && merged.fieldPaths.footer ? { footerPath: merged.fieldPaths.footer } : {}),
    ...settled,
    ...(typeof f.bodyStyle === 'string' ? { bodyStyle: f.bodyStyle } : {}),
    ...(typeof f.palette === 'string' ? { palette: f.palette } : {}),
    spread,
    gutter: dim(inherited.gutter) ?? DEFAULT_PAGE_TEMPLATE.gutter,
    role: typeof inherited.role === 'string' && inherited.role !== '' ? inherited.role : DEFAULT_PAGE_TEMPLATE.role,
    ...(variant ? { variant } : {}),
    ...(inherited.role === MODULE_ROLE && moduleWidth(inherited.width) ? { width: moduleWidth(inherited.width)! } : {}),
    ...(inherited.role === MODULE_ROLE && moduleFactor(inherited.grow) !== undefined ? { grow: moduleFactor(inherited.grow)! } : {}),
    ...(inherited.role === MODULE_ROLE && moduleFactor(inherited.shrink) !== undefined ? { shrink: moduleFactor(inherited.shrink)! } : {}),
    chain: chain.map((i) => templates[i]!.id),
    configPath: `${prefix}/${index}`,
  };
  // A module (#1062) holds no modules of its own (`moduleNested`): its
  // modules groups are plain groups.
  if (template.role === MODULE_ROLE) {
    template.groups = template.groups.map((g) => {
      if (!g.modules) return g;
      const out = { ...g };
      delete out.modules;
      delete out.overflow;
      delete out.within;
      delete out.templates;
      return out;
    });
  } else {
    // A modules group inside another (#1088) names a modules group of the
    // template, from which `within` leads out to one inside no other
    // (#1095: to any depth); else it is a modules group of its own.
    const groups = template.groups;
    template.groups = groups.map((g) => {
      if (!g.within) return g;
      if (modulesGroupRoot(groups, g) !== undefined) return g;
      // (Reported by the validator.)
      const out = { ...g };
      delete out.within;
      delete out.templates;
      return out;
    });
  }
  return { template, issues };
}

const resolvedCache = new WeakMap<readonly PageTemplate[], Map<string, ResolvedPageTemplate | null>>();

/**
 * The template `id` of `config.pageTemplates`, ready to lay out: its
 * `extends` chain merged (scalar fields replace, `grid` merges key by key,
 * frames and groups merge by `name` with `remove: true` dropping one,
 * decoration elements merge by `id`), then the variant of the page's side
 * (`options.parity`; none on a spread), then every default filled in and
 * every reference settled (see `validatePageTemplates` for what is fixed
 * and reported). Undefined when no template has that id, or its chain
 * loops. The first template with an id is the one it means.
 *
 * Memoised per `pageTemplates` array (the resolved configuration holds a
 * copy of its own): treat the result as read-only, and give a changed list
 * as a new array.
 */
export function resolvePageTemplate(
  config: PageTemplateSource | undefined,
  id: string,
  options: ResolvePageTemplateOptions = {},
): ResolvedPageTemplate | undefined {
  const templates = config?.pageTemplates;
  if (!Array.isArray(templates)) return undefined;
  const index = templateIndex(templates, id);
  if (index === undefined) return undefined;
  const styleIds = config?.calloutStyles ? config.calloutStyles.map((s) => s.id).join('\u0000') : '';
  const key = `${index}|${options.parity ?? ''}|${options.spread ? 1 : 0}|${config?.calloutStyles ? 1 : 0}|${styleIds}`;
  // The page's modules (#1062): the template with them laid in its modules
  // group, kept by the list as well.
  if (options.modules && options.modules.length > 0) {
    const uses = options.modules;
    const moduleKey = `${key}|m|${uses.map((u) => `${u.name}\u0001${u.template}`).join('\u0000')}`;
    let cache = resolvedCache.get(templates);
    if (!cache) {
      cache = new Map();
      resolvedCache.set(templates, cache);
    }
    if (cache.has(moduleKey)) return cache.get(moduleKey) ?? undefined;
    const rest: ResolvePageTemplateOptions = { ...options };
    delete rest.modules;
    const base = resolvePageTemplate(config, id, rest);
    const out = base && !isModuleTemplate(base)
      ? expandModules(base, uses, (moduleId) => resolvePageTemplate(config, moduleId))
      : base;
    cache.set(moduleKey, out ?? null);
    return out;
  }
  let cache = resolvedCache.get(templates);
  if (!cache) {
    cache = new Map();
    resolvedCache.set(templates, cache);
  }
  if (cache.has(key)) return cache.get(key) ?? undefined;
  const calloutStyleIds = config?.calloutStyles ? new Set(config.calloutStyles.map((s) => s.id)) : undefined;
  const result = resolveTemplateAt(templates, index, { ...options, calloutStyleIds })?.template;
  cache.set(key, result ?? null);
  return result;
}

// ---------------------------------------------------------------------------
// Label styles
// ---------------------------------------------------------------------------

/** The label styles with their defaults filled in. */
export function resolveLabelStyles(styles: readonly LabelStyle[] | undefined): ResolvedLabelStyle[] {
  if (!Array.isArray(styles)) return [];
  return styles.filter((s) => isRecord(s) && typeof s.id === 'string').map((s) => ({
    ...s,
    // Left unset when the style does not say (or says something unknown):
    // "normal" written is a choice that overrides a borrowed paragraph
    // style's italics, not the same thing as nothing (#955).
    fontStyle: oneOf(LABEL_FONT_STYLES, s.fontStyle) ? s.fontStyle : undefined,
    textTransform: oneOf(LABEL_TEXT_TRANSFORMS, s.textTransform) ? s.textTransform : undefined,
    minScale: scale(s.minScale, DEFAULT_LABEL_STYLE.minScale),
  }));
}

// ---------------------------------------------------------------------------
// Stripping defaults (what the Sandbox saves)
// ---------------------------------------------------------------------------

/** A deep copy of `value` with the keys set to `undefined` left out. */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = withoutUndefined(v);
  return out as T;
}

/**
 * The page templates as stored. Every field is kept as written, a value
 * equal to its default included: in a template that `extends` another, or
 * in a variant, it overrides the parent's, so it is never a restated
 * default. Keys set to `undefined` are left out, and an empty list is no
 * list.
 */
export function stripPageTemplatesDefaults(templates: readonly PageTemplate[] | undefined): PageTemplate[] | undefined {
  if (!Array.isArray(templates) || templates.length === 0) return undefined;
  return withoutUndefined([...templates]);
}

/** The label styles without the values that restate a default (and `name`
 *  equal to `id`); an empty list is no list. */
export function stripLabelStylesDefaults(styles: readonly LabelStyle[] | undefined): LabelStyle[] | undefined {
  if (!Array.isArray(styles) || styles.length === 0) return undefined;
  return styles.map((s) => {
    const out = withoutUndefined({ ...s }) as LabelStyle & Record<string, unknown>;
    if (out.name === out.id) delete out.name;
    // With a paragraph style to borrow from, `'normal'` / `'none'` turn its
    // slant and capitals off: they are not a restated default (#955).
    if (!out.paragraphStyle && out.fontStyle === DEFAULT_LABEL_STYLE.fontStyle) delete out.fontStyle;
    if (!out.paragraphStyle && out.textTransform === DEFAULT_LABEL_STYLE.textTransform) delete out.textTransform;
    if (out.minScale === DEFAULT_LABEL_STYLE.minScale) delete out.minScale;
    if (out.overlap === 'check') delete out.overlap;
    return out;
  });
}
