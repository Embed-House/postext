// Reading and writing one setting of a configuration by its path, the way
// the tools name them: `page.margins.top`, `headingStyles[0].fontSize`,
// `calloutStyles[id=note].title`. Nothing here mutates: a write gives back
// a new configuration that shares what it did not touch.

import { ToolError } from './modelContext';

type Step = { key: string } | { index: number } | { id: string };

type Json = unknown;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The steps of a path. `[3]` is an item by position, `[id=x]` the item
 *  of a list whose `id` is `x`. */
export function parsePath(path: string): Step[] {
  const steps: Step[] = [];
  const pattern = /([^.[\]]+)|\[(\d+)\]|\[id=([^\]]+)\]/g;
  let consumed = 0;
  for (const match of path.matchAll(pattern)) {
    const between = path.slice(consumed, match.index);
    if (between !== '' && between !== '.') throw new ToolError(`"${path}" is not a setting path (unexpected "${between}").`);
    if (match[1] !== undefined) steps.push({ key: match[1] });
    else if (match[2] !== undefined) steps.push({ index: Number(match[2]) });
    else steps.push({ id: match[3]!.replace(/^["']|["']$/g, '') });
    consumed = match.index + match[0].length;
  }
  if (consumed !== path.length) throw new ToolError(`"${path}" is not a setting path (unexpected "${path.slice(consumed)}").`);
  return steps;
}

const stepText = (step: Step): string => ('key' in step ? step.key : 'index' in step ? `[${step.index}]` : `[id=${step.id}]`);

function child(parent: Json, step: Step): Json {
  if ('key' in step) return isRecord(parent) ? parent[step.key] : undefined;
  if (!Array.isArray(parent)) return undefined;
  if ('index' in step) return parent[step.index];
  return parent.find((item) => isRecord(item) && item.id === step.id);
}

/** The value at `path` (the whole of `root` for an empty path), or
 *  undefined where there is none. */
export function getAtPath(root: Json, path: string): Json {
  let value = root;
  for (const step of parsePath(path)) {
    value = child(value, step);
    if (value === undefined) return undefined;
  }
  return value;
}

function write(parent: Json, steps: Step[], at: number, value: Json, path: string): Json {
  if (at === steps.length) return value;
  const step = steps[at]!;
  const removing = value === undefined && at === steps.length - 1;
  if ('key' in step) {
    if (parent !== undefined && !isRecord(parent)) {
      throw new ToolError(`"${path}": ${steps.slice(0, at).map(stepText).join('.') || 'the configuration'} is not an object, so it has no "${step.key}".`);
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
    throw new ToolError(`"${path}": ${steps.slice(0, at).map(stepText).join('.')} is not a list.`);
  }
  const list = [...(parent ?? [])];
  const index = 'index' in step ? step.index : list.findIndex((item) => isRecord(item) && item.id === step.id);
  if (index < 0) {
    // A new item named by its id is added at the end, with that id.
    if (removing) return list;
    const made = write(undefined, steps, at + 1, value, path);
    list.push(isRecord(made) ? { id: (step as { id: string }).id, ...made } : made);
    return list;
  }
  if (index > list.length) throw new ToolError(`"${path}": the list has ${list.length} item(s); the next free position is [${list.length}].`);
  const next = write(list[index], steps, at + 1, value, path);
  if (next === undefined) list.splice(index, 1);
  else list[index] = next;
  return list;
}

/** `root` with the value at `path` replaced by `value`; `undefined`
 *  removes it (and the objects that leaves empty). */
export function setAtPath<T>(root: T, path: string, value: Json): T {
  const steps = parsePath(path);
  if (steps.length === 0) {
    if (!isRecord(value)) throw new ToolError('The whole configuration can only be replaced by an object.');
    return value as T;
  }
  return (write(root, steps, 0, value, path) ?? {}) as T;
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
