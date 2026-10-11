// The comics of a laid-out chapter, as the comic tools of the previews find
// them on its pages (`pageComics`), numbered and put into words: where each
// panel, split line and balloon lies, and what its script line writes.
//
// Numbers the source writes are given in the source's units: a split line
// in percent of the cell it cuts, a pin or a tail target in percent of the
// panel's picture. Everything else is a place on the page, in fractions of
// the page from its top left corner — the space of sandbox_render_page's
// crop.

import {
  pageComics,
  type BoundingBox,
  type ComicPageSource,
  type ComicPanelSource,
  type ComicScriptItem,
  type VDTComicBalloon,
  type VDTComicPage,
  type VDTComicPanel,
  type VDTComicSplitter,
  type VDTDocument,
  type VDTPage,
  type VDTPoint,
} from 'postext';
import { balloonGroup, balloonPanel, boxCentre, pageToPin } from '../viewport/comics/balloonDrag';
import { splitterEndRanges } from '../viewport/comics/comicDrag';
import { tailHandlePointOf } from '../viewport/comics/comicEdits';
import { canMergeNext, canSplitPanel, comicPageSourceAt, comicPanelSlots, comicSplitValue } from '../viewport/comics/comicSource';

/** A comic on one page: a comic page, a strip, or one half of a spread. */
export interface ComicPart {
  pageIndex: number;
  page: VDTPage;
  comic: VDTComicPage;
}

/** One comic of a chapter (a `:::page` or a `:::strip` fence). */
export interface ChapterComic {
  /** Its place among the chapter's comics, in the order of the source
   *  (from 1). */
  number: number;
  /** The page it is on; both pages, for a spread. */
  parts: ComicPart[];
  /** The comic whole: every panel, split line and balloon in reading
   *  order. The page's own comic, but for a spread, whose halves are put
   *  together again (a panel or a line that crosses the spine once). */
  whole: VDTComicPage;
  /** Its fence read again from the text the pages were laid out from;
   *  null when that text no longer holds it. */
  source: ComicPageSource | null;
}

const splitterId = (s: Pick<VDTComicSplitter, 'path' | 'boundary'>): string => `${s.path.join('.')}:${s.boundary}`;

/** The two halves of a spread as one comic. */
function joinParts(parts: readonly ComicPart[]): VDTComicPage {
  const first = parts[0]!.comic;
  if (parts.length === 1) return first;
  const panels = new Map<number, VDTComicPanel>();
  const splitters = new Map<string, VDTComicSplitter>();
  for (const { comic } of parts) {
    for (const p of comic.panels) if (!panels.has(p.index)) panels.set(p.index, p);
    for (const s of comic.splitters) if (!splitters.has(splitterId(s))) splitters.set(splitterId(s), s);
  }
  return {
    ...first,
    panels: [...panels.values()].sort((a, b) => a.index - b.index),
    splitters: [...splitters.values()],
    balloons: parts.flatMap((p) => p.comic.balloons).sort((a, b) => a.panelIndex - b.panelIndex || a.order - b.order),
  };
}

/** Every comic of a chapter's document, in the order of the source.
 *  `markdown` is the text the document was laid out from. */
export function chapterComics(doc: VDTDocument, markdown: string): ChapterComic[] {
  const byStart = new Map<number, ComicPart[]>();
  doc.pages.forEach((page, pageIndex) => {
    for (const comic of pageComics(page)) {
      const parts = byStart.get(comic.sourceStart) ?? [];
      parts.push({ pageIndex, page, comic });
      byStart.set(comic.sourceStart, parts);
    }
  });
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, parts], i) => {
      const whole = joinParts(parts);
      return { number: i + 1, parts, whole, source: comicPageSourceAt(markdown, whole) };
    });
}

/** The part of a comic a panel, a split line or a balloon is laid out on. */
export function partOf(comic: ChapterComic, element: VDTComicPanel | VDTComicSplitter | VDTComicBalloon): ComicPart {
  return comic.parts.find((p) => (p.comic.panels as readonly unknown[]).includes(element) || (p.comic.splitters as readonly unknown[]).includes(element) || (p.comic.balloons as readonly unknown[]).includes(element)) ?? comic.parts[0]!;
}

