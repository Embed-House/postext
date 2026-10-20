/**
 * Connectors of a page template's decoration in the editor (#1063): what
 * picking a frame does to a connector, the ends it has, the boxes it can
 * join, and the write of one decoration element of a template's scope.
 *
 * Pure: the Design panel's connector editor, the canvas's frame picking and
 * the `sandbox_*` tools (through the config they write) share these.
 */

import type { ConnectorEnd, DesignConnectorElement, DesignElement, PageTemplate, ResolvedPageTemplate } from 'postext';
import { joinDecoration, scopeEntry, splitDecoration, templateAt, updateTemplate, type TemplateScope } from './templateEdits';

/** Which end a click on the canvas sets: the line's start (`from`), or one
 *  more of the ends it goes to. */
export type ConnectorPickPhase = 'from' | 'to';

/** A box a connector's end can name, in the order the editor lists them. */
export interface ConnectorTarget {
  /** What the end's `to` holds: `#title`, `#card[*]`, `#tree`. */
  value: `#${string}`;
  kind: 'frame' | 'group' | 'instances' | 'element';
  /** The frame's, group's or element's own name. */
  name: string;
}

/** The ends a connector goes to, as a list. */
export function connectorToEnds(el: Pick<DesignConnectorElement, 'to'>): ConnectorEnd[] {
  const to = el.to as ConnectorEnd | ConnectorEnd[] | undefined;
  if (Array.isArray(to)) return to.filter((e): e is ConnectorEnd => !!e && typeof e === 'object');
  return to && typeof to === 'object' ? [to] : [];
}

/** `to` written back: one end as an object (how a connector is usually
 *  written), several as a list, none as an empty list. */
function writeTo(ends: readonly ConnectorEnd[]): ConnectorEnd | ConnectorEnd[] {
  return ends.length === 1 ? { ...ends[0]! } : ends.map((e) => ({ ...e }));
}

/** The connector with its ends going to `ends`. */
export function withToEnds(el: DesignConnectorElement, ends: readonly ConnectorEnd[]): DesignConnectorElement {
  return { ...el, to: writeTo(ends) };
}

/** `name` as an end's `to` (`#name`); a name already written with `#` is
 *  kept. */
export function endRef(name: string): `#${string}` {
  return (name.startsWith('#') ? name : `#${name}`) as `#${string}`;
}

/** The connector starting at `to`: the side, point and gap of the old start
 *  are kept, so moving a line's start to another frame keeps its look. */
export function setConnectorFrom(el: DesignConnectorElement, to: string): DesignConnectorElement {
  const ref = endRef(to);
  const ends = connectorToEnds(el);
  // A line never goes to its own start.
  const out = { ...el, from: { ...el.from, to: ref } };
  return ends.some((e) => e.to === ref) ? withToEnds(out, ends.filter((e) => e.to !== ref)) : out;
}

/** `to` added to the ends the connector goes to, or taken out when it is
 *  one of them already. */
export function toggleConnectorTo(el: DesignConnectorElement, to: string): DesignConnectorElement {
  const ref = endRef(to);
  const ends = connectorToEnds(el);
  const at = ends.findIndex((e) => e.to === ref);
  if (at >= 0) return withToEnds(el, ends.filter((_, i) => i !== at));
  return withToEnds(el, [...ends, { to: ref }]);
}

/** One end's fields changed (`'from'`, or the index of a `to` end); an
 *  undefined value takes the field off. */
export function updateConnectorEnd(el: DesignConnectorElement, which: 'from' | number, patch: Partial<Omit<ConnectorEnd, 'to'>>): DesignConnectorElement {
  const apply = (e: ConnectorEnd): ConnectorEnd => {
    const out = { ...e } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out as unknown as ConnectorEnd;
  };
  if (which === 'from') return { ...el, from: apply(el.from) };
  const ends = connectorToEnds(el);
  if (!ends[which]) return el;
  return withToEnds(el, ends.map((e, i) => (i === which ? apply(e) : e)));
}

/** What a click on frame `name` does while a connector is being picked
 *  (#1063): in the `from` phase it sets the start and moves on to the
 *  ends, which start afresh (a line is drawn from a frame to its targets);
 *  in the `to` phase it adds that frame as an end (or takes it out again).
 *  Shift held (`additive`) adds or takes out an end in either phase. A
 *  click on the line's own start while picking its ends changes nothing. */
