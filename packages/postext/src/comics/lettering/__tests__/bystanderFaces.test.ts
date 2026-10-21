// #726: a picture can mark the faces of people who do not speak
// (`Resource.faces`). Such a face gets the rule a speaker's face has: no
// balloon covers it at any fallback, a balloon that still does is reported
// (`comicBalloonOverflow`, reason `face`), no tail crosses it or the figure
// under it when another route exists, and a balloon of another panel that
// breaks its border keeps off it.

import { describe, it, expect, beforeAll } from 'vitest';
import { installStubMeasure } from './stubMeasure.js';
import { letterPanelDetailed } from '../letter.js';
import { presetLetteringStyles } from '../presets.js';
import type { LetteringItem, LetteringPanel, Point, Rect } from '../types.js';
import { buildDocument } from '../../../pipeline/index.js';
import { comicArtRectToPage } from '../../art.js';
import type { PostextConfig, Resource, ResourceSafeArea } from '../../../types.js';
import type { VDTComicBalloon, VDTComicPage } from '../../../vdt.js';

beforeAll(() => installStubMeasure());

const EM = 12;
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const corners = (r: Rect): Point[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
const en = presetLetteringStyles({ fontSizePx: EM, locale: 'en', fontFamily: 'Test' });
const panel = (cell: Rect, extra: Partial<LetteringPanel> = {}): LetteringPanel =>
  ({ index: 0, polygon: corners(cell), bbox: cell, insetPx: 6, direction: 'ltr', writingMode: 'horizontal', locale: 'en', anchors: [], dpi: 96, ...extra });
const item = (id: string, order: number, speaker: string, text: string, extra: Partial<LetteringItem> = {}): LetteringItem =>
  ({ id, order, kind: 'balloon', speaker, text, sourceStart: order * 100, sourceEnd: order * 100 + 10, style: en.speech!, ...extra });

/** Share of `r` (percent) under the oval the box `b` holds. */
function ovalOver(b: Rect, r: Rect): number {
  let n = 0;
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 40; j++) {
      const x = r.x + ((i + 0.5) / 40) * r.width;
      const y = r.y + ((j + 0.5) / 40) * r.height;
      if (((x - (b.x + b.width / 2)) / (b.width / 2)) ** 2 + ((y - (b.y + b.height / 2)) / (b.height / 2)) ** 2 <= 1) n++;
    }
  }
  return Math.round((n / 1600) * 100);
}

/** Whether the segment a–b meets `r`. */
function segmentMeets(a: Point, b: Point, r: Rect): boolean {
  for (let i = 0; i <= 60; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / 60, y: a.y + ((b.y - a.y) * i) / 60 };
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return true;
  }
  return false;
}