/** The script line a balloon was set from, stray text included. */
export function scriptItemOf(source: ComicPageSource | null, b: Pick<VDTComicBalloon, 'sourceStart'>): ComicScriptItem | null {
  for (const panel of source?.panels ?? []) {
    for (const item of panel.items) if (item.sourceStart === b.sourceStart) return item;
  }
  return null;
}

const round = (n: number, digits = 4): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** A fraction as the percent the source writes (a tenth of a percent). */
export const toPercent = (fraction: number): number => round(fraction * 100, 1);

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box of the sheet in fractions of `within` (the page when left out). */
export function rectOn(page: VDTPage, box: BoundingBox, within: BoundingBox = { x: 0, y: 0, width: page.width, height: page.height }): Rect {
  const w = within.width || 1;
  const h = within.height || 1;
  return { x: round((box.x - within.x) / w), y: round((box.y - within.y) / h), width: round(box.width / w), height: round(box.height / h) };
}

/** A point of the sheet in fractions of the page. */
export const pointOn = (page: VDTPage, p: VDTPoint): { x: number; y: number } => ({ x: round(p.x / page.width), y: round(p.y / page.height) });

/** A point given in fractions of the page, on the sheet. */
export const pointOfPage = (page: VDTPage, p: { x: number; y: number }): VDTPoint => ({ x: p.x * page.width, y: p.y * page.height });

/** The line (from 1) of the text an offset is on. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Whether a panel's outline is its box (no slanted side). */
function isBox(panel: VDTComicPanel): boolean {
  const { x, y, width, height } = panel.bbox;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  return panel.polygon.length === 4 && panel.polygon.every((p) => (near(p.x, x) || near(p.x, x + width)) && (near(p.y, y) || near(p.y, y + height)));
}

/** What a comic is and where: its number, its fence, its pages. */
function comicHead(comic: ChapterComic, markdown: string, lineOffset: number, frames: boolean): Record<string, unknown> {
  const { whole, source } = comic;
  return {
    comic: comic.number,
    ...(source ? { kind: source.kind } : {}),
    line: lineAt(markdown, whole.sourceStart) - lineOffset,
    ...(source ? { split: comicSplitValue(markdown, source).value } : {}),
    pages: comic.parts.map((p) => ({
      position: p.pageIndex + 1,
      page: p.page.pageLabel,
      ...(p.comic.spread ? { side: p.comic.spread } : {}),
      ...(frames ? { frame: rectOn(p.page, p.comic.frame) } : {}),
    })),
  };
}

/** A comic in one line of an outline: enough to pick it. `lineOffset` is
 *  what to take off a line of `markdown` to get the chapter's own. */
export function outlineComic(comic: ChapterComic, markdown: string, lineOffset: number): Record<string, unknown> {
  const { whole } = comic;
  return {
    ...comicHead(comic, markdown, lineOffset, false),
    panels: whole.panels.length,
    splitters: whole.splitters.length,
    balloons: whole.balloons.length,
  };
}

function describePanel(comic: ChapterComic, markdown: string, lineOffset: number, panel: VDTComicPanel, at: number, slotPanel: ComicPanelSource | undefined, inset: boolean): Record<string, unknown> {
  const part = partOf(comic, panel);
  const elsewhere = comic.parts.filter((p) => p !== part).flatMap((p) => p.comic.panels.filter((o) => o.index === panel.index).map((o) => ({ position: p.pageIndex + 1, box: rectOn(p.page, o.bbox) })));
  return {
    panel: panel.index + 1,
    ...(comic.parts.length > 1 ? { position: part.pageIndex + 1 } : {}),
    ...(slotPanel && !slotPanel.implicit ? { line: lineAt(markdown, slotPanel.lineStart) - lineOffset } : {}),
    ...(panel.id ? { id: panel.id } : {}),
    box: rectOn(part.page, panel.bbox),
    inComic: rectOn(part.page, panel.bbox, part.comic.frame),
    ...(isBox(panel) ? {} : { outline: panel.polygon.map((p) => pointOn(part.page, p)) }),
    ...(elsewhere.length > 0 ? { alsoOn: elsewhere } : {}),
    ...(panel.art ? { art: panel.art.resourceId, picture: rectOn(part.page, panel.art.box), ...(panel.art.mirrored ? { mirrored: true } : {}) } : {}),
    ...(inset ? { inset: true } : {}),
    canSplit: canSplitPanel(markdown, comic.whole, at),
    canMergeNext: canMergeNext(markdown, comic.whole, at),
  };
}

