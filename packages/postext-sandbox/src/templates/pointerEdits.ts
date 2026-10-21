import type { ConnectorEnd, DesignConnectorElement, DesignElement, PageTemplate } from 'postext';
import { inheritedDecoration, isRemoval, joinDecoration, splitDecoration, templateAt, uniqueName } from './templateEdits.js';

// ---------------------------------------------------------------------------
// Pointers (#1064): a line from a frame of a composed page (a note) to an
// anchor of the picture another frame holds (a map), as C6 draws it
// (DESIGN §12.4, §12.23): a connector of the template's decoration whose
// one end is `{ to: '#note' }` and the other `{ to: '#map', anchor: 'id' }`.
// The canvas (a drag from the selected frame to a point of the picture), the
// frame's properties (a list) and the sandbox_edit_labels tool write them
// here, one change of the template each. Pure.
// ---------------------------------------------------------------------------

type Templates = readonly PageTemplate[];

/** A connector that points from a frame at one anchor of a picture. */
export interface FramePointer {
  id: string;
  /** The frame the line leaves. */
  from: string;
  /** The frame that holds the picture, and the anchor of the picture. */
  toFrame: string;
  anchor: string;
  /** Written by a template this one extends (an edit writes the change on
   *  this template, under the same id). */
  inherited: boolean;
  element: DesignConnectorElement;
}

const frameOf = (end: ConnectorEnd | undefined): string | undefined => (end && typeof end.to === 'string' && end.to.startsWith('#') ? end.to.slice(1) : undefined);

/** The pointers of template `templateId` (its own and those it inherits),
 *  those leaving frame `from` when given. A connector is a pointer when it
 *  has one `to` end and that end names an anchor. */
export function pointersOf(templates: Templates, templateId: string, from?: string): FramePointer[] {
  const t = templateAt(templates, templateId)?.template;
  if (!t) return [];
  const own = splitDecoration(t.decoration).slot.elements;
  const ownIds = new Set(own.map((e) => e.id));
  const inherited = inheritedDecoration(templates, templateId, 'base').elements.filter((e) => !ownIds.has(e.id));
  const out: FramePointer[] = [];
  const take = (el: DesignElement, isInherited: boolean) => {
    if (el.kind !== 'connector' || Array.isArray(el.to)) return;
    const a = frameOf(el.from);
    const b = frameOf(el.to);
    const anchor = el.to.anchor;
    if (!a || !b || typeof anchor !== 'string' || !anchor) return;
    if (from !== undefined && a !== from) return;
    out.push({ id: el.id, from: a, toFrame: b, anchor, inherited: isInherited, element: el });
  };
  for (const el of inherited) take(el, true);
  for (const el of own) take(el, false);
  return out;
}

/** What a new pointer looks like: one straight line ending in a dot on the
 *  picture's point, as a map's notes point. */
const NEW_POINTER_LOOK: Pick<DesignConnectorElement, 'routing' | 'endCap'> = { routing: 'straight', endCap: 'dot' };

/** The template with its own decoration's elements changed by `edit`. */
function withOwnElements(templates: Templates, templateId: string, edit: (elements: DesignElement[]) => DesignElement[]): PageTemplate[] {
  return templates.map((t) => {
    if (t.id !== templateId) return t;
    const { slot, hidden } = splitDecoration(t.decoration);
    const decoration = joinDecoration({ elements: edit([...slot.elements]) }, hidden);
    const out: PageTemplate = { ...t };
    if (decoration) out.decoration = decoration;
    else delete out.decoration;
    return out;
  });
}

export interface PointerSpec {
  from: string;
  toFrame: string;
  anchor: string;
  /** The pointer to change; unset: a new one, unless one from `from` to
   *  this anchor of `toFrame` is there already. */
  id?: string;
}

/**
 * The templates with a pointer from frame `from` to anchor `anchor` of the
 * picture in `toFrame`: the pointer `id` gets its target changed (its look
 * kept), else the one already joining the two is kept, else a new connector
 * is added to the template's decoration. A connector with an anchor end is
 * painted over the frames (`connectorPaintsOver`, #1076), so the picture's
 * frame keeps its layer. Null when the template or
 * the frames are not there, or a frame points at itself.
 */
export function setPointer(templates: Templates, templateId: string, spec: PointerSpec): { templates: PageTemplate[]; id: string; created: boolean } | null {
  const t = templateAt(templates, templateId)?.template;
  if (!t || !spec.from || !spec.toFrame || !spec.anchor.trim() || spec.from === spec.toFrame) return null;
  const anchor = spec.anchor.trim();
  const all = pointersOf(templates, templateId);
  let next: PageTemplate[];
  let id: string;
  let created = false;
  const existing = spec.id !== undefined ? all.find((p) => p.id === spec.id) : all.find((p) => p.from === spec.from && p.toFrame === spec.toFrame && p.anchor === anchor);
  if (spec.id !== undefined && !existing) return null;
  if (existing) {
    id = existing.id;
    const el = existing.element;
    const to: ConnectorEnd = { ...(Array.isArray(el.to) ? el.to[0]! : el.to), to: `#${spec.toFrame}`, anchor };
    const changed: DesignConnectorElement = { ...el, from: { ...el.from, to: `#${spec.from}` }, to };
    next = withOwnElements(templates, templateId, (els) => {
      const i = els.findIndex((e) => e.id === id);
      if (i >= 0) els[i] = changed;
      else els.push(changed);
      return els;
    });
  } else {
    const taken = [...splitDecoration(t.decoration).slot.elements.map((e) => e.id), ...inheritedDecoration(templates, templateId, 'base').elements.map((e) => e.id)];
    id = uniqueName(taken, `pointer-${spec.from}-${anchor}`.replace(/[^\p{L}\p{N}_-]+/gu, '-'));
    created = true;
    const el: DesignConnectorElement = { kind: 'connector', id, from: { to: `#${spec.from}` }, to: { to: `#${spec.toFrame}`, anchor }, ...NEW_POINTER_LOOK };
    next = withOwnElements(templates, templateId, (els) => [...els, el]);
  }
  return { templates: next, id, created };
}

/** The templates without pointer `id` (one inherited is hidden on this
 *  template instead, as an inherited decoration element is). Null when
 *  there is no such pointer. */
export function removePointer(templates: Templates, templateId: string, id: string): PageTemplate[] | null {
  const p = pointersOf(templates, templateId).find((x) => x.id === id);
  if (!p) return null;
  if (p.inherited) {
    return templates.map((t) => {
      if (t.id !== templateId) return t;
      const { slot, hidden } = splitDecoration(t.decoration);
      const decoration = joinDecoration(slot, hidden.includes(id) ? hidden : [...hidden, id]);
      return decoration ? { ...t, decoration } : t;
    });
  }
  return withOwnElements(templates, templateId, (els) => els.filter((e) => isRemoval(e) || e.id !== id));
}
