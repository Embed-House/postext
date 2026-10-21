import type { ContentBlock } from '../parse/types';
import type { PostextConfig } from '../types';
import type { DesignContextKind } from './placeholders';
import { configDesignSlots, type ConfigDesignSlotKind } from './slots';

/**
 * Decoration drawn when the page fence says so (#1087). A design element of
 * a running head or of a page template's decoration may carry `when: 'x'`
 * (drawn only on a composed page whose `::::page{…}` fence sets `x`) or
 * `unless: 'x'` (not drawn there). One shell then serves the front matter,
 * which prints no folio, and the body, which does: the Markdown says what a
 * page is, the config keeps the drawing.
 */

/** Where a design slot reads the condition: running heads and a composed
 *  page's decoration. A heading's, a part's or a box's design ignores it. */
export const FENCE_CONDITION_CONTEXTS: ReadonlySet<DesignContextKind> = new Set(['header', 'footer', 'composed']);

/** The configuration slots whose elements read the condition (see
 *  {@link FENCE_CONDITION_CONTEXTS}). */
export const FENCE_CONDITION_SLOTS: ReadonlySet<ConfigDesignSlotKind> = new Set(['header', 'footer', 'decoration']);

/** Whether a fence's attributes set `key`: written as a flag
 *  (`{frontmatter}`) or with any value but `false`. */
export function fenceSetsAttribute(attrs: Readonly<Record<string, string>> | undefined, key: string): boolean {
  if (!attrs || !Object.prototype.hasOwnProperty.call(attrs, key)) return false;
  const value = attrs[key];
  return typeof value === 'string' && value.trim().toLowerCase() !== 'false';
}

/** Whether an element with `when` / `unless` is drawn on a page whose fence
 *  has `attrs` (none: a page that is not composed). An element with
 *  neither is always drawn. */
export function fenceConditionMet(
  el: { when?: string; unless?: string },
  attrs: Readonly<Record<string, string>> | undefined,
): boolean {
  if (el.when !== undefined && !fenceSetsAttribute(attrs, el.when)) return false;
  if (el.unless !== undefined && fenceSetsAttribute(attrs, el.unless)) return false;
  return true;
}

/** A condition written in the configuration. */
export interface FenceConditionUse {
  /** The element's key: `pageTemplates[0].decoration.elements[2].when`. */
  path: string;
  condition: 'when' | 'unless';
  attribute: string;
}

/** Every `when` / `unless` the configuration writes on an element of a slot
 *  that reads it, in `configDesignSlots` order. Pure. */
export function fenceConditionUses(config: PostextConfig | undefined): FenceConditionUse[] {
  const out: FenceConditionUse[] = [];
  for (const slot of configDesignSlots(config)) {
    if (!FENCE_CONDITION_SLOTS.has(slot.kind)) continue;
    slot.slot.elements.forEach((el, i) => {
      const e = el as unknown as Record<string, unknown> | null;
      if (!e || typeof e !== 'object') return;
      for (const condition of ['when', 'unless'] as const) {
        const v = e[condition];
        if (typeof v === 'string' && v.trim() !== '') out.push({ path: `${slot.path}.elements[${i}].${condition}`, condition, attribute: v.trim() });
      }
    });
  }
  return out;
}

/** The conditions on an attribute no page of the book sets
 *  (`conditionNeverMet`, an information note of `postext check`): a `when`
 *  element never drawn, an `unless` one always drawn. `attributes` are the
 *  attributes the book's page fences set (see {@link fenceSetsAttribute}). */
export function fenceConditionsNeverMet(config: PostextConfig | undefined, attributes: Iterable<string>): FenceConditionUse[] {
  const set = new Set(attributes);
  return fenceConditionUses(config).filter((u) => !set.has(u.attribute));
}

/** The attributes a fence sets, for {@link fenceConditionsNeverMet}. */
export function fenceAttributesSet(attrs: Readonly<Record<string, string>> | undefined): string[] {
  return Object.keys(attrs ?? {}).filter((k) => fenceSetsAttribute(attrs, k));
}

/** An `{attr.<key>}` placeholder written in the configuration (#1152). */
export interface AttrPlaceholderUse {
  /** Where: `pageTemplates[0].footer.elements[1].content`. */
  path: string;
  attribute: string;
}

const ATTR_PLACEHOLDER_RE = /\{attr\.([A-Za-z0-9_-]+)\}/g;

/** Every `{attr.<key>}` the design slots of the configuration write, in any
 *  text of an element (its content, a picture's `resourceId`…), in
 *  `configDesignSlots` order. Pure. */
export function attrPlaceholderUses(config: PostextConfig | undefined): AttrPlaceholderUse[] {
  const out: AttrPlaceholderUse[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(ATTR_PLACEHOLDER_RE)) out.push({ path, attribute: m[1]! });
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };
  for (const slot of configDesignSlots(config)) {
    slot.slot.elements.forEach((el, i) => walk(el, `${slot.path}.elements[${i}]`));
  }
  return out;
}

/** The attribute keys the Markdown sets for `{attr.<key>}`: a heading's
 *  attribute block, a container's or a composed page's fence. */
export function markdownAttributesSet(blocks: readonly ContentBlock[]): string[] {
  const keys = new Set<string>();
  for (const b of blocks) for (const attrs of [b.attrs, b.containerAttrs]) for (const k of Object.keys(attrs ?? {})) keys.add(k);
  return [...keys];
}

/** The `{attr.<key>}` placeholders no heading or fence of the book sets
 *  (`conditionNeverMet`, a note of `postext check`): each always reads
 *  `''`, so the folio, running foot or picture it names is empty. */
export function attrPlaceholdersNeverSet(config: PostextConfig | undefined, attributes: Iterable<string>): AttrPlaceholderUse[] {
  const set = new Set(attributes);
  return attrPlaceholderUses(config).filter((u) => !set.has(u.attribute));
}
