// Lettering rules of the Cookbook page review (#660): a balloon that
// leaves its panel keeps off what the panels about it protect (#671), and
// no tail is drawn through another balloon's lettering (#672).

import { describe, it, expect, beforeAll } from 'vitest';
import { installStubMeasure } from './stubMeasure';
import { letterPanelDetailed } from '../letter';
import { presetLetteringStyles } from '../presets';
import type { LetteringItem, LetteringPanel, Point, Rect } from '../types';
import { buildDocument } from '../../../pipeline';
import { comicArtRectToPage } from '../../art';
import type { PostextConfig, Resource } from '../../../types';
import type { VDTComicBalloon, VDTComicPage } from '../../../vdt';

beforeAll(() => installStubMeasure());

const EM = 12;
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const corners = (r: Rect): Point[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
const inside = (r: Rect, of: Rect, slack = 0.5) => r.x >= of.x - slack && r.y >= of.y - slack && r.x + r.width <= of.x + of.width + slack && r.y + r.height <= of.y + of.height + slack;

const en = presetLetteringStyles({ fontSizePx: EM, locale: 'en', fontFamily: 'Test' });

function panel(cell: Rect, extra: Partial<LetteringPanel> = {}): LetteringPanel {
  return { index: 0, polygon: corners(cell), bbox: cell, insetPx: 6, direction: 'ltr', writingMode: 'horizontal', locale: 'en', anchors: [], dpi: 96, ...extra };
}

const item = (id: string, order: number, speaker: string | undefined, text: LetteringItem['text'], style = en.speech!, extra: Partial<LetteringItem> = {}): LetteringItem => ({
  id, order, kind: 'balloon', ...(speaker ? { speaker } : {}), text, sourceStart: order * 100, sourceEnd: order * 100 + 10, style, ...extra,
});

/** Whether the segment a–b meets `r`. */
function segmentMeets(a: Point, b: Point, r: Rect): boolean {
  for (let i = 0; i <= 40; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / 40, y: a.y + ((b.y - a.y) * i) / 40 };
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return true;
  }
  return false;
}

