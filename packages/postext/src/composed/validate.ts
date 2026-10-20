// Validation of page templates and label styles (composed pages, #853).
// The engine ignores unknown keys elsewhere; a template is checked and every
// problem reported as a config warning whose `path` is a JSON pointer
// (`/pageTemplates/3/frames/2/style`). Pure.

import type { CalloutPaddingConfig, Dimension, PostextConfig, Resource } from '../types';
import type { ConfigWarning } from '../vdt';
import type {
  FrameConfig,
  FrameFitConfig,
  FrameGridCell,
  FrameGroupConfig,
  FrameLook,
  FrameOverflowConfig,
  FrameRulesConfig,
  LabelStyle,
  PageTemplate,
  PageTemplateGrid,
  PageTemplatePatch,
  ResolvedFrame,
} from './types';
import { closestKey } from '../util/closestKey';
import { dimensionToPx } from '../units';
import {
  FRAME_DIRECTIONS,
  FRAME_EXCLUDES,
  FRAME_WRAPS,
  FRAME_GROUP_ALIGNS,
  FRAME_GROUP_KINDS,
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
  resolveTemplateAt,
  templateChain,
  type TemplateIssue,
} from './templates';

// The keys of each object, checked against its type: a key added to a type
// fails to compile until it is listed here.
const TEMPLATE_KEYS = {
  id: true, name: true, extends: true, spread: true, gutter: true, variants: true, role: true,
  area: true, grid: true, frames: true, groups: true, decoration: true, header: true, footer: true,
  overflowTemplate: true, bodyStyle: true, palette: true,
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
  overflow: true, optional: true, crossGutter: true, writingMode: true, direction: true, rules: true, look: true, remove: true,
} satisfies Record<keyof FrameConfig, true>;
const LOOK_KEYS = { background: true, border: true, stripe: true, icon: true, marker: true, titleStyle: true, body: true, label: true } satisfies Record<keyof FrameLook, true>;
const RULES_KEYS = { every: true, color: true, width: true, inset: true } satisfies Record<keyof FrameRulesConfig, true>;
const FIT_KEYS = { shrinkText: true, minScale: true, scaleImages: true, imageMinScale: true, preferContinue: true } satisfies Record<keyof FrameFitConfig, true>;
const OVERFLOW_KEYS = { continueIn: true, mark: true, fromMark: true } satisfies Record<keyof FrameOverflowConfig, true>;
const PADDING_KEYS = { top: true, right: true, bottom: true, left: true } satisfies Record<keyof CalloutPaddingConfig, true>;
const GROUP_KEYS = {
  name: true, kind: true, frames: true, gap: true, placement: true, grid: true, align: true, remove: true,
} satisfies Record<keyof FrameGroupConfig, true>;
const LABEL_STYLE_KEYS = {
  id: true, name: true, paragraphStyle: true, fontFamily: true, fontSize: true, fontWeight: true, fontStyle: true,
  color: true, textTransform: true, letterSpacing: true, halo: true, background: true, padding: true, minScale: true,
  writingMode: true, overlap: true, align: true, border: true, radius: true, kind: true,
} satisfies Record<keyof LabelStyle, true>;
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
 * `kind`, `align`, `writingMode`, `direction`, `fontStyle`,
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
  const overrides = config.htmlViewer?.overrides;
  if (isRecord(overrides)) {
    checkTemplates(overrides.pageTemplates, '/htmlViewer/overrides/pageTemplates', calloutIds(overrides.calloutStyles ?? config.calloutStyles), options, push);
    checkLabelStyles(overrides.labelStyles, '/htmlViewer/overrides/labelStyles', push);
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
    }
  }
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
  });
}

/** A resource anchor whose `style` no label style has. */
function checkAnchorStyles(labelStyles: unknown, resources: readonly Resource[] | undefined, push: Push): void {
  if (!resources) return;
  const ids = (Array.isArray(labelStyles) ? labelStyles : []).filter(isRecord).map((s) => s.id).filter((id): id is string => typeof id === 'string');
  const known = new Set(ids);
  resources.forEach((r, i) => {
    r.anchors?.forEach((a, j) => {
      if (typeof a.style !== 'string' || known.has(a.style)) return;
      const suggestion = closestKey(a.style, ids);
      push({ kind: 'labelStyleUnknown', path: `/resources/${i}/anchors/${j}/style`, value: a.style, used: '', resourceId: r.id, ...(suggestion ? { suggestion } : {}) });
    });
  });
}
