import type { PostextConfig } from '../types.js';

/**
 * A book's configuration in layers (#1209): the general settings every
 * edition reads, and per language an override that changes only the fields
 * it names. The override is merged over the general settings field by
 * field:
 *
 * - objects merge key by key, down to the leaves;
 * - a colour (`hex`) or a length (`value` + `unit`) is one value, replaced
 *   whole;
 * - a list whose entries carry an `id` (`calloutStyles`, `headingStyles`,
 *   `colorPalette`, `resourceTypes`, a template's frames…) merges entry by
 *   entry on the `id`; a `levels` list (headings, lists, the contents)
 *   merges on `level`, `customFonts` on `name`. An entry the general list
 *   lacks is added after its entries; `{ id, $remove: true }` takes one
 *   out for this language (a list reordered in one language takes every
 *   general entry out, then lists its own);
 * - any other list (a fallback face stack, tab stops) is replaced whole;
 * - `null` takes a general value out: the field reads the language's
 *   default, as if neither layer set it.
 */
export type ConfigOverride = { [key: string]: unknown };

/** The marker an override list entry carries to take the general list's
 *  entry with the same key out. */
export const REMOVE_ENTRY = '$remove';

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A value merged whole, never key by key: a colour or a length. */
const isAtom = (v: Json): boolean => 'hex' in v || ('value' in v && 'unit' in v);

/** The field a list's entries are matched on, or undefined for a list
 *  replaced whole. Every entry of both lists must carry it. */
function entryKeyOf(key: string, ...lists: readonly unknown[][]): string | undefined {
  const candidates = key === 'levels' ? ['level'] : key === 'customFonts' ? ['name'] : ['id'];
  const all = lists.flat();
  if (all.length === 0) return undefined;
  for (const field of candidates) {
    if (all.every((e) => isPlainObject(e) && (typeof e[field] === 'string' || typeof e[field] === 'number'))) return field;
  }
  return undefined;
}

function mergeList(base: unknown[], over: unknown[], field: string): unknown[] {
  const out = [...base];
  for (const entry of over) {
    const e = entry as Json;
    const at = out.findIndex((b) => (b as Json)[field] === e[field]);
    if (e[REMOVE_ENTRY] === true) {
      if (at >= 0) out.splice(at, 1);
      continue;
    }
    if (at === -1) out.push(entry);
    else out[at] = mergeValue(out[at], entry, '');
  }
  return out;
}

function mergeValue(base: unknown, over: unknown, key: string): unknown {
  if (over === undefined) return base;
  if (Array.isArray(over)) {
    const field = entryKeyOf(key, Array.isArray(base) ? base : [], over);
    return field ? mergeList(Array.isArray(base) ? base : [], over, field) : over;
  }
  if (isPlainObject(over) && isPlainObject(base) && !isAtom(over) && !isAtom(base)) {
    const out: Json = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) continue;
      if (v === null) delete out[k];
      else out[k] = mergeValue(base[k], v, k);
    }
    return out;
  }
  return over;
}

/** The configuration an edition lays out with: `override` over
 *  `general`, field by field (see {@link ConfigOverride}). Neither input
 *  is mutated; with no override, `general` itself. */
export function mergeConfigLayers(general: PostextConfig, override: ConfigOverride | undefined | null): PostextConfig {
  if (!override || Object.keys(override).length === 0) return general;
  return mergeValue(general, override, '') as PostextConfig;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isPlainObject(v)) return v;
  const out: Json = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
  return out;
}

