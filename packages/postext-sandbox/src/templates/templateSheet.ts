/**
 * A page template drawn on its own (#863): the sheet in millimetres with
 * its margins, the template's area, the grid, the gutter of a spread and
 * every frame where the engine's geometry places it before content is
 * poured. The Design panel draws the thumbnails and the larger sheet of
 * the template being edited from it.
 *
 * A spread is one sheet two pages wide: its area runs from the outer
 * margin of the left page to the outer margin of the right one, and the
 * gutter (`gutter`, the spine band) is marked at its middle.
 */

import { resolvePageConfig, templateFrameRects, type Dimension, type FrameGeometryContext, type PostextConfig, type ResolvedFrame, type ResolvedFrameGroup, type ResolvedPageTemplate } from 'postext';
import { dimensionToMm, gridGeometry, type GridGeometry, type Rect } from './frameGeometry.js';
import { nextFrameName } from './frameChain.js';

export interface SheetFrame {
  name: string;
  rect: Rect;
  rotate: number;
  layer: number;
  style?: string;
  flow: boolean;
  /** A frame of a repeating grid's set (#1082): which of the drawn
   *  instances (1, 2…) this copy is. `name` stays the template frame's. */
  instance?: number;
}

export interface TemplateSheet {
  /** Sheet size, mm. */
  width: number;
  height: number;
  /** The page boxes on the sheet (one, or two for a spread). */
  pages: Rect[];
  /** Each page's content area (the margins). */
  content: Rect[];
  /** The template's area. */
  area: Rect;
  grid?: GridGeometry;
  /** The spine band of a spread. */
  gutter?: Rect;
  frames: SheetFrame[];
  /** Chains (`next`, `continueIn: '#…'`): from frame to frame. */
  chains: { from: string; to: string }[];
}

/** `template` (resolved for `side`) on a sheet of the book's page size;
 *  `heights` gives an `'auto'` frame its laid-out height when known (mm). */
export function templateSheet(config: PostextConfig, template: ResolvedPageTemplate, side: 'recto' | 'verso' = 'recto', heights?: ReadonlyMap<string, number>): TemplateSheet {
  const page = resolvePageConfig(config.page);
  const w = dimensionToMm(page.width);
  const h = dimensionToMm(page.height);
  const m = page.margins as unknown as Record<string, { value: number; unit: string } | boolean | undefined>;
  const dim = (k: string) => (typeof m[k] === 'object' ? dimensionToMm(m[k] as never) : 0);
  const mirror = m.mirror === true;
  const top = dim('top');
  const bottom = dim('bottom');
  const left = dim('left');
  const right = dim('right');
  const contentOf = (x0: number, s: 'recto' | 'verso'): Rect => {
    const l = mirror && s === 'verso' ? right : left;
    const r = mirror && s === 'verso' ? left : right;
    return { x: x0 + l, y: top, width: w - l - r, height: h - top - bottom };
  };
  const spread = template.spread;
  const pages: Rect[] = spread ? [{ x: 0, y: 0, width: w, height: h }, { x: w, y: 0, width: w, height: h }] : [{ x: 0, y: 0, width: w, height: h }];
  const content = spread ? [contentOf(0, 'verso'), contentOf(w, 'recto')] : [contentOf(0, side)];
  const sheet: Rect = { x: 0, y: 0, width: spread ? 2 * w : w, height: h };
  const contentArea: Rect = spread
    ? { x: content[0]!.x, y: top, width: content[1]!.x + content[1]!.width - content[0]!.x, height: h - top - bottom }
    : content[0]!;
  const area = template.area === 'trim' || template.area === 'bleed' ? sheet : contentArea;
  const gutterMm = dimensionToMm(template.gutter);
  const gutter = spread ? { x: w - gutterMm / 2, y: 0, width: gutterMm, height: h } : undefined;
  const ctx: FrameGeometryContext = { areas: { area, page: sheet, bleed: sheet }, dpi: 25.4, emPx: 4.2333 };
  const natural = (frame: ResolvedFrame) => heights?.get(frame.name) ?? area.height / 5;
  const rects = templateFrameRects(template, ctx, natural);
  // A repeating grid's set is drawn in the grid's cells (#1082), not where
  // the template draws its frames (the main frame at the area's top-left).
  const repeated = new Map<string, { instance: number; rect: Rect }[]>();
  for (const group of template.groups) {
    if (group.kind !== 'grid' || !group.repeat || group.repeat.frames.length === 0) continue;
    for (const [name, copies] of sketchGrid(template, group, ctx, rects, natural)) repeated.set(name, copies);
  }
  const frames: SheetFrame[] = template.frames.flatMap((f) => {
    const base = { name: f.name, rotate: f.rotate, layer: f.layer, ...(f.style ? { style: f.style } : {}), flow: f.flow };
    const copies = repeated.get(f.name);
    if (copies) return copies.map((c) => ({ ...base, rect: c.rect, instance: c.instance }));
    const rect = rects.get(f.name);
    return rect ? [{ ...base, rect }] : [];
  });
  const names = new Set(frames.map((f) => f.name));
  const chains = template.frames.flatMap((f) => {
    const to = nextFrameName(f);
    return to && names.has(to) && names.has(f.name) ? [{ from: f.name, to }] : [];
  });
  return {
    width: sheet.width,
    height: h,
    pages,
    content,
    area,
    ...(template.grid ? { grid: gridGeometry(template.grid, area, 25.4) } : {}),
    ...(gutter ? { gutter } : {}),
    frames,
    chains,
  };
}

