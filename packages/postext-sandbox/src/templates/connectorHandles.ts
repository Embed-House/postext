/**
 * Where a connector's ends are on a composed page (#1063): the handles the
 * canvas draws while a connector is edited. The same rules as the engine's
 * connector layout (`design/connector.ts`): an end on a side of its box (by
 * default the side facing the other end; a tree's parent faces the union of
 * its children, each child the parent), at a point along it, `gap` out.
 *
 * Pure. Boxes are the page's frames as laid, in the flow frame (where the
 * template editor draws), so `start` is the left there: a right-to-left
 * page's flow is the sheet mirrored.
 */

import { facingSide, type ConnectorEnd, type ConnectorRect, type DesignConnectorElement } from 'postext';
import { connectorToEnds } from './connectorEdits.js';

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface ConnectorHandle {
  /** `'from'`, or the index of the `to` end it was written as. */
  end: 'from' | number;
  /** The box's name on the page (`card[2]` for an instance). */
  name: string;
  x: number;
  y: number;
  side: Side;
}

export interface ConnectorHandleBoxes {
  /** The page's frames by name (instances as `card[n]`). */
  frames: ReadonlyMap<string, ConnectorRect>;
  /** The template's groups and the frames each holds. */
  groups?: readonly { name: string; frames: readonly string[] }[];
  /** The point of anchor `anchor` of the picture frame `frame` holds (#1064,
   *  `ConnectorEnd.anchor`), in the same frame as the boxes; an end that
   *  names an anchor is drawn there, as the engine ends the line there. */
  anchorPoint?: (frame: string, anchor: string) => { x: number; y: number } | undefined;
}

function union(rects: readonly ConnectorRect[]): ConnectorRect | undefined {
  if (rects.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The boxes an end's `to` names on the page: a frame, an instance, every
 *  instance (`[*]`), a repeated frame (its grid) or a group (its frames). */
export function endBoxes(ref: string, boxes: ConnectorHandleBoxes): { name: string; box: ConnectorRect }[] {
  if (!ref.startsWith('#')) return [];
  const name = ref.slice(1);
  if (name.endsWith('[*]')) {
    const base = `${name.slice(0, -3)}[`;
    return [...boxes.frames].filter(([n]) => n.startsWith(base) && n.endsWith(']')).map(([n, box]) => ({ name: n, box }));
  }
  const own = boxes.frames.get(name);
  if (own) return [{ name, box: own }];
  // A frame and its instances (`card`, `card[1]`, `card[2]`…).
  const framesOf = (frame: string): ConnectorRect[] =>
    [...boxes.frames].filter(([n]) => n === frame || (n.startsWith(`${frame}[`) && n.endsWith(']'))).map(([, r]) => r);
  // A group reads the union of its frames; a repeated frame named alone,
  // the union of its instances (its grid).
  const group = boxes.groups?.find((g) => g.name === name);
  const box = union(group ? group.frames.flatMap(framesOf) : framesOf(name));
  return box ? [{ name, box }] : [];
}

function physical(side: unknown): Side | undefined {
  if (side === 'top' || side === 'bottom' || side === 'left' || side === 'right') return side;
  if (side === 'start') return 'left';
  if (side === 'end') return 'right';
  return undefined;
}

function fraction(at: unknown): number {
  if (at === 'start') return 0;
  if (at === 'end') return 1;
  if (typeof at === 'number' && Number.isFinite(at)) return Math.max(0, Math.min(1, at));
  return 0.5;
}

function sidePoint(box: ConnectorRect, side: Side, end: ConnectorEnd, gapPx: number): { x: number; y: number } {
  const f = fraction(end.at);
  switch (side) {
    case 'top':
      return { x: box.x + f * box.width, y: box.y - gapPx };
    case 'bottom':
      return { x: box.x + f * box.width, y: box.y + box.height + gapPx };
    case 'left':
      return { x: box.x - gapPx, y: box.y + f * box.height };
    default:
      return { x: box.x + box.width + gapPx, y: box.y + f * box.height };
  }
}

/** The handles of `el`'s ends on a page: one at its start (the first that
 *  faces its ends), one at each end it goes to. `gapPx` turns an end's
 *  `gap` into page px (0 when unset). Ends on nothing of the page have
 *  none. */
export function connectorHandles(el: Pick<DesignConnectorElement, 'from' | 'to' | 'routing'>, boxes: ConnectorHandleBoxes, gapPx: (end: ConnectorEnd) => number = () => 0): ConnectorHandle[] {
  const fromBox = el.from ? endBoxes(el.from.to, boxes)[0] : undefined;
  const tos = connectorToEnds(el).flatMap((end, index) => endBoxes(end.to, boxes).map((b) => ({ ...b, end, index })));
  const out: ConnectorHandle[] = [];
  const kidsUnion = union(tos.map((t) => t.box));
  if (fromBox) {
    const facing = el.routing === 'tree' ? kidsUnion : tos[0]?.box;
    const side = physical(el.from.side) ?? (facing ? facingSide(fromBox.box, facing) : 'bottom');
    out.push({ end: 'from', name: fromBox.name, side, ...sidePoint(fromBox.box, side, el.from, gapPx(el.from)) });
  }
  for (const t of tos) {
    const side = physical(t.end.side) ?? (fromBox ? facingSide(t.box, fromBox.box) : 'top');
    const at = t.end.anchor ? boxes.anchorPoint?.(t.name, t.end.anchor) : undefined;
    out.push({ end: t.index, name: t.name, side, ...(at ?? sidePoint(t.box, side, t.end, gapPx(t.end))) });
  }
  return out;
}
