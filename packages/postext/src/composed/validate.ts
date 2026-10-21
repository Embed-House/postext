// Validation of page templates and label styles (composed pages, #853).
// The engine ignores unknown keys elsewhere; a template is checked and every
// problem reported as a config warning whose `path` is a JSON pointer
// (`/pageTemplates/3/frames/2/style`). Pure.

import type { CalloutPaddingConfig, Dimension, LeaderStyle, PostextConfig, Resource } from '../types.js';
import { CONNECTOR_CAPS, LEADER_ROUTINGS } from '../design/connector.js';
import type { ConfigWarning } from '../vdt.js';
import type {
  FrameConfig,
  FrameFitConfig,
  FrameGridCell,
  FrameGroupConfig,
  FrameLook,
  FrameLookEntry,
  FrameRepeatConfig,
  FrameOverflowConfig,
  FrameRulesConfig,
  LabelStyle,
  PageTemplate,
  PageTemplateGrid,
  PageTemplatePatch,
  ResolvedFrame,
  ResolvedFrameGroup,
} from './types.js';
import { closestKey } from '../util/closestKey.js';
import { dimensionToPx } from '../units.js';
import {
  FRAME_DIRECTIONS,
  FRAME_EXCLUDES,
  FRAME_WRAPS,
  FRAME_OVERLAPS,
  FRAME_GROUP_ALIGNS,
  FRAME_GROUP_KINDS,
  FRAME_GRID_ROW_ALIGNS,
  FRAME_TAKES,
  FRAME_VERTICAL_ALIGNS,
  FRAME_WRITING_MODES,
  LABEL_FONT_STYLES,
  LABEL_TEXT_TRANSFORMS,
  LABEL_OVERLAPS,
  LABEL_ALIGNS,
  LABEL_KINDS,
  LOOK_TREE,
  TEMPLATE_AREAS,
  DEFAULT_FRAME,
  DEFAULT_FRAME_GROUP,
  DEFAULT_LABEL_STYLE,
  DEFAULT_PAGE_TEMPLATE,
  MODULE_ROLE,
  moduleFactor,
  moduleWidth,
  resolveTemplateAt,
  templateChain,
  type TemplateIssue,
} from './templates.js';
import { modulesGroupRoot } from './modules.js';

