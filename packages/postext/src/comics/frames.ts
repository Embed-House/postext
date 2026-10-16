/**
 * One page model (#885, DESIGN §7): a comic page's `split` is a shorthand
 * that generates frames. Each cell of the split tree (after its panel's
 * `pad`) is a frame, and so is each `inset` panel (laid over the frame
 * before it, one layer up); the frame holds the panel (its art, border and
 * background) and, for a text panel (`::panel{text}`), the Markdown its
 * body pours into it. The lettering stays positioned by the comics code,
 * panel by panel, as before.
 *
 * The frames are those of a composed page (`VDTFrame`) with what a cut of
 * the split needs besides: a `polygon` when a slanted line cuts the cell,
 * and `panel`, the index of the panel the frame holds. Ids follow the
 * composed pages' rule (#857): built from the comic fence's ordinal in its
 * chapter and the names the Markdown gives (`cm<n>:<name>`, a panel's
 * `id`, else `p<k>`), never from the layout, so they are the same in every
 * locale and across relayouts.
 */

import type { BoundingBox, ResolvedConfig, VDTComicPage, VDTComicPanel, VDTFrame, VDTPoint } from '../vdt';
import type { ResolvedCalloutStyleConfig } from '../types';
import { clipPolygon, polygonBBox, type ComicCell } from './geometry';
import type { ComicPanelSource } from './types';

/** A comic (page, spread or strip): `cm<n>`, `n` the ordinal of its fence
 *  among the comic fences of its chapter. */
export function comicElementId(fenceIndex: number): string {
  return `cm${fenceIndex}`;
}

/** A frame of a comic: `cm<n>:<name>`. */
export function comicFrameElementId(fenceIndex: number, name: string): string {
  return `cm${fenceIndex}:${name}`;
}

/** A balloon, caption or sound effect of a panel: `<frame id>:b<order>`,
 *  `order` its line's place in the panel's script. */
export function comicBalloonElementId(frameId: string, order: number): string {
  return `${frameId}:b${order}`;
}

/** The name of the frame of the panel laid `index`-th (0-based): the
 *  panel's `id` when it has one no frame before took, else `p<index + 1>`. */
export function comicFrameName(panel: Pick<ComicPanelSource, 'attrs'> | undefined, index: number, taken: ReadonlySet<string>): string {
  const own = panel?.attrs.id?.trim();
  if (own && !taken.has(own) && !/[\s:]/.test(own)) return own;
  return `p${index + 1}`;
}

/** Whether a panel's body is Markdown text (`::panel{text}`) rather than a
 *  lettering script. */
export function isComicTextPanel(panel: Pick<ComicPanelSource, 'attrs'> | undefined): boolean {
  const v = panel?.attrs.text;
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  return !(t === 'false' || t === 'no' || t === '0' || t === 'none');
}

/** The callout style a panel's `box` names (#885), or undefined (unset,
 *  or no such style: `comicPanelFrame`, reason `unknownBox`). */
export function comicBoxStyle(resolved: Pick<ResolvedConfig, 'calloutStyles'>, value: string | undefined): ResolvedCalloutStyleConfig | undefined {
  const id = value?.trim();
  if (!id) return undefined;
  return resolved.calloutStyles.find((s) => s.id === id);
}

/** A frame the split generates, before its panel is built: where it is
 *  and which panel it holds. */
export interface ComicFrameSpec {
  name: string;
  /** The frame's outline (the cell, its panel's `pad` taken off),
   *  clockwise, and its box. */
  polygon: VDTPoint[];
  bbox: BoundingBox;
  /** An axis-aligned rectangle (round corners allowed). */
  rect: boolean;
  /** The panel the frame holds; undefined for a cell no panel fills. */
  panel?: ComicPanelSource;
  /** An `inset` panel's frame, laid over the frame before it. */
  inset: boolean;
  /** Paint order among the frames: 1 for a cell, 2 for an inset. */
  layer: number;
}

/** Insets of a panel (`pad`), px, or undefined. */
export type ComicPadding = { top: number; right: number; bottom: number; left: number } | undefined;

/** A cell inset by its panel's `pad`. */
export function padComicCell(cell: Pick<ComicCell, 'polygon' | 'bbox' | 'rect'>, pad: ComicPadding): Pick<ComicCell, 'polygon' | 'bbox' | 'rect'> {
  if (!pad || (pad.top === 0 && pad.right === 0 && pad.bottom === 0 && pad.left === 0)) return cell;
  const b = cell.bbox;
  const x0 = b.x + pad.left;
  const x1 = Math.max(x0, b.x + b.width - pad.right);
  const y0 = b.y + pad.top;
  const y1 = Math.max(y0, b.y + b.height - pad.bottom);
  let poly = cell.polygon;
  poly = clipPolygon(poly, { nx: -1, ny: 0, c: -x0 });
  poly = clipPolygon(poly, { nx: 1, ny: 0, c: x1 });
  poly = clipPolygon(poly, { nx: 0, ny: -1, c: -y0 });
  poly = clipPolygon(poly, { nx: 0, ny: 1, c: y1 });
  return { polygon: poly, bbox: polygonBBox(poly), rect: cell.rect };
}

