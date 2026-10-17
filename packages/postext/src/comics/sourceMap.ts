/**
 * The source map of comics (#885, DESIGN §6–§7): what a point of a comic
 * shows and where it is written, read from the stamps of the frames the
 * split generated. Elements, innermost first: a balloon's glyph (`text`),
 * the balloon (`box`), a panel's picture (`resource`), the panel's frame
 * (`frame`), the comic (`template`: the `:::page` or `:::strip` fence).
 * A text panel's paragraphs are blocks of the page and answer as text does,
 * with the frame and the comic after them. Ids are the frames' (`cm<n>`,
 * `cm<n>:<frame>`, `cm<n>:<frame>:b<k>`): the same in every locale and
 * across relayouts.
 *
 * Used by `composed/sourceMap.ts` (`sourceAt`, `elementsForSource`,
 * `findElement`); nothing here lays anything out.
 */
import type { BoundingBox, VDTComicBalloon, VDTComicPage, VDTDesignTextBlock, VDTFrame, VDTPage, VDTPoint } from '../vdt';
import type { SourceElement } from '../composed/sourceMap';
import { pointInPolygon } from './geometry';
import { comicPanelContinues } from './paint';
import { pageComics } from './transform';

type File = { file?: string };

const inBox = (r: BoundingBox, p: VDTPoint): boolean => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** A comic as an element (`template` level): its fence. */
export function comicElement(comic: VDTComicPage, file: File): SourceElement | undefined {
  if (!comic.id) return undefined;
  return { level: 'template', id: comic.id, source: { kind: 'markdown', start: comic.sourceStart, end: comic.sourceEnd, ...file }, rect: { ...comic.frame } };
}

/** A frame the split generated as an element: its panel's source. */
export function comicFrameElement(comic: VDTComicPage, frame: VDTFrame, file: File): SourceElement | undefined {
  if (frame.sourceStart === undefined || frame.sourceEnd === undefined) return undefined;
  const panel = frame.panel !== undefined ? comic.panels[frame.panel] : undefined;
  return {
    level: 'frame',
    id: frame.id,
    source: { kind: 'markdown', start: frame.sourceStart, end: frame.sourceEnd, ...file },
    rect: { ...frame.rect },
    ...(panel && comicPanelContinues(comic, panel) ? { facing: true as const } : {}),
  };
}

/** A balloon as an element: its script line(s). */
export function comicBalloonElement(b: VDTComicBalloon, file: File): SourceElement {
  return { level: 'box', id: b.elementId ?? b.id, source: { kind: 'markdown', start: b.sourceStart, end: b.sourceEnd, ...file }, rect: { ...b.bbox } };
}

/** Whether a point lies in a frame: in its outline when it has one. */
export function pointInComicFrame(frame: Pick<VDTFrame, 'rect' | 'polygon'>, p: VDTPoint): boolean {
  if (!inBox(frame.rect, p)) return false;
  return frame.polygon && frame.polygon.length >= 3 ? pointInPolygon(frame.polygon, p) : true;
}

/** The frames of a comic in hit order: the one painted last first (an
 *  inset over its panel). */
export function comicFramesTopFirst(comic: Pick<VDTComicPage, 'frames'>): VDTFrame[] {
  return (comic.frames ?? [])
    .map((f, i) => ({ f, i }))
    .sort((a, b) => b.f.layer - a.f.layer || b.i - a.i)
    .map(({ f }) => f);
}

/** The frame of the page's comics under a sheet point, with its comic,
 *  the one on top first; undefined off every comic frame. */
export function comicFrameAt(page: VDTPage, x: number, y: number): { comic: VDTComicPage; frame: VDTFrame } | undefined {
  const comics = pageComics(page);
  for (let k = comics.length - 1; k >= 0; k--) {
    const comic = comics[k]!;
    for (const frame of comicFramesTopFirst(comic)) if (pointInComicFrame(frame, { x, y })) return { comic, frame };
  }
  return undefined;
}

/**
 * What the comics of `page` show at sheet point `p`, innermost first, or
 * undefined where they show nothing: a balloon (its glyph first, through
 * `glyph`), else a panel (its picture first) and its frame; then the
 * comic. A text panel's words are not answered here: its blocks are the
 * page's (the caller's flow answers them, then asks {@link comicTextAncestors}).
 */
