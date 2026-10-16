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

import { resolvePageConfig, templateFrameRects, type PostextConfig, type ResolvedPageTemplate } from 'postext';
import { dimensionToMm, gridGeometry, type GridGeometry, type Rect } from './frameGeometry';
import { nextFrameName } from './frameChain';

export interface SheetFrame {
  name: string;
  rect: Rect;
  rotate: number;
  layer: number;
  style?: string;
  flow: boolean;
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
  const rects = templateFrameRects(
    template,
    { areas: { area, page: sheet, bleed: sheet }, dpi: 25.4, emPx: 4.2333 },
    (frame) => heights?.get(frame.name) ?? area.height / 5,
  );
  const frames: SheetFrame[] = template.frames.flatMap((f) => {
    const rect = rects.get(f.name);
    return rect ? [{ name: f.name, rect, rotate: f.rotate, layer: f.layer, ...(f.style ? { style: f.style } : {}), flow: f.flow }] : [];
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