// The keys of each object, checked against its type: a key added to a type
// fails to compile until it is listed here.
const TEMPLATE_KEYS = {
  id: true, name: true, extends: true, spread: true, gutter: true, variants: true, role: true,
  area: true, grid: true, frames: true, groups: true, decoration: true, header: true, footer: true,
  overflowTemplate: true, bodyStyle: true, palette: true, width: true, grow: true, shrink: true,
} satisfies Record<keyof PageTemplate, true>;
const PATCH_KEYS = {
  area: true, grid: true, frames: true, groups: true, decoration: true, header: true, footer: true,
  overflowTemplate: true, bodyStyle: true, palette: true,
} satisfies Record<keyof PageTemplatePatch, true>;
const VARIANTS_KEYS = { recto: true, verso: true } satisfies Record<keyof NonNullable<PageTemplate['variants']>, true>;
const GRID_KEYS = { columns: true, rows: true, columnGap: true, rowGap: true } satisfies Record<keyof PageTemplateGrid, true>;
const CELL_KEYS = { col: true, row: true, cols: true, rows: true } satisfies Record<keyof FrameGridCell, true>;
const FRAME_KEYS = {
  name: true, placement: true, grid: true, width: true, height: true, minWidth: true, maxWidth: true, minHeight: true,
  maxHeight: true, style: true, layer: true, rotate: true, verticalAlign: true, columns: true, columnGap: true, padding: true,
  exclude: true, wrap: true, flow: true, next: true, takes: true, pin: true, grow: true, shrink: true, priority: true, fit: true,
  overflow: true, optional: true, crossGutter: true, writingMode: true, direction: true, rules: true, look: true, overlap: true, remove: true,
} satisfies Record<keyof FrameConfig, true>;
const LOOK_KEYS = { background: true, border: true, stripe: true, icon: true, marker: true, titleStyle: true, body: true, label: true } satisfies Record<keyof FrameLook, true>;
const FRAME_LOOK_ENTRY_KEYS = { ...LOOK_KEYS, id: true, name: true } satisfies Record<keyof FrameLookEntry, true>;
const RULES_KEYS = { every: true, color: true, width: true, inset: true } satisfies Record<keyof FrameRulesConfig, true>;
const FIT_KEYS = { shrinkText: true, minScale: true, scaleImages: true, imageMinScale: true, preferContinue: true } satisfies Record<keyof FrameFitConfig, true>;
const OVERFLOW_KEYS = { continueIn: true, mark: true, fromMark: true } satisfies Record<keyof FrameOverflowConfig, true>;
const PADDING_KEYS = { top: true, right: true, bottom: true, left: true } satisfies Record<keyof CalloutPaddingConfig, true>;
const GROUP_KEYS = {
  name: true, kind: true, frames: true, gap: true, placement: true, grid: true, align: true, remove: true,
  columns: true, columnGap: true, rowGap: true, rowAlign: true, repeat: true, modules: true, overflow: true,
  within: true, templates: true,
} satisfies Record<keyof FrameGroupConfig, true>;
const GROUP_OVERFLOW_KEYS = { continueIn: true } satisfies Record<keyof NonNullable<FrameGroupConfig['overflow']>, true>;
/** What a module template (#1062) does not have: it is laid in a page's
 *  modules group, never as a page. */
const MODULE_PAGE_KEYS = ['area', 'header', 'footer', 'variants', 'spread', 'gutter', 'overflowTemplate'] as const;
const REPEAT_KEYS = { frames: true, max: true } satisfies Record<keyof FrameRepeatConfig, true>;
const LABEL_STYLE_KEYS = {
  id: true, name: true, paragraphStyle: true, fontFamily: true, fontSize: true, fontWeight: true, fontStyle: true,
  color: true, textTransform: true, letterSpacing: true, halo: true, background: true, padding: true, minScale: true,
  writingMode: true, overlap: true, align: true, border: true, radius: true, kind: true, leader: true,
} satisfies Record<keyof LabelStyle, true>;
const LEADER_KEYS = {
  color: true, opacity: true, width: true, dash: true, startCap: true, endCap: true, capSize: true, routing: true,
} satisfies Record<keyof LeaderStyle, true>;
const LABEL_BORDER_KEYS = { color: true, width: true } satisfies Record<keyof NonNullable<LabelStyle['border']>, true>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where the checks read their context. */
export interface ValidatePageTemplatesOptions {
  /** The book's resources: their anchors' `style` is checked against
   *  `labelStyles` (`labelStyleUnknown`). */
  resources?: readonly Resource[];
  /** Pixels per inch and the body text size in px, for comparing a
   *  minimum with a maximum in different units. Default 96 and 16. */
  dpi?: number;
  baseFontSizePx?: number;
}

/**
 * Every problem of `config.pageTemplates` and `config.labelStyles` (and of
 * the same keys under `htmlViewer.overrides`), as config warnings with a
 * JSON-pointer `path`: the kinds listed on {@link ConfigWarning}, plus
 * `unknownConfigKey` for a key no template, frame, group, grid, fit,
 * overflow, variant or label style has, and `unknownConfigValue` for a word
 * outside a setting's choices (`area`, `verticalAlign`, `exclude`, `takes`,
 * `kind`, `align`, `writingMode`, `direction`, `overlap`, `fontStyle`,
 * `textTransform`) or a template with no id or a frame or group with no
 * name (ignored). `resolvePageTemplate` makes the same fixes the warnings
 * describe. Pure.
 */