export function pickConnectorFrame(el: DesignConnectorElement, phase: ConnectorPickPhase, name: string, additive = false): { element: DesignConnectorElement; phase: ConnectorPickPhase } {
  const ref = endRef(name);
  if (phase === 'from' && !additive) return { element: withToEnds(setConnectorFrom(el, ref), []), phase: 'to' };
  if (el.from?.to === ref) return { element: el, phase };
  return { element: toggleConnectorTo(el, ref), phase };
}

/** A new connector of the decoration: from the template's first frame to
 *  its second (an elbow, the engine's default), ready to be picked again
 *  on the page. */
export function newConnector(id: string, frames: readonly string[]): DesignConnectorElement {
  const [a, b] = frames;
  return {
    kind: 'connector',
    id,
    from: { to: endRef(a ?? 'frame') },
    to: b ? { to: endRef(b) } : [],
    routing: 'elbow',
  };
}

/** A frame or group of the template, as the decoration editor lists them
 *  (`repeated`: a frame of a repeating grid, #1061). */
export interface ConnectorFrameInput {
  name: string;
  kind: 'frame' | 'group';
  repeated?: boolean;
}

/** The boxes an end can name on a template: its frames (every instance of
 *  a repeated one as `[*]` too), its groups and the decoration's other
 *  placed elements. */
export function connectorTargets(frames: readonly ConnectorFrameInput[], elements: readonly Pick<DesignElement, 'id' | 'kind'>[] = []): ConnectorTarget[] {
  const out: ConnectorTarget[] = [];
  for (const f of frames) {
    if (f.kind === 'group') continue;
    out.push({ value: endRef(f.name), kind: 'frame', name: f.name });
    if (f.repeated) out.push({ value: `#${f.name}[*]`, kind: 'instances', name: f.name });
  }
  for (const g of frames) if (g.kind === 'group') out.push({ value: endRef(g.name), kind: 'group', name: g.name });
  for (const el of elements) if (el.kind !== 'connector') out.push({ value: endRef(el.id), kind: 'element', name: el.id });
  return out;
}

/** The frames and groups of a resolved template as the editor lists them. */
export function templateFrameInputs(template: Pick<ResolvedPageTemplate, 'frames' | 'groups'>): ConnectorFrameInput[] {
  const repeated = new Set<string>();
  for (const g of template.groups) for (const f of g.repeat?.frames ?? []) repeated.add(f);
  return [
    ...template.frames.map((f) => ({ name: f.name, kind: 'frame' as const, ...(repeated.has(f.name) ? { repeated: true } : {}) })),
    ...template.groups.map((g) => ({ name: g.name, kind: 'group' as const })),
  ];
}

/** The decoration element `elementId` of template `id`'s scope changed by
 *  `edit` (the elements the scope hides kept). Unchanged when the scope
 *  does not hold that element itself (an inherited one is the parent's). */
export function updateDecorationElement(
  templates: readonly PageTemplate[],
  id: string,
  scope: TemplateScope,
  elementId: string,
  edit: (el: DesignElement) => DesignElement,
): PageTemplate[] {
  const own = templateAt(templates, id)?.template;
  const entry = own ? scopeEntry(own, scope) : undefined;
  const { slot, hidden } = splitDecoration(entry?.decoration);
  const at = slot.elements.findIndex((el) => el.id === elementId);
  if (at < 0) return [...templates];
  const elements = slot.elements.slice();
  elements[at] = edit(elements[at]!);
  return updateTemplate(templates, id, scope, { decoration: joinDecoration({ elements }, hidden) });
}

/** The decoration element `elementId` of template `id`'s scope, when the
 *  scope holds it. */
export function decorationElement(templates: readonly PageTemplate[], id: string, scope: TemplateScope, elementId: string): DesignElement | undefined {
  const own = templateAt(templates, id)?.template;
  const entry = own ? scopeEntry(own, scope) : undefined;
  return splitDecoration(entry?.decoration).slot.elements.find((el) => el.id === elementId);
}