describe('a balloon that leaves its panel and what the next panel protects (#671)', () => {
  // A narrow panel between two wide ones; its one line is far too long
  // for it and may break the border.
  const limit = rect(0, 0, 780, 400);
  const CELL = rect(300, 0, 130, 200);
  const left = rect(0, 0, 288, 200);
  const right = rect(442, 0, 338, 200);
  const anchors = [{ id: 'tom', mouth: { x: 365, y: 150 }, face: rect(335, 100, 60, 70), visible: true }];
  const line = item('t', 0, 'tom', 'Just in time. The radio has gone deaf, and there is a storm on the way.', en.speech!, { breakBorder: true });
  const base = (extra: Partial<LetteringPanel> = {}) => panel(CELL, { limit, trim: limit, sheet: limit, neighbours: [left, right], anchors, ...extra });

  it('crosses the border when nothing stands in its way', () => {
    const { balloons, diagnostics } = letterPanelDetailed(base(), [line]);
    expect(diagnostics).toEqual([]);
    expect(inside(balloons[0]!.bbox, CELL)).toBe(false);
  });

  it('keeps off a face of the panel it crosses into, and off an avoid zone', () => {
    // A head by the border of the panel on one side, a lamp the picture
    // marks on the other: the strips the balloon would cross into.
    const face = { rect: rect(200, 0, 88, 120), kind: 'face' as const, within: corners(left) };
    const lamp = { rect: rect(442, 0, 100, 120), kind: 'avoid' as const, within: corners(right) };
    const free = letterPanelDetailed(base(), [line]).balloons[0]!.bbox;
    // (Without them it stands over the head.)
    expect(overlap(free, face.rect)).toBe(true);
    // The head alone: it crosses the other border.
    const one = letterPanelDetailed(base({ foreignArt: [face] }), [line]);
    expect(one.diagnostics).toEqual([]);
    expect(inside(one.balloons[0]!.bbox, CELL)).toBe(false);
    expect(overlap(one.balloons[0]!.bbox, face.rect)).toBe(false);
    // The lamp alone: it stays on the head's side.
    const other = letterPanelDetailed(base({ foreignArt: [lamp] }), [line]);
    expect(other.diagnostics).toEqual([]);
    expect(overlap(other.balloons[0]!.bbox, lamp.rect)).toBe(false);
    // Both: an avoid zone is covered before a face, here as in its own panel.
    const both = letterPanelDetailed(base({ foreignArt: [face, lamp] }), [line]);
    expect(overlap(both.balloons[0]!.bbox, face.rect)).toBe(false);
    expect(both.diagnostics.flatMap((d) => d.reasons)).not.toContain('face');
  });

  it('counts only what the page shows of the other picture: its own panel, under no inset', () => {
    // The same face rectangle, but its panel ends before it (the crop
    // leaves the face out), or an inset hides it: nothing to keep off.
    const hiddenFaces = [
      { rect: rect(200, 0, 88, 120), kind: 'face' as const, within: corners(rect(0, 0, 100, 200)) },
      { rect: rect(442, 0, 100, 120), kind: 'face' as const, within: corners(right), under: [corners(rect(430, 0, 200, 160))] },
    ];
    const free = letterPanelDetailed(base(), [line]);
    const hidden = letterPanelDetailed(base({ foreignArt: hiddenFaces }), [line]);
    expect(hidden.balloons.map((b) => b.bbox)).toEqual(free.balloons.map((b) => b.bbox));
    expect(hidden.diagnostics).toEqual([]);
  });

  it('reports a face of another panel a pinned sound effect covers, and leaves it on its pin', () => {
    const face = { rect: rect(442, 20, 140, 140), kind: 'face' as const, within: corners(right) };
    const sfx: LetteringItem = { id: 's', order: 0, kind: 'sfx', text: 'TOK', sourceStart: 0, sourceEnd: 3, style: en.sfx!, pin: { x: 450, y: 60 } };
    const free = letterPanelDetailed(base(), [sfx]);
    expect(free.diagnostics).toEqual([]);
    const { balloons, diagnostics } = letterPanelDetailed(base({ foreignArt: [face] }), [sfx]);
    expect(diagnostics.map((d) => d.reasons)).toEqual([['face']]);
    expect(balloons[0]!.bbox).toEqual(free.balloons[0]!.bbox);
  });

  it('never covers the tail of a balloon of another panel', () => {
    // The neighbour's balloon stands clear of the crossing, but its tail
    // runs down the strip the balloon would take.
    const tail: [Point, Point] = [{ x: 270, y: 10 }, { x: 270, y: 120 }];
    const tailBox = rect(268, 10, 4, 110);
    const free = letterPanelDetailed(base(), [line]).balloons[0]!.bbox;
    expect(overlap(free, tailBox)).toBe(true);
    const { balloons } = letterPanelDetailed(base({ foreignTails: [tail] }), [line]);
    for (const b of balloons) expect(overlap(b.bbox, tailBox)).toBe(false);
  });

  it('takes a round balloon of another panel as the oval its box holds', () => {
    // A sound effect pinned beside the corner of a neighbour's oval: the
    // corner of that box is no part of the balloon.
    const oval = rect(466, 74, 120, 80);
    const sfx: LetteringItem = { id: 's', order: 0, kind: 'sfx', text: 'TOK', sourceStart: 0, sourceEnd: 3, style: en.sfx!, rotate: 0, pin: { x: 430, y: 60 } };
    const boxed = letterPanelDetailed(base({ foreign: [oval] }), [sfx]);
    expect(boxed.diagnostics.map((d) => d.reasons)).toEqual([['balloon']]);
    const round = letterPanelDetailed(base({ foreign: [{ ...oval, round: true }] }), [sfx]);
    expect(round.diagnostics).toEqual([]);
  });

  it('keeps a balloon of a panel off the inset laid over it', () => {
    // A wide panel, the speaker at its left; an inset takes the room right
    // of the head, where the balloon would stand.
    const cell = rect(0, 0, 400, 300);
    const who = [{ id: 'may', mouth: { x: 120, y: 200 }, face: rect(80, 150, 80, 90), visible: true }];
    const say = item('m', 0, 'may', 'Grandpa… I think I have found the problem.');
    const free = letterPanelDetailed(panel(cell, { anchors: who }), [say]).balloons[0]!.bbox;
    const inset = rect(free.x + 10, free.y + 10, 200, 150);
    const { balloons, diagnostics } = letterPanelDetailed(panel(cell, { anchors: who, neighbours: [inset], over: [corners(inset)] }), [say]);
    expect(diagnostics).toEqual([]);
    expect(overlap(balloons[0]!.bbox, inset)).toBe(false);
  });
});