describe('a bystander\'s face in a panel (#726)', () => {
  // A 240 x 200 px panel. Lola speaks from the bottom left; the art marks
  // two zones (top left, the right side); a bystander's head stands in the
  // upper middle; one line of 73 characters.
  const CELL = rect(0, 0, 240, 200);
  const lola = { id: 'lola', mouth: { x: 40, y: 150 }, face: rect(22, 122, 36, 44), visible: true };
  const BY = rect(100.8, 20, 72, 60);
  const marked = [rect(0, 0, 96, 90), rect(177.6, 0, 62.4, 180)];
  const lines = [item('a', 0, 'lola', 'Grandpa? Grandpa, where are you? I cannot see you anywhere in this crowd.')];

  it('as an avoid zone it is covered at the last fallback, and nothing is reported', () => {
    const { balloons, diagnostics } = letterPanelDetailed(panel(CELL, { anchors: [lola], avoid: [BY, ...marked] }), lines);
    expect(ovalOver(balloons[0]!.bbox, BY)).toBeGreaterThan(20);
    expect(diagnostics).toEqual([]);
  });

  it('as a face it is clear, with no diagnostic either', () => {
    const { balloons, diagnostics } = letterPanelDetailed(panel(CELL, { anchors: [lola], faces: [BY], avoid: marked }), lines);
    expect(ovalOver(balloons[0]!.bbox, BY)).toBe(0);
    expect(diagnostics).toEqual([]);
  });

  it('gives the layout an anchor nobody speaks from gave', () => {
    const asFace = letterPanelDetailed(panel(CELL, { anchors: [lola], faces: [BY], avoid: marked }), lines);
    const asAnchor = letterPanelDetailed(panel(CELL, { anchors: [lola, { id: 'fishmonger', mouth: { x: 136.8, y: 68 }, face: BY, visible: false }], avoid: marked }), lines);
    expect(ovalOver(asAnchor.balloons[0]!.bbox, BY)).toBe(0);
    expect(asFace.diagnostics).toEqual(asAnchor.diagnostics);
  });

  it('a balloon pinned on it is reported as covering a face, where an avoid zone is covered in silence', () => {
    const pinned = [item('a', 0, 'lola', 'Grandpa? Where are you?', { pin: { x: 136, y: 50 } })];
    const onFace = letterPanelDetailed(panel(CELL, { anchors: [lola], faces: [BY] }), pinned);
    expect(onFace.diagnostics.map((d) => d.reasons)).toEqual([['face']]);
    const onZone = letterPanelDetailed(panel(CELL, { anchors: [lola], avoid: [BY] }), pinned);
    expect(onZone.diagnostics).toEqual([]);
    expect(onZone.balloons[0]!.bbox).toEqual(onFace.balloons[0]!.bbox);
  });

  it('a face that fills the panel is not covered at the last fallback: the balloon is reported instead', () => {
    const big = rect(10, 10, 220, 180);
    const low = { id: 'lola', mouth: { x: 40, y: 190 }, visible: true };
    // As an avoid zone the head is covered and nothing is said.
    const quiet = letterPanelDetailed(panel(CELL, { anchors: [low], avoid: [big] }), lines);
    expect(quiet.diagnostics).toEqual([]);
    expect(ovalOver(quiet.balloons[0]!.bbox, big)).toBeGreaterThan(20);
    // As a face it is a fault at every level: the balloon ends where it
    // covers least of it, and is reported.
    const loud = letterPanelDetailed(panel(CELL, { anchors: [low], faces: [big] }), lines);
    expect(loud.diagnostics).toHaveLength(1);
    expect(ovalOver(loud.balloons[0]!.bbox, big)).toBeLessThan(ovalOver(quiet.balloons[0]!.bbox, big));
  });

  it('a tail does not cross the bystander when another route exists', () => {
    // A wide panel: the speaker at the right, low; a bystander between the
    // speaker and the top left corner, where the first balloon would go.
    const WIDE = rect(0, 0, 420, 220);
    const ana = { id: 'ana', mouth: { x: 330, y: 150 }, face: rect(308, 118, 44, 50), visible: true };
    const by = rect(170, 70, 60, 70);
    const figure = rect(by.x - 0.2 * by.width, by.y + by.height, 1.4 * by.width, 1.6 * by.height);
    const head = rect(by.x, by.y - 0.3 * by.height, by.width, 1.3 * by.height);
    const line = [item('a', 0, 'ana', 'Over here! I have been waiting for an hour.')];
    const { balloons, diagnostics } = letterPanelDetailed(panel(WIDE, { anchors: [ana], faces: [by] }), line);
    expect(diagnostics).toEqual([]);
    const b = balloons[0]!;
    const from = { x: b.bbox.x + b.bbox.width / 2, y: b.bbox.y + b.bbox.height / 2 };
    expect(b.tailTip).toBeDefined();
    expect(segmentMeets(from, b.tailTip!, head)).toBe(false);
    expect(segmentMeets(from, b.tailTip!, figure)).toBe(false);
    expect(overlap(b.bbox, by)).toBe(false);
  });

  it('a corner caption slides off it, as off a speaker\'s face', () => {
    const top = rect(8, 8, 110, 60);
    const cap: LetteringItem = { id: 'c', order: 0, kind: 'caption', text: 'The market, at noon.', sourceStart: 0, sourceEnd: 10, style: en.caption!, position: 'top-start' };
    const free = letterPanelDetailed(panel(CELL), [cap]).balloons[0]!.bbox;
    expect(overlap(free, top)).toBe(true);
    const { balloons, diagnostics } = letterPanelDetailed(panel(CELL, { faces: [top] }), [cap]);
    expect(overlap(balloons[0]!.bbox, top)).toBe(false);
    expect(diagnostics).toEqual([]);
  });

  it('a panel with no faces is lettered as before', () => {
    const a = letterPanelDetailed(panel(CELL, { anchors: [lola], avoid: marked }), lines);
    const b = letterPanelDetailed(panel(CELL, { anchors: [lola], avoid: marked, faces: [] }), lines);
    expect(b.balloons.map((x) => x.bbox)).toEqual(a.balloons.map((x) => x.bbox));
  });
});

