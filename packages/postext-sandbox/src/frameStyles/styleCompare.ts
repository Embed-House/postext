/**
 * Near-identical callout styles (#873): two styles are compared on what
 * the engine resolves them to, field by field (a Dimension and a colour
 * are one field each), leaving out their id and name. Lengths count as
 * equal within a tolerance in mm, colours within a ΔE, so a box ported at
 * 3.98 mm of padding and one at 4 mm read as the same box.
 *
 * The suggestions group every style with the most used one it differs
 * from in at most `maxFields` fields: «these 3 styles differ only in
 * padding: merge?».
 */

import { srgbToLab, deltaE, type CalloutStyleConfig, type ResolvedCalloutStyleConfig } from 'postext';
import { framesOnly, usageWeight, type StyleUsage } from './styleUsage';

/** The fields a frame ignores (DESIGN §2.4: its rectangle comes from the
 *  template) plus the space around a box set in the flow: where the box
 *  stands, not what it looks like. */
export const POSITION_FIELDS: ReadonlySet<string> = new Set([
  'placement', 'span', 'columns', 'sideAtColumnEnd', 'fixed', 'floatBarrier', 'width', 'marginTop', 'marginBottom', 'snapToGrid',
]);

/** Never compared: what names the style. */
const NAMING_FIELDS: ReadonlySet<string> = new Set(['id', 'name']);

export interface CompareOptions {
  /** Most settings two styles may differ in and still be suggested (the
   *  four sides of a padding count once). Default 2
   *  (the four sides of a padding). */
  maxFields?: number;
  /** Lengths within this many millimetres are equal. Default 0.5. */
  lengthMm?: number;
  /** Colours within this CIE76 ΔE are equal. Default 2. */
  deltaE?: number;
  /** Compare styles used by `:::callout` boxes on their look only,
   *  leaving where the box stands out (merging then moves boxes). Styles
   *  only frames use are always compared so. Default false. */
  ignorePosition?: boolean;
  /** Pixels per inch of `px` lengths (the page's). Default 96. */
  dpi?: number;
  /** Size of an `em` in points (the body text's), for an `em` length
   *  against an absolute one. Default 10. */
  emPt?: number;
}

export type StyleLeaf =
  | { kind: 'length'; value: number; unit: string }
  | { kind: 'color'; hex: string }
  | { kind: 'value'; json: string };

const MM_PER: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };

function isDimension(v: unknown): v is { value: number; unit: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { value?: unknown }).value === 'number' && typeof (v as { unit?: unknown }).unit === 'string';
}

function isColor(v: unknown): v is { hex: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { hex?: unknown }).hex === 'string';
}

/** The fields of a resolved style, by dotted path. */
export function styleFields(style: ResolvedCalloutStyleConfig | CalloutStyleConfig): Map<string, StyleLeaf> {
  const out = new Map<string, StyleLeaf>();
  const walk = (v: unknown, path: string): void => {
    if (v === undefined) return;
    if (isDimension(v)) out.set(path, { kind: 'length', value: v.value, unit: v.unit });
    else if (isColor(v)) out.set(path, { kind: 'color', hex: v.hex.toLowerCase() });
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, path ? `${path}.${k}` : k);
    } else out.set(path, { kind: 'value', json: JSON.stringify(v) });
  };
  for (const [k, v] of Object.entries(style as unknown as Record<string, unknown>)) {
    if (!NAMING_FIELDS.has(k)) walk(v, k);
  }
  // What an unset colour shows: bold and italic words in the body's
  // colour. Whether the list colour was written out (`colorSet`) is no
  // look of its own: the colour is compared.
  const body = out.get('body.color');
  if (body) {
    if (!out.has('body.boldColor')) out.set('body.boldColor', body);
    if (!out.has('body.italicColor')) out.set('body.italicColor', body);
  }
  out.delete('lists.colorSet');
  return out;
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as 0–1 channels; null for anything else
 *  (`transparent`, a name). */
export function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

function sameColor(a: string, b: string, maxDeltaE: number): boolean {
  if (a === b) return true;
  const p = parseHex(a);
  const q = parseHex(b);
  if (!p || !q) return false;
  if (Math.abs(p.a - q.a) > 0.02) return false;
  return deltaE(srgbToLab(p.r, p.g, p.b), srgbToLab(q.r, q.g, q.b)) <= maxDeltaE;
}

/** A length in mm; null for a relative one with no size to read it by. */
function lengthMm(l: { value: number; unit: string }, dpi: number, emPt: number): number | null {
  const per = MM_PER[l.unit];
  if (per !== undefined) return l.value * per;
  if (l.unit === 'px') return (l.value / dpi) * 25.4;
  if (l.unit === 'em' || l.unit === 'rem') return l.value * emPt * MM_PER.pt!;
  return null;
}

function sameLeaf(a: StyleLeaf | undefined, b: StyleLeaf | undefined, o: Required<CompareOptions>): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'length' && b.kind === 'length') {
    if (a.unit === b.unit && a.value === b.value) return true;
    const x = lengthMm(a, o.dpi, o.emPt);
    const y = lengthMm(b, o.dpi, o.emPt);
    if (x === null || y === null) return a.unit === b.unit && Math.abs(a.value - b.value) < 1e-9;
    return Math.abs(x - y) <= o.lengthMm + 1e-9;
  }
  if (a.kind === 'color' && b.kind === 'color') return sameColor(a.hex, b.hex, o.deltaE);
  if (a.kind === 'value' && b.kind === 'value') return a.json === b.json;
  return false;
}