export function validatePageTemplates(config: PostextConfig | undefined, options: ValidatePageTemplatesOptions = {}): ConfigWarning[] {
  if (!config) return [];
  const out: ConfigWarning[] = [];
  const seen = new Set<string>();
  const push = (w: ConfigWarning) => {
    const key = `${w.kind}|${w.path}|${w.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(w);
  };
  const calloutIds = (styles: unknown): Set<string> => new Set(
    (Array.isArray(styles) ? styles : [{ id: 'note' }]).filter(isRecord).map((s) => s.id).filter((id): id is string => typeof id === 'string'),
  );
  checkTemplates(config.pageTemplates, '/pageTemplates', calloutIds(config.calloutStyles), options, push);
  checkLabelStyles(config.labelStyles, '/labelStyles', push);
  checkFrameLooks(config.frameLooks, '/frameLooks', push);
  const overrides = config.htmlViewer?.overrides;
  if (isRecord(overrides)) {
    checkTemplates(overrides.pageTemplates, '/htmlViewer/overrides/pageTemplates', calloutIds(overrides.calloutStyles ?? config.calloutStyles), options, push);
    checkLabelStyles(overrides.labelStyles, '/htmlViewer/overrides/labelStyles', push);
    checkFrameLooks(overrides.frameLooks, '/htmlViewer/overrides/frameLooks', push);
  }
  checkAnchorStyles(config.labelStyles, options.resources, push);
  return out;
}

type Push = (w: ConfigWarning) => void;

function unknownKeys(node: unknown, known: Record<string, true>, path: string, push: Push): void {
  if (!isRecord(node)) return;
  const names = Object.keys(known);
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || Object.prototype.hasOwnProperty.call(known, key)) continue;
    const suggestion = closestKey(key, names);
    push({ kind: 'unknownConfigKey', path: `${path}/${escapePointer(key)}`, value: key, used: '', ...(suggestion ? { suggestion } : {}) });
  }
}

function choice(node: Record<string, unknown>, key: string, list: readonly string[], used: string, path: string, push: Push): void {
  const value = node[key];
  if (value === undefined || (typeof value === 'string' && list.includes(value))) return;
  const suggestion = typeof value === 'string' ? closestKey(value, list) : undefined;
  push({ kind: 'unknownConfigValue', path: `${path}/${key}`, value: String(value), used, ...(suggestion ? { suggestion } : {}) });
}

/** A JSON-pointer token (RFC 6901). */
function escapePointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function checkGrid(grid: unknown, path: string, push: Push): void {
  unknownKeys(grid, GRID_KEYS, path, push);
}

function checkFrameEntry(frame: unknown, path: string, push: Push): void {
  if (!isRecord(frame)) return;
  if (typeof frame.name !== 'string' || frame.name === '') {
    push({ kind: 'unknownConfigValue', path: `${path}/name`, value: String(frame.name ?? ''), used: '' });
    return;
  }
  unknownKeys(frame, FRAME_KEYS, path, push);
  unknownKeys(frame.grid, CELL_KEYS, `${path}/grid`, push);
  unknownKeys(frame.fit, FIT_KEYS, `${path}/fit`, push);
  unknownKeys(frame.overflow, OVERFLOW_KEYS, `${path}/overflow`, push);
  unknownKeys(frame.padding, PADDING_KEYS, `${path}/padding`, push);
  unknownKeys(frame.rules, RULES_KEYS, `${path}/rules`, push);
  unknownKeys(frame.look, LOOK_KEYS, `${path}/look`, push);
  checkLook(frame.look, LOOK_TREE, `${path}/look`, push);
  choice(frame, 'verticalAlign', FRAME_VERTICAL_ALIGNS, DEFAULT_FRAME.verticalAlign, path, push);
  choice(frame, 'exclude', FRAME_EXCLUDES, DEFAULT_FRAME.exclude, path, push);
  choice(frame, 'wrap', FRAME_WRAPS, 'box', path, push);
  choice(frame, 'overlap', FRAME_OVERLAPS, 'check', path, push);
  choice(frame, 'takes', FRAME_TAKES, '', path, push);
  choice(frame, 'writingMode', FRAME_WRITING_MODES, '', path, push);
  choice(frame, 'direction', FRAME_DIRECTIONS, '', path, push);
}

/** The nested keys of a frame's `look` (#976), against the tree of the
 *  fields it may set. */
function checkLook(node: unknown, tree: { readonly [key: string]: unknown }, path: string, push: Push): void {
  if (!isRecord(node)) return;
  for (const [key, kind] of Object.entries(tree)) {
    if (isRecord(kind)) {
      const inner = node[key];
      unknownKeys(inner, Object.fromEntries(Object.keys(kind).map((k) => [k, true as const])), `${path}/${key}`, push);
      checkLook(inner, kind, `${path}/${key}`, push);
    }
  }
}

function checkGroupEntry(group: unknown, path: string, push: Push): void {
  if (!isRecord(group)) return;
  if (typeof group.name !== 'string' || group.name === '') {
    push({ kind: 'unknownConfigValue', path: `${path}/name`, value: String(group.name ?? ''), used: '' });
    return;
  }
  unknownKeys(group, GROUP_KEYS, path, push);
  unknownKeys(group.grid, CELL_KEYS, `${path}/grid`, push);
  choice(group, 'kind', FRAME_GROUP_KINDS, DEFAULT_FRAME_GROUP.kind, path, push);
  choice(group, 'align', FRAME_GROUP_ALIGNS, DEFAULT_FRAME_GROUP.align, path, push);
  // A grid (#1061): at least one column, a repeat of at least one item.
  choice(group, 'rowAlign', FRAME_GRID_ROW_ALIGNS, 'stretch', path, push);
  const columns = group.columns;
  if (columns !== undefined && !(typeof columns === 'number' && Number.isFinite(columns) && columns >= 1)) {
    push({ kind: 'unknownConfigValue', path: `${path}/columns`, value: String(columns), used: '1' });
  }
  unknownKeys(group.repeat, REPEAT_KEYS, `${path}/repeat`, push);
  const max = isRecord(group.repeat) ? group.repeat.max : undefined;
  if (max !== undefined && !(typeof max === 'number' && Number.isFinite(max) && max >= 1)) {
    push({ kind: 'unknownConfigValue', path: `${path}/repeat/max`, value: String(max), used: '' });
  }
  // A modules group (#1062): a stack that takes the page's modules, not
  // frames; only it goes on by whole modules.
  unknownKeys(group.overflow, GROUP_OVERFLOW_KEYS, `${path}/overflow`, push);
  if (group.modules !== undefined && typeof group.modules !== 'boolean') {
    push({ kind: 'unknownConfigValue', path: `${path}/modules`, value: String(group.modules), used: 'false' });
  }
  const modules = group.modules === true;
  if (modules && Array.isArray(group.frames) && group.frames.length > 0) {
    push({ kind: 'unknownConfigValue', path: `${path}/frames`, value: group.frames.map(String).join(', '), used: '' });
  }
  if (modules && isRecord(group.repeat)) {
    push({ kind: 'unknownConfigValue', path: `${path}/repeat`, value: JSON.stringify(group.repeat), used: '' });
  }
  // A modules group inside a modules stack (#1088): `within` names it (the
  // stack itself is checked with the template), `templates` the modules
  // it takes; it goes on with the stack, not on its own.
  const within = group.within;
  if (within !== undefined && !(modules && typeof within === 'string' && within !== '' && within !== group.name)) {
    push({ kind: 'unknownConfigValue', path: `${path}/within`, value: String(within), used: '' });
  }
  const nested = modules && typeof within === 'string' && within !== '' && within !== group.name;
  const templates = group.templates;
  if (templates !== undefined && !(nested && Array.isArray(templates) && templates.every((t) => typeof t === 'string'))) {
    push({ kind: 'unknownConfigValue', path: `${path}/templates`, value: Array.isArray(templates) ? templates.map(String).join(', ') : String(templates), used: '' });
  }
  const continueIn = isRecord(group.overflow) ? group.overflow.continueIn : undefined;
  if (continueIn !== undefined) {
    const ok = modules && !nested && typeof continueIn === 'string' && (continueIn === 'next-page' || continueIn.startsWith('template:'));
    if (!ok) push({ kind: 'unknownConfigValue', path: `${path}/overflow/continueIn`, value: String(continueIn), used: '' });
  }
}

function checkPatch(patch: unknown, path: string, push: Push, keys: Record<string, true>): void {
  if (!isRecord(patch)) return;
  unknownKeys(patch, keys, path, push);
  choice(patch, 'area', TEMPLATE_AREAS, DEFAULT_PAGE_TEMPLATE.area, path, push);
  checkGrid(patch.grid, `${path}/grid`, push);
  if (Array.isArray(patch.frames)) patch.frames.forEach((f, j) => checkFrameEntry(f, `${path}/frames/${j}`, push));
  if (Array.isArray(patch.groups)) patch.groups.forEach((g, j) => checkGroupEntry(g, `${path}/groups/${j}`, push));
}

function checkTemplates(
  raw: unknown,
  prefix: string,
  calloutStyleIds: ReadonlySet<string>,
  options: ValidatePageTemplatesOptions,
  push: Push,
): void {
  if (!Array.isArray(raw)) return;
  const templates = raw as PageTemplate[];
  const firstOf = new Map<string, number>();
  const ids: string[] = [];
  templates.forEach((t, i) => {
    const path = `${prefix}/${i}`;
    if (!isRecord(t)) return;
    if (typeof t.id !== 'string' || t.id === '') {
      push({ kind: 'unknownConfigValue', path: `${path}/id`, value: String(t.id ?? ''), used: '' });
      return;
    }
    if (firstOf.has(t.id)) {
      push({ kind: 'templateDuplicate', path, value: t.id, used: '' });
    } else {
      firstOf.set(t.id, i);
      ids.push(t.id);
    }
    checkPatch(t, path, push, TEMPLATE_KEYS);
    unknownKeys(t.variants, VARIANTS_KEYS, `${path}/variants`, push);
    if (isRecord(t.variants)) {
      for (const side of ['recto', 'verso'] as const) checkPatch(t.variants[side], `${path}/variants/${side}`, push, PATCH_KEYS);
    }
  });
  const toPx = pxConverter(options);
  for (const [id, index] of firstOf) {
    const t = templates[index]!;
    const path = `${prefix}/${index}`;
    if (t.extends !== undefined) {
      if (typeof t.extends !== 'string' || !firstOf.has(t.extends)) {
        const suggestion = typeof t.extends === 'string' ? closestKey(t.extends, ids.filter((x) => x !== id)) : undefined;
        push({ kind: 'templateExtendsUnknown', path: `${path}/extends`, value: String(t.extends), used: '', ...(suggestion ? { suggestion } : {}) });
      }
    }
    if (!templateChain(templates, index)) {
      push({ kind: 'templateExtendsCycle', path: `${path}/extends`, value: loopText(templates, index, firstOf), used: '' });
      continue;
    }
    // The template on its own, then on each side when a variant applies.
    const chain = templateChain(templates, index)!;
    const sides = chain.some((i) => isRecord(templates[i]!.variants)) ? [undefined, 'recto', 'verso'] as const : [undefined] as const;
    for (const parity of sides) {
      const resolved = resolveTemplateAt(templates, index, { parity, calloutStyleIds, prefix });
      if (!resolved) continue;
      for (const issue of resolved.issues) push(issueWarning(issue));
      for (const frame of resolved.template.frames) checkMinMax(frame, toPx, push);
      if (parity === undefined && resolved.template.role === MODULE_ROLE) checkModule(t, path, push);
      if (parity === undefined && resolved.template.role !== MODULE_ROLE) checkPageModules(t, resolved.template.groups, path, push);
    }
  }
}

/** What a module template (#1062) writes that only a page has: its own
 *  `area`, running heads, variants, spread and overflow template, and a
 *  modules group (a module inside a module, `moduleNested`, is not
 *  supported). Each is ignored. */
function checkModule(t: PageTemplate, path: string, push: Push): void {
  // A module's width in its group (#1088).
  if (t.width !== undefined && !moduleWidth(t.width)) {
    push({ kind: 'unknownConfigValue', path: `${path}/width`, value: typeof t.width === 'object' ? JSON.stringify(t.width) : String(t.width), used: 'fill' });
  }
  // Its share of a row's room, and what it gives back (#1095).
  for (const key of ['grow', 'shrink'] as const) {
    const v = t[key];
    if (v !== undefined && moduleFactor(v) === undefined) push({ kind: 'unknownConfigValue', path: `${path}/${key}`, value: String(v), used: '' });
  }
  for (const key of MODULE_PAGE_KEYS) {
    const value = (t as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    push({ kind: 'unknownConfigValue', path: `${path}/${key}`, value: typeof value === 'object' ? JSON.stringify(value) : String(value), used: '' });
  }
  if (!Array.isArray(t.groups)) return;
  t.groups.forEach((g, j) => {
    if (isRecord(g) && g.modules === true) push({ kind: 'unknownConfigValue', path: `${path}/groups/${j}/modules`, value: 'true', used: 'false' });
  });
}

/** What a page template (no module) writes of modules (#1088): a `width`
 *  (only a module has one), and a modules group `within` a group that is
 *  no modules stack of the template in no other. Each is ignored. */
function checkPageModules(t: PageTemplate, groups: readonly ResolvedFrameGroup[], path: string, push: Push): void {
  if (t.width !== undefined) push({ kind: 'unknownConfigValue', path: `${path}/width`, value: typeof t.width === 'object' ? JSON.stringify(t.width) : String(t.width), used: '' });
  for (const key of ['grow', 'shrink'] as const) {
    if (t[key] !== undefined) push({ kind: 'unknownConfigValue', path: `${path}/${key}`, value: String(t[key]), used: '' });
  }
  if (!Array.isArray(t.groups)) return;
  // The `within` chain as written (resolution drops a broken link).
  const written = groups.map((x) => {
    const entry = (t.groups as unknown[]).find((e) => isRecord(e) && e.name === x.name);
    return isRecord(entry) && entry.modules === true && typeof entry.within === 'string' && entry.within !== '' && entry.within !== x.name ? { ...x, within: entry.within } : x;
  });
  t.groups.forEach((g, j) => {
    if (!isRecord(g) || g.modules !== true || typeof g.within !== 'string' || g.within === '' || g.within === g.name) return;
    const self = written.find((x) => x.name === g.name);
    if (self && modulesGroupRoot(written, self) !== undefined) return;
    push({ kind: 'unknownConfigValue', path: `${path}/groups/${j}/within`, value: g.within, used: '' });
  });
}

/** `a → b → a`: the chain of `extends` from `index` until it repeats. */
function loopText(templates: readonly PageTemplate[], index: number, firstOf: Map<string, number>): string {
  const names: string[] = [];
  const seen = new Set<number>();
  let at: number | undefined = index;
  while (at !== undefined && !seen.has(at)) {
    seen.add(at);
    names.push(templates[at]!.id);
    const parent: unknown = templates[at]!.extends;
    at = typeof parent === 'string' ? firstOf.get(parent) : undefined;
  }
  if (at !== undefined) names.push(templates[at]!.id);
  return names.join(' → ');
}

function issueWarning(issue: TemplateIssue): ConfigWarning {
  const suggestion = issue.known ? closestKey(issue.value, issue.known) : undefined;
  return { kind: issue.kind, path: issue.path, value: issue.value, used: issue.used, ...(suggestion ? { suggestion } : {}) };
}

function pxConverter(options: ValidatePageTemplatesOptions): (d: Dimension) => number {
  const dpi = options.dpi ?? 96;
  const base = options.baseFontSizePx ?? 16;
  return (d) => dimensionToPx(d, dpi, base);
}

const text = (d: Dimension) => `${d.value}${d.unit}`;

/** A minimum above its maximum, and a fixed size outside them. */
function checkMinMax(frame: ResolvedFrame, toPx: (d: Dimension) => number, push: Push): void {
  const fieldPath = (key: string) => frame.fieldPaths[key] ?? `${frame.configPath}/${key}`;
  for (const axis of ['Width', 'Height'] as const) {
    const min = frame[`min${axis}`];
    const max = frame[`max${axis}`];
    if (min && max && toPx(min) > toPx(max) + 1e-6) {
      push({ kind: 'frameMinMax', path: fieldPath(`min${axis}`), value: `min${axis} ${text(min)} > max${axis} ${text(max)}`, used: text(min) });
    }
    const size = axis === 'Width' ? frame.width : frame.height;
    if (typeof size !== 'object' || 'percent' in size) continue;
    const key = axis.toLowerCase();
    const sizePath = frame.fieldPaths[key] ?? (frame.fieldPaths.placement ? `${frame.fieldPaths.placement}/size/${key}` : `${frame.configPath}/${key}`);
    // The minimum wins over the maximum.
    const hi = max && !(min && toPx(min) > toPx(max)) ? max : min;
    if (min && toPx(size) < toPx(min) - 1e-6) {
      push({ kind: 'frameMinMax', path: sizePath, value: `${key} ${text(size)} < min${axis} ${text(min)}`, used: text(min) });
    } else if (hi && max && toPx(size) > toPx(hi) + 1e-6) {
      push({ kind: 'frameMinMax', path: sizePath, value: `${key} ${text(size)} > max${axis} ${text(max)}`, used: text(hi) });
    }
  }
}

/** Named frame looks (#1089): an entry with no id is not read
 *  (`unknownConfigValue`); its keys are checked as a frame's `look`, at
 *  any depth, plus `id` and `name`. */
function checkFrameLooks(raw: unknown, prefix: string, push: Push): void {
  if (!Array.isArray(raw)) return;
  raw.forEach((e, i) => {
    const path = `${prefix}/${i}`;
    if (!isRecord(e)) return;
    if (typeof e.id !== 'string' || e.id === '') {
      push({ kind: 'unknownConfigValue', path: `${path}/id`, value: String(e.id ?? ''), used: '' });
      return;
    }
    unknownKeys(e, FRAME_LOOK_ENTRY_KEYS, path, push);
    checkLook(e, LOOK_TREE, path, push);
  });
}

function checkLabelStyles(raw: unknown, prefix: string, push: Push): void {
  if (!Array.isArray(raw)) return;
  raw.forEach((s, i) => {
    const path = `${prefix}/${i}`;
    if (!isRecord(s)) return;
    if (typeof s.id !== 'string' || s.id === '') {
      push({ kind: 'unknownConfigValue', path: `${path}/id`, value: String(s.id ?? ''), used: '' });
      return;
    }
    unknownKeys(s, LABEL_STYLE_KEYS, path, push);
    choice(s, 'fontStyle', LABEL_FONT_STYLES, DEFAULT_LABEL_STYLE.fontStyle, path, push);
    choice(s, 'textTransform', LABEL_TEXT_TRANSFORMS, DEFAULT_LABEL_STYLE.textTransform, path, push);
    choice(s, 'writingMode', FRAME_WRITING_MODES, 'horizontal-tb', path, push);
    choice(s, 'overlap', LABEL_OVERLAPS, 'check', path, push);
    choice(s, 'align', LABEL_ALIGNS, '', path, push);
    choice(s, 'kind', LABEL_KINDS, '', path, push);
    unknownKeys(s.border, LABEL_BORDER_KEYS, `${path}/border`, push);
    checkLeader(s.leader, `${path}/leader`, push);
  });
}

/** A leader's look (#1057): its keys, caps and routing. */
function checkLeader(leader: unknown, path: string, push: Push): void {
  if (!isRecord(leader)) return;
  unknownKeys(leader, LEADER_KEYS, path, push);
  choice(leader, 'startCap', CONNECTOR_CAPS, 'none', path, push);
  choice(leader, 'endCap', CONNECTOR_CAPS, 'dot', path, push);
  choice(leader, 'routing', LEADER_ROUTINGS, 'straight', path, push);
  checkOpacity(leader.opacity, `${path}/opacity`, push);
}

/** An `opacity` (#1079): a number in 0…1. Out of range: held (`used` the
 *  held value); not a number: opaque (`used: '1'`). */
export function opacityWarning(value: unknown, path: string): ConfigWarning | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) return undefined;
    return { kind: 'unknownConfigValue', path, value: String(value), used: String(Math.max(0, Math.min(1, value))) };
  }
  return { kind: 'unknownConfigValue', path, value: String(value), used: '1' };
}

function checkOpacity(value: unknown, path: string, push: Push): void {
  const w = opacityWarning(value, path);
  if (w) push(w);
}

/** A resource anchor's `labelAt` (#1057): two fractions of the picture;
 *  anything else is not read (the label stands at its point). A number
 *  outside 0…1 is read as written (a label beside the picture), so only a
 *  value that is not a point is reported. */
function checkLabelAt(labelAt: unknown, path: string, push: Push): void {
  if (labelAt === undefined) return;
  const ok = isRecord(labelAt) && typeof labelAt.x === 'number' && Number.isFinite(labelAt.x) && typeof labelAt.y === 'number' && Number.isFinite(labelAt.y);
  if (!ok) {
    push({ kind: 'unknownConfigValue', path, value: JSON.stringify(labelAt) ?? String(labelAt), used: '' });
    return;
  }
  unknownKeys(labelAt, { x: true, y: true }, path, push);
}

/** A resource anchor whose `style` no label style has. */
function checkAnchorStyles(labelStyles: unknown, resources: readonly Resource[] | undefined, push: Push): void {
  if (!resources) return;
  const ids = (Array.isArray(labelStyles) ? labelStyles : []).filter(isRecord).map((s) => s.id).filter((id): id is string => typeof id === 'string');
  const known = new Set(ids);
  resources.forEach((r, i) => {
    r.anchors?.forEach((a, j) => {
      // A label set away from its point and its leader (#1057).
      checkLabelAt((a as { labelAt?: unknown }).labelAt, `/resources/${i}/anchors/${j}/labelAt`, push);
      const leader = (a as { leader?: unknown }).leader;
      if (leader !== undefined && typeof leader !== 'boolean' && !isRecord(leader)) {
        push({ kind: 'unknownConfigValue', path: `/resources/${i}/anchors/${j}/leader`, value: String(leader), used: '' });
      } else checkLeader(leader, `/resources/${i}/anchors/${j}/leader`, push);
      if (typeof a.style !== 'string' || known.has(a.style)) return;
      const suggestion = closestKey(a.style, ids);
      push({ kind: 'labelStyleUnknown', path: `/resources/${i}/anchors/${j}/style`, value: a.style, used: '', resourceId: r.id, ...(suggestion ? { suggestion } : {}) });
    });
  });
}