describe('the page hands every panel what the others protect (#671)', () => {
  const picture = (id: string, width: number, height: number, extra: Partial<Resource> = {}): Resource => ({
    id, typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0, bitmap: { fileId: `file-${id}`, format: 'png', width, height }, ...extra,
  });
  // The first panel: a caption in its corner, and a tower the picture marks
  // as an avoid zone at its right edge. The second, far too narrow for its
  // line, which may break the border.
  const resources: Resource[] = [
    picture('arrive', 1000, 800, {
      anchors: [{ id: 'may', x: 0.3, y: 0.7, face: { x: 0.22, y: 0.62, width: 0.16, height: 0.12 } }],
      avoid: [{ x: 0.7, y: 0.05, width: 0.28, height: 0.5 }],
    }),
    picture('radio', 400, 800, { anchors: [{ id: 'tom', x: 0.5, y: 0.75, face: { x: 0.25, y: 0.6, width: 0.5, height: 0.3 } }] }),
  ];
  const config: PostextConfig = { page: { sizePreset: '17x24' }, locale: 'en' };
  const page = (direction: 'ltr' | 'rtl') => `:::page{split="30 [48 | 12 | *] / *" direction=${direction}}
::panel{art=arrive}
caption: Every summer Maya spent a week at the lighthouse.
may: Grandpa! I am here!
::panel{art=radio}
tom{break}: Just in time. The radio has gone deaf, and there is a storm on the way.
::panel
::panel
:::
`;
  const comic = (direction: 'ltr' | 'rtl'): VDTComicPage => buildDocument({ markdown: page(direction), resources }, config).pages.find((p) => p.comic)!.comic!;
  const ofPanel = (c: VDTComicPage, i: number): VDTComicBalloon[] => c.balloons.filter((b) => b.panelIndex === i);

  it('a break balloon keeps off the avoid zone of the picture beside it', () => {
    // Left to right, the tower stands by the border the balloon crosses.
    const c = comic('ltr');
    const broke = ofPanel(c, 1)[0]!;
    expect(inside(broke.bbox, c.panels[1]!.bbox)).toBe(false);
    const tower = comicArtRectToPage(c.panels[0]!.art!, resources[0]!.avoid![0]!);
    const end = c.panels[0]!.bbox.x + c.panels[0]!.bbox.width;
    expect(overlap(broke.bbox, { ...tower, width: end - tower.x })).toBe(false);
  });

  it('a break balloon keeps off the caption and the balloons of the panel beside it', () => {
    // Right to left, the caption gives its corner to the tower and stands
    // by the border the balloon crosses.
    const c = comic('rtl');
    const broke = ofPanel(c, 1)[0]!;
    expect(inside(broke.bbox, c.panels[1]!.bbox)).toBe(false);
    const first = ofPanel(c, 0);
    expect(first.length).toBe(2);
    for (const b of first) expect(overlap(broke.bbox, b.bbox)).toBe(false);
  });
});

describe('a tail and the lettering of another balloon (#672)', () => {
  // A wide balloon pinned across the panel; under it a second one whose
  // speaker stands above the first: its tail has to cross it.
  const CELL = rect(0, 0, 300, 300);
  const wall = item('w', 0, 'b', 'A long line pinned across the panel.', en.speech!, { pin: { x: 150, y: 150 }, tail: 'none' });
  const wallBox = () => letterPanelDetailed(panel(CELL), [wall]).balloons[0]!.bbox;
  const under = (x: number) => {
    const anchors = [{ id: 'a', mouth: { x, y: 30 }, visible: true }];
    return letterPanelDetailed(panel(CELL, { anchors }), [wall, item('s', 1, 'a', 'Down here!', en.speech!, { pin: { x, y: 250 } })]);
  };

  it('is a fault through the middle of the other balloon', () => {
    const w = wallBox();
    const { balloons, diagnostics } = under(w.x + w.width / 2);
    // (The tail does run up past the first balloon.)
    expect(balloons[1]!.tailTip!.y).toBeLessThan(w.y);
    expect(diagnostics.map((d) => [d.itemId, d.reasons])).toContainEqual(['s', ['balloon']]);
  });

  it('is a fault through the end of an oval, a tenth of its width from its side', () => {
    // balloon-kinds, morning panel (pt): the tail rose through the left end
    // of «Uma é pro gato.», outside the box the old test shrank by 12 %.
    const w = wallBox();
    const { balloons, diagnostics } = under(w.x + 0.1 * w.width);
    expect(balloons[1]!.tailTip!.y).toBeLessThan(w.y);
    expect(diagnostics.map((d) => [d.itemId, d.reasons])).toContainEqual(['s', ['balloon']]);
  });

  it('is none for a tail that runs up beside the other balloon', () => {
    const w = wallBox();
    const { diagnostics } = under(w.x - 6);
    expect(diagnostics).toEqual([]);
  });

  it('moves the balloon rather than cross: left to the engine, the tail runs clear', () => {
    const w = wallBox();
    const anchors = [{ id: 'a', mouth: { x: w.x + w.width / 2, y: 30 }, visible: true }];
    const { balloons, diagnostics } = letterPanelDetailed(panel(CELL, { anchors }), [wall, item('s', 1, 'a', 'Down here!')]);
    expect(diagnostics).toEqual([]);
    const b = balloons[1]!;
    const c = { x: b.bbox.x + b.bbox.width / 2, y: b.bbox.y + b.bbox.height / 2 };
    expect(segmentMeets(c, b.tailTip ?? c, rect(w.x + 0.1 * w.width, w.y + 0.2 * w.height, 0.8 * w.width, 0.6 * w.height))).toBe(false);
  });
});