const mmDim = (value: number): Dimension => ({ value, unit: 'mm' });

/** The frame a placement hangs from (`'#name'`), if any. */
function anchorFrame(f: ResolvedFrame): string | undefined {
  if (f.grid || !f.placement) return undefined;
  const to = f.placement.anchor.to;
  return to.startsWith('#') ? to.slice(1) : undefined;
}

/** How many items a grid is drawn with: a row of them (two at least, to
 *  show that it repeats), never more than it holds. */
export function sketchItems(group: Pick<ResolvedFrameGroup, 'columns' | 'repeat'>): number {
  return Math.max(1, Math.min(group.repeat?.max ?? Infinity, Math.max(2, group.columns ?? 1)));
}

/**
 * A repeating grid (#1061) drawn as the engine lays it (#1082): its box
 * (its own placement, else from where the template draws its main frame to
 * the area's right edge and foot), equal columns, a few items in cells
 * filling rows from the start, the main frame the cell's width and its own
 * height rule, the set's other frames placed from it as the template draws
 * them (the cell's column their area; one anchored to nothing moves with
 * the cell), rows as tall as the most a cell reaches above and below its
 * main frame, `rowAlign` placing shorter cells. A frame of the set anchored
 * outside it stays where the template draws it. Mirrors `placeGrid` of the
 * engine's composed layout, on the template alone (`'auto'` heights as
 * `natural` says).
 */