describe('bystander faces through the build (#726)', () => {
  const picture = (id: string, width: number, height: number, extra: Partial<Resource> = {}): Resource => ({
    id, typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0, bitmap: { fileId: `file-${id}`, format: 'png', width, height }, ...extra,
  });
  const config = (comics: PostextConfig['comics'] = {}): PostextConfig => ({ page: { sizePreset: '17x24' }, locale: 'en', comics });
  const comicOf = (markdown: string, resources: Resource[], cfg = config()): { comic: VDTComicPage; warnings: { kind: string; reasons?: string[] }[] } => {
    const doc = buildDocument({ markdown, resources }, cfg);
    return { comic: doc.pages.find((p) => p.comic)!.comic!, warnings: (doc.contentWarnings ?? []).filter((w) => String(w.kind).startsWith('comic')) as { kind: string; reasons?: string[] }[] };
  };
  // A market: Lola at the left, a fishmonger who says nothing over the
  // middle of the picture, where a long line would otherwise stand.
  const lola = { id: 'lola', x: 0.12, y: 0.72, face: { x: 0.07, y: 0.6, width: 0.1, height: 0.2 } };
  const FISH: ResourceSafeArea = { x: 0.3, y: 0.12, width: 0.2, height: 0.34 };
  const long = 'lola: Grandpa? Grandpa, where are you? I cannot see you anywhere in this crowd, and the stalls all look the same.';
  const page = (attrs = '') => `:::page{split="34 / *"}\n::panel{art=market${attrs}}\n${long}\n::panel\n:::\n`;
  const market = (extra: Partial<Resource>) => [picture('market', 1600, 700, { anchors: [lola], ...extra })];
  const faceOnPage = (c: VDTComicPage) => comicArtRectToPage(c.panels[0]!.art!, FISH);
  const first = (c: VDTComicPage): VDTComicBalloon => c.balloons.find((b) => b.panelIndex === 0)!;

  it('keeps the balloon off a face of the picture, where an unmarked picture lets it stand there', () => {
    const plain = comicOf(page(), market({}));
    expect(overlap(first(plain.comic).bbox, faceOnPage(plain.comic))).toBe(true);
    const marked = comicOf(page(), market({ faces: [FISH] }));
    expect(overlap(first(marked.comic).bbox, faceOnPage(marked.comic))).toBe(false);
    expect(marked.warnings).toEqual([]);
  });

  it('follows a mirrored picture', () => {
    const cfg = config({ artDirection: 'ltr', mirrorArt: true });
    const md = page().replace(':::page{', ':::page{direction=rtl ');
    const marked = comicOf(md, market({ faces: [FISH] }), cfg);
    const c = marked.comic;
    expect(c.panels[0]!.art!.mirrored).toBe(true);
    const face = faceOnPage(c);
    // The face is on the other half of the panel now, and still clear.
    const mid = c.panels[0]!.bbox.x + c.panels[0]!.bbox.width / 2;
    expect(face.x + face.width / 2).toBeGreaterThan(mid);
    expect(overlap(first(c).bbox, face)).toBe(false);
    expect(marked.warnings).toEqual([]);
  });

  it('follows the crop: a face the crop leaves out of the panel protects nothing', () => {
    // The safe area keeps the left third of the picture; the cell is far
    // narrower than the picture, so the fishmonger is cropped off.
    const safe = { safeArea: { x: 0, y: 0, width: 0.24, height: 1 } };
    const md = `:::page{split="[26 | *] / *"}\n::panel{art=market}\n${long}\n::panel\n::panel\n:::\n`;
    const a = comicOf(md, market({ ...safe }));
    const b = comicOf(md, market({ ...safe, faces: [{ x: 0.7, y: 0.12, width: 0.2, height: 0.34 }] }));
    const gone = comicArtRectToPage(b.comic.panels[0]!.art!, { x: 0.7, y: 0.12, width: 0.2, height: 0.34 });
    expect(overlap(gone, b.comic.panels[0]!.bbox)).toBe(false);
    expect(first(b.comic).bbox).toEqual(first(a.comic).bbox);
  });

  it('reports a balloon pinned on a face, and raises no anchor warning for a face outside the safe area', () => {
    const pinned = page().replace('lola: Grandpa?', 'lola{at="40% 29%"}: Grandpa?');
    const on = comicOf(pinned, market({ faces: [FISH] }));
    expect(on.warnings.filter((w) => w.kind === 'comicBalloonOverflow').map((w) => w.reasons)).toEqual([['face']]);
    expect(comicOf(pinned, market({ avoid: [FISH] })).warnings).toEqual([]);
    const outside = comicOf(page(), market({ safeArea: { x: 0, y: 0.3, width: 0.25, height: 0.6 }, faces: [FISH] }));
    expect(outside.warnings.filter((w) => w.kind === 'comicAnchorOutsideSafeArea')).toEqual([]);
  });

  it('a break balloon of the next panel keeps off it', () => {
    // The first picture's bystander stands by the border the narrow
    // panel's balloon crosses.
    const resources: Resource[] = [
      picture('arrive', 1000, 800, { anchors: [{ id: 'may', x: 0.3, y: 0.7, face: { x: 0.22, y: 0.62, width: 0.16, height: 0.12 } }] }),
      picture('radio', 400, 800, { anchors: [{ id: 'tom', x: 0.5, y: 0.75, face: { x: 0.25, y: 0.6, width: 0.5, height: 0.3 } }] }),
    ];
    const by: ResourceSafeArea = { x: 0.7, y: 0.05, width: 0.28, height: 0.5 };
    const md = `:::page{split="30 [48 | 12 | *] / *"}\n::panel{art=arrive}\nmay: Grandpa! I am here!\n::panel{art=radio}\ntom{break}: Just in time. The radio has gone deaf, and there is a storm on the way.\n::panel\n::panel\n:::\n`;
    const free = comicOf(md, resources).comic;
    const marked = comicOf(md, [{ ...resources[0]!, faces: [by] }, resources[1]!]).comic;
    const zone = (c: VDTComicPage) => {
      const r = comicArtRectToPage(c.panels[0]!.art!, by);
      return { ...r, width: c.panels[0]!.bbox.x + c.panels[0]!.bbox.width - r.x };
    };
    const broke = (c: VDTComicPage) => c.balloons.find((b) => b.panelIndex === 1)!;
    expect(overlap(broke(free).bbox, zone(free))).toBe(true);
    expect(overlap(broke(marked).bbox, zone(marked))).toBe(false);
  });

  it('a picture without faces gives the page it gave', () => {
    const a = comicOf(page(), market({}));
    const b = comicOf(page(), market({ faces: [] }));
    expect(b.comic.balloons).toEqual(a.comic.balloons);
  });
});