function diffValue(general: unknown, own: unknown, key: string): unknown {
  if (sameJson(general, own)) return undefined;
  if (own === undefined) return null;
  if (Array.isArray(own) && Array.isArray(general)) {
    const field = entryKeyOf(key, general, own);
    if (field && keepsOrder(general, own, field)) {
      const out: unknown[] = [];
      for (const entry of own) {
        const e = entry as Json;
        const g = general.find((b) => (b as Json)[field] === e[field]);
        if (g === undefined) out.push(entry);
        else {
          const d = diffValue(g, entry, '');
          if (d !== undefined) out.push({ ...(d as Json), [field]: e[field] });
        }
      }
      for (const g of general) {
        const k = (g as Json)[field];
        if (!own.some((e) => (e as Json)[field] === k)) out.push({ [field]: k, [REMOVE_ENTRY]: true });
      }
      return out.length > 0 ? out : undefined;
    }
    // Reordered: every general entry out, then `own`'s in its order.
    if (field) return [...general.map((g) => ({ [field]: (g as Json)[field], [REMOVE_ENTRY]: true })), ...own];
    return own;
  }
  if (isPlainObject(own) && isPlainObject(general) && !isAtom(own) && !isAtom(general)) {
    const out: Json = {};
    for (const k of new Set([...Object.keys(general), ...Object.keys(own)])) {
      const d = diffValue(general[k], own[k], k);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return own;
}

/** Whether merging by key rebuilds `own`'s order: the entries `own` keeps
 *  from `general` come in `general`'s order, and the ones it adds after
 *  them. Otherwise the list is written whole. */
function keepsOrder(general: unknown[], own: unknown[], field: string): boolean {
  const generalKeys = general.map((g) => (g as Json)[field]);
  const ownKeys = own.map((e) => (e as Json)[field]);
  if (new Set(ownKeys).size !== ownKeys.length || new Set(generalKeys).size !== generalKeys.length) return false;
  const kept = ownKeys.filter((k) => generalKeys.includes(k));
  const added = ownKeys.filter((k) => !generalKeys.includes(k));
  const expected = [...generalKeys.filter((k) => ownKeys.includes(k)), ...added];
  return kept.length + added.length === ownKeys.length && expected.every((k, i) => k === ownKeys[i]);
}

/** The override that turns `general` into `own`: the fields `own` sets
 *  differently, `null` for the ones it leaves out, so that
 *  `mergeConfigLayers(general, diffConfigLayers(general, own))` is `own`
 *  (as JSON, key order aside). Empty when the two agree. */
export function diffConfigLayers(general: PostextConfig, own: PostextConfig): ConfigOverride {
  return (diffValue(general, own, '') as ConfigOverride | undefined) ?? {};
}

/** Whether the two configurations say the same, key order aside. */
export function sameConfig(a: unknown, b: unknown): boolean {
  return sameJson(a, b);
}

/** The settings two or more editions agree on: the fields every one of
 *  `configs` sets to the same value, objects compared field by field and
 *  keyed lists entry by entry (an entry they all have, with the fields
 *  they agree on). What a book whose editions each kept a whole
 *  configuration shares, as its general settings. */
export function commonConfig(configs: readonly PostextConfig[]): PostextConfig {
  if (configs.length === 0) return {} as PostextConfig;
  return (configs.slice(1).reduce<unknown>((acc, c) => commonValue(acc, c, ''), configs[0]) ?? {}) as PostextConfig;
}

function commonValue(a: unknown, b: unknown, key: string): unknown {
  if (sameJson(a, b)) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    const field = entryKeyOf(key, a, b);
    if (!field) return undefined;
    const out: unknown[] = [];
    for (const entry of a) {
      const other = b.find((e) => (e as Json)[field] === (entry as Json)[field]);
      if (other === undefined) continue;
      const c = commonValue(entry, other, '');
      if (isPlainObject(c)) out.push({ ...c, [field]: (entry as Json)[field] });
    }
    return out.length > 0 ? out : undefined;
  }
  if (isPlainObject(a) && isPlainObject(b) && !isAtom(a) && !isAtom(b)) {
    const out: Json = {};
    for (const k of Object.keys(a)) {
      if (!(k in b)) continue;
      const c = commonValue(a[k], b[k], k);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/** Where `override` sets something: each leaf as a dotted path, list
 *  entries named by their key (`calloutStyles[id=note].background`,
 *  `headings.levels[level=2].fontSize`); a `null` (back to the default)
 *  and a removed entry are leaves too. */
export function overridePaths(override: ConfigOverride | undefined | null): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, key: string): void => {
    if (Array.isArray(v)) {
      const field = entryKeyOf(key, v);
      if (!field) {
        out.push(path);
        return;
      }
      for (const e of v as Json[]) {
        const at = `${path}[${field}=${String(e[field])}]`;
        const rest = Object.keys(e).filter((k) => k !== field);
        if (rest.length === 0 || e[REMOVE_ENTRY] === true) out.push(at);
        else walk(Object.fromEntries(rest.map((k) => [k, e[k]])), at, '');
      }
      return;
    }
    if (isPlainObject(v) && !isAtom(v)) {
      for (const [k, child] of Object.entries(v)) if (child !== undefined) walk(child, path ? `${path}.${k}` : k, k);
      return;
    }
    out.push(path);
  };
  walk(override ?? {}, '', '');
  return out;
}

/** The override that turns `general` into `own` with nothing a reader
 *  would not miss: a `null` (or a removed list entry) that `normalize`
 *  makes no difference for — the general value is the default of `own`'s
 *  language too, which normalizing `own` (stripping its defaults) took
 *  out — is left out. `own` is taken as `normalize` gives it. */
export function leastConfigOverride(general: PostextConfig, own: PostextConfig, normalize: (c: PostextConfig) => PostextConfig): ConfigOverride {
  const target = normalize(own);
  const override = diffConfigLayers(general, target);
  const reads = () => sameConfig(normalize(mergeConfigLayers(general, override)), target);
  const prune = (node: Json | unknown[]): void => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const entry = node[i];
        if (!isPlainObject(entry)) continue;
        if (entry[REMOVE_ENTRY] === true) {
          node.splice(i, 1);
          if (!reads()) node.splice(i, 0, entry);
          continue;
        }
        const keyField = ['id', 'level', 'name'].find((k) => k in entry);
        prune(entry);
        // An entry left with its key alone changes nothing when it merges
        // into a general one; an entry the general list lacks is added.
        if (keyField && Object.keys(entry).length === 1) {
          node.splice(i, 1);
          if (!reads()) node.splice(i, 0, entry);
        }
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (value === null) {
        delete node[key];
        if (!reads()) node[key] = null;
      } else if (Array.isArray(value)) {
        prune(value);
        if (value.length === 0) delete node[key];
      } else if (isPlainObject(value) && !isAtom(value)) {
        prune(value);
        // An empty object merged into a general one changes nothing, but
        // inside an entry added whole it is a value of its own (a heading
        // style's `header: {}`, no running head on its pages).
        if (Object.keys(value).length === 0) {
          delete node[key];
          if (!reads()) node[key] = value;
        }
      }
    }
  };
  prune(override);
  return override;
}
