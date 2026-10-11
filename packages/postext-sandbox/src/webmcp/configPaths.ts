// Reading and writing one setting of a configuration by its path, the way
// the tools name them: `page.margins.top`, `headingStyles[0].fontSize`,
// `calloutStyles[id=note].title`, `headings.levels[level=2].fontSize`.
// Nothing here mutates: a write gives back a new configuration that shares
// what it did not touch.

import { ToolError } from './modelContext';

/** One step of a path: a member, an item by position, or the item of a
 *  list whose `key` reads `value` (`[id=note]`, `[level=2]`). */
export type Step = { key: string } | { index: number } | { where: string; value: string };

type Json = unknown;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The steps of a path. `[3]` is an item by position, `[id=x]` the item
 *  of a list whose `id` is `x`. */
export function parsePath(path: string): Step[] {
  const steps: Step[] = [];
  const pattern = /([^.[\]]+)|\[(\d+)\]|\[([A-Za-z_][\w-]*)=([^\]]+)\]/g;
  let consumed = 0;
  for (const match of path.matchAll(pattern)) {
    const between = path.slice(consumed, match.index);
    if (between !== '' && between !== '.') throw new ToolError(`"${path}" is not a setting path (unexpected "${between}").`);
    if (match[1] !== undefined) steps.push({ key: match[1] });
    else if (match[2] !== undefined) steps.push({ index: Number(match[2]) });
    else steps.push({ where: match[3]!, value: match[4]!.replace(/^["']|["']$/g, '') });
    consumed = match.index + match[0].length;
  }
  if (consumed !== path.length) throw new ToolError(`"${path}" is not a setting path (unexpected "${path.slice(consumed)}").`);
  return steps;
}

const stepText = (step: Step): string => ('key' in step ? step.key : 'index' in step ? `[${step.index}]` : `[${step.where}=${step.value}]`);

/** The path a list of steps spells. */
export function formatPath(steps: readonly Step[]): string {
  let out = '';
  for (const step of steps) out += 'key' in step ? (out ? `.${step.key}` : step.key) : stepText(step);
  return out;
}

const matches = (item: unknown, step: { where: string; value: string }): boolean => isRecord(item) && item[step.where] !== undefined && String(item[step.where]) === step.value;

function child(parent: Json, step: Step): Json {
  if ('key' in step) return isRecord(parent) ? parent[step.key] : undefined;
  if (!Array.isArray(parent)) return undefined;
  if ('index' in step) return parent[step.index];
  return parent.find((item) => matches(item, step));
}

/** The value `steps` lead to from `root`, or undefined where there is
 *  none. */
export function getAtSteps(root: Json, steps: readonly Step[]): Json {
  let value = root;
  for (const step of steps) {
    value = child(value, step);
    if (value === undefined) return undefined;
  }
  return value;
}

/** The value at `path` (the whole of `root` for an empty path), or
 *  undefined where there is none. */
export function getAtPath(root: Json, path: string): Json {
  return getAtSteps(root, parsePath(path));
}

/** The member that tells the items of `list` apart — `id` for the named
 *  styles and design elements, `level` for the per-level lists — or null
 *  when its items are only told apart by position. */
export function identityKeyOf(list: unknown): 'id' | 'level' | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const key of ['id', 'level'] as const) {
    const seen = new Set<string>();
    const all = list.every((item) => {
      if (!isRecord(item)) return false;
      const value = item[key];
      if (typeof value !== 'string' && typeof value !== 'number') return false;
      if (seen.has(String(value))) return false;
      seen.add(String(value));
      return true;
    });
    if (all) return key;
  }
  return null;
}

/** `steps` with every position in a list of `reference` whose items have
 *  an identity turned into that identity: position 1 of `headings.levels`
 *  is `[level=2]` wherever the list is read, however many of its levels a
 *  book stores. Steps `reference` has nothing for are left as they are. */
export function canonicalSteps(reference: Json, steps: readonly Step[]): Step[] {
  const out: Step[] = [];
  let at: Json = reference;
  for (const step of steps) {
    let next: Step = step;
    if ('index' in step && Array.isArray(at)) {
      const key = identityKeyOf(at);
      const item = at[step.index];
      if (key && isRecord(item)) next = { where: key, value: String(item[key]) };
    }
    out.push(next);
    at = at === undefined ? undefined : child(at, next);
  }
  return out;
}

/** The value a new list item made for `step` starts from: the member that
 *  names it. A number where the list's other items carry numbers. */
function seedOf(step: { where: string; value: string }, list: readonly unknown[]): Record<string, unknown> {
  const numeric = /^-?\d+(\.\d+)?$/.test(step.value) && (step.where !== 'id') && list.every((item) => !isRecord(item) || typeof item[step.where] !== 'string');
  return { [step.where]: numeric ? Number(step.value) : step.value };
}

function write(parent: Json, steps: readonly Step[], at: number, value: Json, path: string): Json {
  if (at === steps.length) return value;
  const step = steps[at]!;
  const removing = value === undefined && at === steps.length - 1;
  if ('key' in step) {
    if (parent !== undefined && !isRecord(parent)) {
      throw new ToolError(`"${path}": ${formatPath(steps.slice(0, at)) || 'the configuration'} is not an object, so it has no "${step.key}".`);
    }
    const record = parent ?? {};
    const next = write(record[step.key], steps, at + 1, value, path);
    const copy = { ...record };
    if (next === undefined) delete copy[step.key];
    else copy[step.key] = next;
    // An object emptied by a removal goes too: an absent section is how a
    // configuration says "as designed".
    return removing || next === undefined ? (Object.keys(copy).length > 0 ? copy : undefined) : copy;
  }
  if (parent !== undefined && !Array.isArray(parent)) {
    throw new ToolError(`"${path}": ${formatPath(steps.slice(0, at))} is not a list.`);
  }
  const list = [...(parent ?? [])];
  const index = 'index' in step ? step.index : list.findIndex((item) => matches(item, step));
  if (index < 0) {
    // A new item named by what tells it apart is added at the end, with
    // that member.
    if (value === undefined) return parent;
    const seed = seedOf(step as { where: string; value: string }, list);
    const made = write(undefined, steps, at + 1, value, path);
    list.push(isRecord(made) ? { ...seed, ...made } : made);
    return list;
  }
  if (index > list.length) throw new ToolError(`"${path}": the list has ${list.length} item(s); the next free position is [${list.length}].`);
  const next = write(list[index], steps, at + 1, value, path);
  if (next === undefined) list.splice(index, 1);
  else list[index] = next;
  return list;
}

/** `root` with the value `steps` lead to replaced by `value`; `undefined`
 *  removes it (and the objects that leaves empty). */
export function setAtSteps<T>(root: T, steps: readonly Step[], value: Json): T {
  const path = formatPath(steps);
  if (steps.length === 0) {
    if (!isRecord(value)) throw new ToolError('The whole configuration can only be replaced by an object.');
    return value as T;
  }
  return (write(root, steps, 0, value, path) ?? {}) as T;
}

/** `root` with the value at `path` replaced by `value`; `undefined`
 *  removes it (and the objects that leaves empty). */
export function setAtPath<T>(root: T, path: string, value: Json): T {
  return setAtSteps(root, parsePath(path), value);
}

/** Every leaf of `value` by its path, lists by what tells their items
 *  apart (or by position), down to `depth` levels. An empty object or
 *  list is a leaf. */
export function leafEntries(value: Json, depth = 12): Map<string, Json> {
  const out = new Map<string, Json>();
  const walk = (node: Json, prefix: string, left: number): void => {
    if (left === 0 || (!isRecord(node) && !Array.isArray(node))) {
      if (prefix) out.set(prefix, node);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length === 0 && prefix) out.set(prefix, node);
      const key = identityKeyOf(node);
      node.forEach((item, i) => walk(item, `${prefix}${key ? `[${key}=${String((item as Record<string, unknown>)[key])}]` : `[${i}]`}`, left - 1));
      return;
    }
    const members = Object.entries(node);
    if (members.length === 0 && prefix) out.set(prefix, node);
    for (const [key, member] of members) walk(member, prefix ? `${prefix}.${key}` : key, left - 1);
  };
  walk(value, '', depth);
  return out;
}

/** `target` with `patch` merged in (JSON Merge Patch, RFC 7386): objects
 *  merge member by member, `null` removes a member, anything else —
 *  lists included — replaces what was there. */
export function mergePatch<T>(target: T, patch: Json): T {
  if (!isRecord(patch)) return patch as T;
  const out: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out as T;
}

/** Every path `patch` writes, for telling what a merge changed. */
export function patchPaths(patch: Json, prefix = ''): string[] {
  if (!isRecord(patch)) return [prefix];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value) && Object.keys(value).length > 0) paths.push(...patchPaths(value, path));
    else paths.push(path);
  }
  return paths;
}
