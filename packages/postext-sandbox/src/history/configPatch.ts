/**
 * Configuration changes as patches (#899): what a write changed, leaf by
 * leaf, with the value before and after, so a step of the history can be
 * taken back (`before`) or put back (`after`) on whatever the configuration
 * is by then, touching only those leaves.
 *
 * Objects are walked key by key and lists of the same length item by item;
 * a list that grew or shrank is one leaf (the whole list). `undefined`
 * stands for a key that is not there.
 */

export type PatchSegment = string | number;

export interface PatchOp {
  path: PatchSegment[];
  before: unknown;
  after: unknown;
}

export type ConfigPatch = PatchOp[];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function walk(a: unknown, b: unknown, path: PatchSegment[], out: PatchOp[]): void {
  if (Object.is(a, b)) return;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walk(a[k], b[k], [...path, k], out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) walk(a[i], b[i], [...path, i], out);
    return;
  }
  out.push({ path, before: a, after: b });
}

/** The leaves that differ between two configurations. `keys` limits the
 *  walk to those top-level keys (an `UPDATE_CONFIG` names the ones it
 *  writes). Values equal in content but not in identity are no change. */
export function diffConfig(before: object, after: object, keys?: readonly string[]): ConfigPatch {
  const out: PatchOp[] = [];
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  if (keys) {
    for (const k of keys) walk(a[k], b[k], [k], out);
  } else {
    walk(a, b, [], out);
  }
  return out;
}

function setIn(node: unknown, path: readonly PatchSegment[], at: number, value: unknown): unknown {
  if (at === path.length) return value;
  const seg = path[at]!;
  if (typeof seg === 'number' && Array.isArray(node)) {
    const copy = node.slice();
    copy[seg] = setIn(node[seg], path, at + 1, value);
    return copy;
  }
  const base: Record<string, unknown> = isPlainObject(node) ? { ...node } : {};
  const next = setIn(base[String(seg)], path, at + 1, value);
  if (next === undefined) delete base[String(seg)];
  else base[String(seg)] = next;
  return base;
}

/** `config` with each leaf of `patch` set to its value on `side`, a new
 *  object sharing every untouched branch. */
export function applyPatch<T extends object>(config: T, patch: ConfigPatch, side: 'before' | 'after'): T {
  let out: unknown = config;
  for (const op of patch) out = setIn(out, op.path, 0, side === 'before' ? op.before : op.after);
  return out as T;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function isPrefix(prefix: readonly PatchSegment[], path: readonly PatchSegment[]): boolean {
  return prefix.length <= path.length && prefix.every((seg, i) => seg === path[i]);
}

/** Whether every leaf `newer` changes is one `older` changed, or lies
 *  under one: the second write goes on with the first (a slider moved on,
 *  a number typed on, after the first write made the branch). */
export function patchCovers(older: ConfigPatch, newer: ConfigPatch): boolean {
  return newer.every((n) => older.some((o) => isPrefix(o.path, n.path)));
}

function getIn(node: unknown, path: readonly PatchSegment[]): unknown {
  let at: unknown = node;
  for (const seg of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[seg as string];
  }
  return at;
}

/** `older` carried on to `config` (the configuration after a write it
 *  covers): each leaf keeps its value before the first write and takes
 *  the one it has now. */
export function carryPatch(older: ConfigPatch, config: object): ConfigPatch {
  return older.map((op) => ({ path: op.path, before: op.before, after: getIn(config, op.path) }));
}

/** Whether a patch puts back what was there (a slider dragged and
 *  brought back): a step that changes nothing. */
export function patchIsEmpty(patch: ConfigPatch): boolean {
  return patch.every((op) => deepEqual(op.before, op.after));
}

/** The top-level settings a patch touches (`page`, `pageTemplates`…). */
export function patchTopKeys(patch: ConfigPatch): string[] {
  return [...new Set(patch.map((op) => String(op.path[0] ?? '')).filter((k) => k !== ''))];
}

/** A leaf's path as the WebMCP tools write it (`page.margins.top`,
 *  `pageTemplates[id=folio].frames[0].x`): an item of a list of things
 *  with an `id` (or a heading `level`) is named by it, as it was before
 *  the change. */
export function formatPatchPath(config: object, path: readonly PatchSegment[]): string {
  let out = '';
  let node: unknown = config;
  for (const seg of path) {
    if (typeof seg === 'number') {
      const item = Array.isArray(node) ? node[seg] : undefined;
      const rec = isPlainObject(item) ? item : null;
      if (rec && typeof rec.id === 'string') out += `[id=${rec.id}]`;
      else if (rec && typeof rec.level === 'number') out += `[level=${rec.level}]`;
      else out += `[${seg}]`;
      node = item;
    } else {
      out += out === '' ? seg : `.${seg}`;
      node = isPlainObject(node) ? node[seg] : undefined;
    }
  }
  return out;
}

/** The leaves under `value` (itself when it is no object), as paths. */
function leavesOf(value: unknown, path: PatchSegment[], out: PatchSegment[][]): void {
  // A dimension (`{ value, unit }`) is one setting.
  if (isPlainObject(value) && Object.keys(value).length > 0 && !('value' in value && 'unit' in value)) {
    for (const [k, v] of Object.entries(value)) leavesOf(v, [...path, k], out);
    return;
  }
  out.push(path);
}

function isDimension(v: unknown): boolean {
  return isPlainObject(v) && 'value' in v && 'unit' in v;
}

/** The settings a patch changed, as the tools name them: a branch added
 *  or removed whole is named by the leaves it holds. */
export function patchSettingPaths(config: object, patch: ConfigPatch, max = 12): string[] {
  const out: string[] = [];
  for (const op of patch) {
    const whole = op.before === undefined ? op.after : op.after === undefined ? op.before : undefined;
    const paths: PatchSegment[][] = [];
    if (whole !== undefined) leavesOf(whole, op.path, paths);
    else paths.push(op.path);
    for (const leaf of paths) {
      // A dimension's number or unit is the dimension.
      const last = leaf[leaf.length - 1];
      const parent = leaf.slice(0, -1);
      const dim = (last === 'value' || last === 'unit') && isDimension(getIn(config, parent));
      const name = formatPatchPath(config, dim ? parent : leaf);
      if (out.includes(name)) continue;
      if (out.length >= max) return out;
      out.push(name);
    }
  }
  return out;
}