/** `inset="x y w h"`: percentages (or fractions) of the previous panel's
 *  box. */
export function comicInsetBox(value: string | undefined, of: BoundingBox): BoundingBox | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/[\s,]+/).map((p) => Number(p.replace('%', '')));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const fractions = !value.includes('%') && parts.every((n) => n <= 1);
  const [x, y, w, h] = parts.map((n) => (fractions ? n : n / 100)) as [number, number, number, number];
  if (w <= 0 || h <= 0) return undefined;
  return { x: of.x + x * of.width, y: of.y + y * of.height, width: w * of.width, height: h * of.height };
}

/**
 * The frames a split generates, in panel order: the cells of the split tree
 * in reading order, each taking the next panel that is not an inset (or
 * none), and every inset panel laid over the frame laid before it (the
 * insets that come before a panel in the source follow the frame before
 * that panel). `padOf` gives a panel's `pad` for the box it pads.
 */
export function comicFrameSpecs(
  panels: readonly ComicPanelSource[],
  cells: readonly Pick<ComicCell, 'polygon' | 'bbox' | 'rect'>[],
  padOf: (panel: ComicPanelSource | undefined, box: BoundingBox) => ComicPadding,
): ComicFrameSpec[] {
  const flowPanels = panels.filter((p) => !p.attrs.inset);
  const out: ComicFrameSpec[] = [];
  const taken = new Set<string>();
  const add = (cell: Pick<ComicCell, 'polygon' | 'bbox' | 'rect'>, panel: ComicPanelSource | undefined, inset: boolean): void => {
    const padded = padComicCell(cell, padOf(panel, cell.bbox));
    const name = comicFrameName(panel, out.length, taken);
    taken.add(name);
    out.push({ name, polygon: padded.polygon, bbox: padded.bbox, rect: padded.rect, ...(panel ? { panel } : {}), inset, layer: inset ? 2 : 1 });
  };
  const layInset = (p: ComicPanelSource): void => {
    const prev = out[out.length - 1];
    const box = prev ? comicInsetBox(p.attrs.inset, prev.bbox) : undefined;
    if (!box) return;
    const polygon = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    add({ polygon, bbox: polygonBBox(polygon), rect: true }, p, true);
  };
  let flowIndex = 0;
  const pending = [...panels];
  for (const cell of cells) {
    while (pending.length > 0 && pending[0]!.attrs.inset) layInset(pending.shift()!);
    const p = flowPanels[flowIndex];
    if (p && pending[0] === p) pending.shift();
    flowIndex++;
    add(cell, p, false);
  }
  while (pending.length > 0 && pending[0]!.attrs.inset) layInset(pending.shift()!);
  return out;
}

/** The frame of a laid-out panel: its box and outline, its id and source. */
export function comicPanelFrame(panel: VDTComicPanel, name: string, layer: number): VDTFrame {
  return {
    id: panel.frameId ?? name,
    name,
    rect: { ...panel.bbox },
    rotate: 0,
    layer,
    scale: 1,
    overflowPx: 0,
    blockIds: [],
    configPath: '',
    sourceStart: panel.sourceStart,
    sourceEnd: panel.sourceEnd,
    ...(isAxisRect(panel.polygon, panel.bbox) ? {} : { polygon: panel.polygon.map((p) => ({ ...p })) }),
    panel: panel.index,
  };
}

/** Whether a polygon is its own bounding box. */
function isAxisRect(poly: readonly VDTPoint[], box: BoundingBox): boolean {
  if (poly.length !== 4) return false;
  const eps = 0.01;
  const onX = (x: number) => Math.abs(x - box.x) < eps || Math.abs(x - box.x - box.width) < eps;
  const onY = (y: number) => Math.abs(y - box.y) < eps || Math.abs(y - box.y - box.height) < eps;
  return poly.every((p) => onX(p.x) && onY(p.y));
}

/** The frames of a comic whose panels were moved or cut (a spread's half,
 *  #567): each frame of `whole` whose panel `panels` still holds, on that
 *  panel's box and outline; a text frame keeps its blocks. */
export function comicFramesFor(whole: Pick<VDTComicPage, 'frames'>, panels: readonly VDTComicPanel[]): VDTFrame[] | undefined {
  if (!whole.frames) return undefined;
  const byPanel = new Map(whole.frames.map((f) => [f.panel, f] as const));
  const out: VDTFrame[] = [];
  for (const p of panels) {
    const f = byPanel.get(p.index);
    if (!f) continue;
    const g = comicPanelFrame(p, f.name, f.layer);
    const cut: VDTFrame = { ...f, rect: g.rect };
    if (g.polygon) cut.polygon = g.polygon;
    else delete cut.polygon;
    out.push(cut);
  }
  return out;
}