export function comicChainAt(
  page: VDTPage,
  p: VDTPoint,
  file: File,
  glyph: (b: VDTDesignTextBlock, p: VDTPoint) => { start: number; end: number } | undefined,
  onText: (frame: VDTFrame) => boolean,
): SourceElement[] | undefined {
  const comics = pageComics(page);
  for (let k = comics.length - 1; k >= 0; k--) {
    const comic = comics[k]!;
    const own = comicElement(comic, file);
    const tail = own ? [own] : [];
    // Balloons lie over everything else, the last painted on top.
    for (let i = comic.balloons.length - 1; i >= 0; i--) {
      const b = comic.balloons[i]!;
      if (!inBox(b.bbox, p)) continue;
      const out: SourceElement[] = [];
      const id = b.elementId ?? b.id;
      // A turned or slanted balloon's letters are not where its upright
      // box puts them: the balloon answers whole.
      if (!b.rotate && !b.skew) {
        for (const t of b.text) {
          if (t.artifact || !inBox(t.bbox, p)) continue;
          const src = glyph(t, p);
          if (src) out.push({ level: 'text', id: `${id}@${src.start}`, source: { kind: 'markdown', ...src, ...file } });
          break;
        }
      }
      out.push(comicBalloonElement(b, file));
      const frame = comic.frames?.find((f) => f.panel === b.panelIndex);
      const fe = frame ? comicFrameElement(comic, frame, file) : undefined;
      return [...out, ...(fe ? [fe] : []), ...tail];
    }
    for (const frame of comicFramesTopFirst(comic)) {
      if (!pointInComicFrame(frame, p)) continue;
      // A text panel's words: the caller's.
      if (frame.blockIds.length > 0 && onText(frame)) return undefined;
      const panel = frame.panel !== undefined ? comic.panels[frame.panel] : undefined;
      const out: SourceElement[] = [];
      if (panel?.art) out.push({ level: 'resource', id: `${frame.id}:art`, source: { kind: 'resource', resourceId: panel.art.resourceId }, rect: { ...panel.bbox } });
      const fe = comicFrameElement(comic, frame, file);
      if (fe) out.push(fe);
      return [...out, ...tail];
    }
    if (own && inBox(comic.frame, p)) return tail;
  }
  return undefined;
}

/** The text frame of the page's comic holding block `id`, and the elements
 *  round it (its frame, the comic): what a text panel's words answer after
 *  their own chain. */
export function comicTextAncestors(page: VDTPage, blockId: string, file: File): SourceElement[] {
  const comic = page.comic;
  const frame = comic?.frames?.find((f) => f.blockIds.includes(blockId));
  if (!comic || !frame) return [];
  const fe = comicFrameElement(comic, frame, file);
  const own = comicElement(comic, file);
  return [...(fe ? [fe] : []), ...(own ? [own] : [])];
}

/** The comics, frames and balloons of `page` whose source meets `meets`. */
export function comicElementsForSource(page: VDTPage, meets: (r: { start: number; end: number }) => boolean, file: File): SourceElement[] {
  const out: SourceElement[] = [];
  for (const comic of pageComics(page)) {
    if (!comic.id) continue;
    if (meets({ start: comic.sourceStart, end: comic.sourceEnd })) out.push(comicElement(comic, file)!);
    for (const frame of comic.frames ?? []) {
      if (frame.sourceStart === undefined || frame.sourceEnd === undefined || !meets({ start: frame.sourceStart, end: frame.sourceEnd })) continue;
      const fe = comicFrameElement(comic, frame, file);
      if (fe) out.push(fe);
    }
    for (const b of comic.balloons) if (b.elementId && meets({ start: b.sourceStart, end: b.sourceEnd })) out.push(comicBalloonElement(b, file));
  }
  return out;
}

/** The comic, frame or balloon of `page` with stable id `id`. */
export function findComicElement(page: VDTPage, id: string, file: File): SourceElement | undefined {
  if (!id.startsWith('cm')) return undefined;
  for (const comic of pageComics(page)) {
    if (comic.id === id) return comicElement(comic, file);
    for (const frame of comic.frames ?? []) {
      if (frame.id !== id) continue;
      const panel = frame.panel !== undefined ? comic.panels[frame.panel] : undefined;
      // The half of a panel across a spread's spine read on this page.
      if (panel && comicPanelContinues(comic, panel)) continue;
      return comicFrameElement(comic, frame, file);
    }
    const b = comic.balloons.find((x) => x.elementId === id);
    if (b) return comicBalloonElement(b, file);
  }
  return undefined;
}