function sketchGrid(
  template: ResolvedPageTemplate,
  group: ResolvedFrameGroup,
  ctx: FrameGeometryContext,
  drawn: ReadonlyMap<string, Rect>,
  natural: (frame: ResolvedFrame) => number,
): Map<string, { instance: number; rect: Rect }[]> {
  const out = new Map<string, { instance: number; rect: Rect }[]>();
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  const set = group.repeat!.frames.filter((n) => byName.has(n));
  const main = byName.get(set[0] ?? '');
  if (!main) return out;
  const inSet = new Set(set);
  const area = ctx.areas.area;
  // The grid's own box: a frame placed as the group is.
  let box: Rect;
  if (group.placement || group.grid) {
    const size = group.placement?.size;
    const norm = (v: unknown) => (v === 'auto' || v === 'fill' || (typeof v === 'object' && v !== null) ? (v as ResolvedFrame['width']) : 'fill');
    const probe: ResolvedFrame = {
      ...main,
      name: '\u0000grid',
      ...(group.placement ? { placement: group.placement } : { placement: undefined }),
      ...(group.grid ? { grid: group.grid } : { grid: undefined }),
      width: norm(size?.width),
      height: size?.height === undefined || size.height === 'auto' ? 'fill' : norm(size.height),
      minWidth: undefined,
      maxWidth: undefined,
      minHeight: undefined,
      maxHeight: undefined,
      fieldPaths: { ...main.fieldPaths, ...(size?.height !== undefined ? { height: '/' } : {}) },
    };
    box = templateFrameRects({ ...template, frames: [...template.frames, probe] }, ctx, natural).get(probe.name)!;
  } else {
    const at = drawn.get(main.name) ?? area;
    box = { x: at.x, y: at.y, width: Math.max(0, area.x + area.width - at.x), height: Math.max(0, area.y + area.height - at.y) };
  }
  const foot = box.y + box.height;
  const columns = Math.max(1, group.columns ?? 1);
  const colGap = dimensionToMm(group.columnGap ?? group.gap);
  const rowGap = dimensionToMm(group.rowGap ?? group.gap);
  const colW = Math.max(1, (box.width - colGap * (columns - 1)) / columns);
  const xOf = (c: number) => box.x + c * (colW + colGap);
  const mainHeight = (): number => {
    const h = main.height;
    const v = h === 'auto' || h === 'fill' ? natural(main) : 'percent' in h ? (area.height * h.percent) / 100 : dimensionToMm(h);
    const min = main.minHeight ? dimensionToMm(main.minHeight) : 0;
    const max = main.maxHeight ? dimensionToMm(main.maxHeight) : Infinity;
    return Math.max(min, Math.min(v, max));
  };
  const mainDrawn = drawn.get(main.name) ?? box;
  /** The set's boxes with its main frame at `(x, y)`, `h` tall, and those
   *  that count for the cell. */
  const layCell = (x: number, y: number, h: number): { boxes: Map<string, Rect>; inCell: string[] } => {
    const placed: ResolvedFrame = {
      ...main,
      placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mmDim(x), y: mmDim(y) } },
      grid: undefined,
      width: mmDim(colW),
      height: mmDim(h),
      minWidth: undefined,
      maxWidth: undefined,
      minHeight: undefined,
      maxHeight: undefined,
    };
    const cellTemplate = { ...template, frames: template.frames.map((f) => (f.name === main.name ? placed : f)) };
    // A frame anchored in the set takes the cell's column as its area.
    const column: FrameGeometryContext = { ...ctx, areas: { ...ctx.areas, area: { x, y: area.y, width: colW, height: area.height } } };
    const inColumn = templateFrameRects(cellTemplate, column, natural);
    const boxes = new Map<string, Rect>([[main.name, { x, y, width: colW, height: h }]]);
    const inCell = [main.name];
    for (const name of set.slice(1)) {
      const f = byName.get(name)!;
      const target = anchorFrame(f);
      if (target !== undefined && !inSet.has(target)) continue;
      const r = target !== undefined ? inColumn.get(name) : drawn.get(name);
      if (!r) continue;
      boxes.set(name, target !== undefined ? r : { ...r, x: r.x + x - mainDrawn.x, y: r.y + y - mainDrawn.y });
      inCell.push(name);
    }
    return { boxes, inCell };
  };
  const items = sketchItems(group);
  const stretchable = main.height === 'auto' || main.height === 'fill';
  let cursor = box.y;
  for (let r = 0; r * columns < items && cursor < foot; r++) {
    const count = Math.min(columns, items - r * columns);
    const measured = Array.from({ length: count }, (_, c) => {
      const h = mainHeight();
      const { boxes, inCell } = layCell(xOf(c), 0, h);
      const ys = inCell.map((n) => boxes.get(n)!);
      const top = Math.min(...ys.map((b) => b.y));
      const bottom = Math.max(...ys.map((b) => b.y + b.height));
      return { h, above: Math.max(0, -top), below: bottom };
    });
    const above = Math.max(0, ...measured.map((m) => m.above));
    const below = Math.max(0, ...measured.map((m) => m.below));
    measured.forEach((m, c) => {
      const spare = below - m.below;
      let dy = 0;
      let h = m.h;
      if (spare > 0.01) {
        const align = group.rowAlign ?? 'stretch';
        if (align === 'end') dy = spare;
        else if (align === 'center') dy = spare / 2;
        else if (align === 'stretch' && stretchable) h = Math.min(m.h + spare, main.maxHeight ? dimensionToMm(main.maxHeight) : Infinity);
      }
      const instance = r * columns + c + 1;
      for (const [name, b] of layCell(xOf(c), cursor + above + dy, h).boxes) {
        // Past the grid's foot a cell is cut there, as on the page.
        const y = Math.min(b.y, foot);
        const rect = { ...b, y, height: Math.max(0, Math.min(b.y + b.height, foot) - y) };
        out.set(name, [...(out.get(name) ?? []), { instance, rect }]);
      }
    });
    cursor += above + below + rowGap;
  }
  return out;
}