function withDefaults(o: CompareOptions = {}): Required<CompareOptions> {
  return {
    maxFields: o.maxFields ?? 2,
    lengthMm: o.lengthMm ?? 0.5,
    deltaE: o.deltaE ?? 2,
    ignorePosition: o.ignorePosition ?? false,
    dpi: o.dpi ?? 96,
    emPt: o.emPt ?? 10,
  };
}

/** Settings edited as one: the four sides of a padding. */
const ONE_SETTING = /^(padding|label\.padding|marker\.padding)\.(top|right|bottom|left)$/;

/** How many settings `paths` are, the sides of a padding counting once. */
export function countFields(paths: readonly string[]): number {
  return new Set(paths.map((p) => p.replace(ONE_SETTING, '$1'))).size;
}

/** The top-level key of a field path (`padding.left` → `padding`). */
export function fieldGroup(path: string): string {
  const dot = path.indexOf('.');
  return dot < 0 ? path : path.slice(0, dot);
}

/** The fields two styles differ in, sorted; `position: false` leaves out
 *  the fields that say where the box stands. */
export function styleDiff(
  a: Map<string, StyleLeaf>,
  b: Map<string, StyleLeaf>,
  options: CompareOptions & { position?: boolean } = {},
): string[] {
  const o = withDefaults(options);
  const out: string[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (options.position === false && POSITION_FIELDS.has(fieldGroup(path))) continue;
    if (!sameLeaf(a.get(path), b.get(path), o)) out.push(path);
  }
  return out.sort();
}

export interface MergeSuggestion {
  /** The style kept: the most used of the group. */
  keep: string;
  /** The styles merged into it, in list order. */
  merge: string[];
  /** Every field a merged style differs from the kept one in. */
  fields: string[];
  /** Their top-level keys (`padding`, `body`…), sorted. */
  groups: string[];
  /** `:::callout` boxes that stand elsewhere once their style is the kept
   *  one (their style placed them differently). */
  moves: number;
}

/** Groups of near-identical styles, each led by the style it would keep.
 *  `resolved[i]` is `styles[i]` as the engine resolves it. Built-in
 *  internal styles (`__postext-…`) never take part. */
export function mergeSuggestions(
  styles: readonly CalloutStyleConfig[],
  resolved: readonly ResolvedCalloutStyleConfig[],
  usage: ReadonlyMap<string, StyleUsage>,
  options: CompareOptions = {},
): MergeSuggestion[] {
  const o = withDefaults(options);
  const items = styles
    .map((s, index) => ({ id: s.id, index, fields: styleFields(resolved[index] ?? s), weight: usageWeight(usage.get(s.id)), framesOnly: framesOnly(usage.get(s.id)) }))
    .filter((s) => !s.id.startsWith('__postext-'));
  // Seeds: the most used first, then list order.
  const order = [...items].sort((x, y) => y.weight - x.weight || x.index - y.index);
  const taken = new Set<string>();
  const out: MergeSuggestion[] = [];
  for (const seed of order) {
    if (taken.has(seed.id)) continue;
    const members: { id: string; index: number; diff: string[]; moves: number }[] = [];
    for (const other of items) {
      if (other.id === seed.id || taken.has(other.id)) continue;
      // Where a box stands counts unless both styles take it from frames.
      const position = !(o.ignorePosition || (seed.framesOnly && other.framesOnly));
      const full = styleDiff(seed.fields, other.fields, o);
      const placed = full.some((p) => POSITION_FIELDS.has(fieldGroup(p)));
      // A box of the text that would stand elsewhere is no near twin.
      if (position && placed) continue;
      const diff = full.filter((p) => !POSITION_FIELDS.has(fieldGroup(p)));
      if (countFields(diff) > o.maxFields) continue;
      // Its boxes in the text take the kept style's place.
      const moved = !other.framesOnly && placed;
      members.push({ id: other.id, index: other.index, diff, moves: moved ? usage.get(other.id)?.fenceCount ?? 0 : 0 });
    }
    if (members.length === 0) continue;
    taken.add(seed.id);
    for (const m of members) taken.add(m.id);
    const fields = [...new Set(members.flatMap((m) => m.diff))].sort();
    out.push({
      keep: seed.id,
      merge: members.sort((x, y) => x.index - y.index).map((m) => m.id),
      fields,
      groups: [...new Set(fields.map(fieldGroup))].sort(),
      moves: members.reduce((n, m) => n + m.moves, 0),
    });
  }
  return out;
}

/** How many styles a book keeps once every suggestion is taken. */
export function stylesAfterMerging(styleCount: number, suggestions: readonly MergeSuggestion[]): number {
  return styleCount - suggestions.reduce((n, s) => n + s.merge.length, 0);
}

/** The settings (top-level keys) two styles differ in, past the
 *  tolerances, where the box stands included. */
export function differingGroups(
  a: ResolvedCalloutStyleConfig | CalloutStyleConfig,
  b: ResolvedCalloutStyleConfig | CalloutStyleConfig,
  options: CompareOptions = {},
): string[] {
  return [...new Set(styleDiff(styleFields(a), styleFields(b), options).map(fieldGroup))].sort();
}