/** The range each end of a split line may move in (percent of the cell it
 *  cuts), the cells either side keeping their 5 %. */
export function splitterRange(comic: ChapterComic, s: VDTComicSplitter): { start: number[]; end: number[] } {
  const ranges = splitterEndRanges(comic.whole, s);
  return { start: ranges.start.map((v) => round(v, 1)), end: ranges.end.map((v) => round(v, 1)) };
}

function describeSplitter(comic: ChapterComic, s: VDTComicSplitter, at: number): Record<string, unknown> {
  const part = partOf(comic, s);
  return {
    splitter: at + 1,
    ...(comic.parts.length > 1 ? { position: part.pageIndex + 1 } : {}),
    axis: s.axis,
    start: round(s.startPercent, 1),
    end: round(s.endPercent, 1),
    range: splitterRange(comic, s),
    from: pointOn(part.page, s.a),
    to: pointOn(part.page, s.b),
  };
}

function describeBalloon(comic: ChapterComic, markdown: string, lineOffset: number, b: VDTComicBalloon, at: number, textLength: number): Record<string, unknown> {
  const part = partOf(comic, b);
  const item = scriptItemOf(comic.source, b);
  const panel = balloonPanel(part.comic, b);
  const group = balloonGroup(part.comic, b);
  const centre = panel ? pageToPin(panel, boxCentre(b.bbox)) : null;
  const tip = tailHandlePointOf(markdown, part.comic, b);
  return {
    balloon: at + 1,
    panel: b.panelIndex + 1,
    ...(comic.parts.length > 1 ? { position: part.pageIndex + 1 } : {}),
    line: lineAt(markdown, b.sourceStart) - lineOffset,
    source: clip(markdown.slice(b.sourceStart, b.sourceEnd), textLength),
    kind: b.kind,
    style: b.style,
    ...(b.speaker ? { speaker: b.speaker } : {}),
    ...(item?.stray ? { stray: true } : {}),
    box: rectOn(part.page, b.bbox),
    ...(centre ? { centre: { x: toPercent(centre.x), y: toPercent(centre.y) } } : {}),
    pinned: item?.attrs.at !== undefined,
    ...(item?.at ? { at: { x: toPercent(item.at.x), y: toPercent(item.at.y) } } : item?.atKeyword ? { at: item.atKeyword } : {}),
    ...(tip ? { tail: { tip: pointOn(part.page, tip), ...(item?.to ? { to: { x: toPercent(item.to.x), y: toPercent(item.to.y) } } : {}) } } : {}),
    ...(b.rotate ? { rotate: b.rotate } : {}),
    ...(group.length > 1 ? { joined: group.map((o) => comic.whole.balloons.indexOf(o) + 1) } : {}),
  };
}

/** A comic in full: its pages, then every panel, split line and balloon
 *  with the numbers sandbox_edit_comic names them by. */
export function describeComic(comic: ChapterComic, markdown: string, lineOffset: number, textLength = 160): Record<string, unknown> {
  const { whole, source } = comic;
  const slots = source ? comicPanelSlots(whole, source) : [];
  return {
    ...comicHead(comic, markdown, lineOffset, true),
    direction: whole.direction,
    panels: whole.panels.map((p, i) => describePanel(comic, markdown, lineOffset, p, i, slots[i]?.panel, slots[i] !== undefined && slots[i]!.cell === undefined)),
    splitters: whole.splitters.map((s, i) => describeSplitter(comic, s, i)),
    balloons: whole.balloons.map((b, i) => describeBalloon(comic, markdown, lineOffset, b, i, textLength)),
  };
}
