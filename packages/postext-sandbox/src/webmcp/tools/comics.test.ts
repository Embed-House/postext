import { beforeEach, describe, expect, it } from 'vitest';
import type { Resource } from 'postext';
import { resetViewerEdits, undoViewerEdit } from '../../editor/viewerEdits.js';
import { runTool } from '../modelContext.js';
import { comicTools } from './comics.js';
import { chapter, harness } from './testHarness.js';

// A comic page of two tiers after a paragraph: the first panel shows a
// picture (wider than its cell, so it is cropped), the second has none.
const PAGE = `---
title: Lighthouse
---

# The storm

Before the page.

:::page{split="40 / *"}
::panel{art=room}
caption: Every summer, Maya spent a week at the lighthouse.
maya: Grandpa! I'm here!
::panel
tomas: Just in time.
sfx: KRAK
:::

After the page.
`;

// A spread of three panels (the middle one crosses the spine) and a strip.
const SPREAD = `# Spread

:::page{spread split="* | * | *"}
::panel
ana: One
::panel
ana: Two
::panel
ana: Three
:::

:::strip
::panel
ben: Strip one
::panel
ben: Strip two
:::
`;

// The picture marks Maya's face and a corner no balloon should cover.
const room: Resource = {
  id: 'room', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'room-file', format: 'png', width: 1600, height: 900 },
  anchors: [{ id: 'maya', x: 0.7, y: 0.6, face: { x: 0.6, y: 0.4, width: 0.2, height: 0.3 } }],
  avoid: [{ x: 0, y: 0.7, width: 0.3, height: 0.3 }],
};

type Answer = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function comics(first = PAGE, second = SPREAD) {
  const chapters = [chapter('a', 'Storm', first), chapter('b', 'Second', second)];
  const h = harness({ chapters, markdown: first, activeChapterId: 'a', resources: [room] });
  const tools = new Map(comicTools(h.host).map((t) => [t.name, t]));
  const call = (name: string, args: Record<string, unknown> = {}) => runTool(tools.get(name)!, args) as Promise<Answer>;
  const edit = (args: Record<string, unknown>) => call('sandbox_edit_comic', { comic: 1, wait: false, ...args });
  const inspect = async (args: Record<string, unknown> = { comic: 1 }): Promise<Answer> => (await call('sandbox_inspect_comic', args)).comics[0];
  const line = (n: number, chapterIndex = 0) => h.get().chapters[chapterIndex]!.markdown.split('\n')[n - 1];
  return { ...h, tools, call, edit, inspect, line };
}

describe('the comic tools', () => {
  beforeEach(() => resetViewerEdits());

  it('are a read and an edit', () => {
    const { tools } = comics();
    expect([...tools.keys()]).toEqual(['sandbox_inspect_comic', 'sandbox_edit_comic']);
    for (const tool of tools.values()) {
      expect(tool.title).toMatch(/^Sandbox: /);
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(tools.get('sandbox_inspect_comic')!.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(tools.get('sandbox_edit_comic')!.annotations?.readOnlyHint).toBeUndefined();
  });

  it('list the comics of a chapter and say where everything on a page lies', async () => {
    const { call } = comics();
    const outline = await call('sandbox_inspect_comic');
    expect(outline).toMatchObject({ ok: true, chapter: 1, title: 'Storm' });
    expect(outline.comics).toEqual([{ comic: 1, kind: 'page', line: 9, split: '40 / *', pages: [{ position: 2, page: '2' }], panels: 2, splitters: 1, balloons: 4 }]);

    const page = await call('sandbox_inspect_comic', { position: 2 });
    expect(page).toMatchObject({ position: 2, page: '2' });
    const comic = page.comics[0];
    expect(comic).toMatchObject({ comic: 1, direction: 'ltr', pages: [{ position: 2, frame: { x: 0.125, width: 0.75 } }] });

    const [first, second] = comic.panels;
    expect(first).toMatchObject({ panel: 1, line: 10, art: 'room', canSplit: true, canMergeNext: true, inComic: { x: 0, y: 0, width: 1 } });
    expect(second).toMatchObject({ panel: 2, line: 13, canSplit: true, canMergeNext: false });
    expect(second.art).toBeUndefined();
    // The picture is cropped at the sides: it runs past its panel.
    expect(first.picture.x).toBeLessThan(first.box.x);
    expect(first.picture.width).toBeGreaterThan(first.box.width);

    // The line lies in the gutter between the two panels, at 40 % of the frame.
    const [splitter] = comic.splitters;
    expect(splitter).toMatchObject({ splitter: 1, axis: 'rows', start: 40, end: 40, range: { start: [5, 95], end: [5, 95] } });
    expect(splitter.from.y).toBeGreaterThan(first.box.y + first.box.height);
    expect(splitter.from.y).toBeLessThan(second.box.y);
    expect(splitter.from.y).toBeCloseTo(comic.pages[0].frame.y + 0.4 * comic.pages[0].frame.height, 3);

    expect(comic.balloons.map((b: Answer) => [b.balloon, b.panel, b.line, b.kind])).toEqual([[1, 1, 11, 'caption'], [2, 1, 12, 'balloon'], [3, 2, 14, 'balloon'], [4, 2, 15, 'sfx']]);
    expect(comic.balloons[1]).toMatchObject({ source: "maya: Grandpa! I'm here!", speaker: 'maya', style: 'speech', pinned: false });
    expect(comic.balloons[1].tail.tip.x).toBeGreaterThan(0);
    expect(comic.balloons[0].tail).toBeUndefined();
    // A balloon lies inside its panel.
    const { box } = comic.balloons[2];
    expect(box.y).toBeGreaterThanOrEqual(second.box.y);
    expect(box.y + box.height).toBeLessThanOrEqual(second.box.y + second.box.height);

    expect(await call('sandbox_inspect_comic', { position: 1 })).toMatchObject({ comics: [], note: expect.stringMatching(/positions 2\./) });
    expect((await call('sandbox_inspect_comic', { comic: 4 })).error).toBe('Chapter 1 has 1 comic(s); comic 4 is not one of them.');
    const none = harness();
    const bare = await runTool(comicTools(none.host)[0]!, {}) as Answer;
    expect(bare).toMatchObject({ ok: true, comics: [], note: expect.stringMatching(/no :::page or :::strip block/) });
  });

  it('move a split line as a drag does, within its range', async () => {
    const { edit, inspect, line, get } = comics();
    const before = await inspect();
    const moved = await edit({ action: 'move_splitter', splitter: 1, start: 55 });
    expect(moved).toMatchObject({ ok: true, chapter: 1, comic: 1, changed: true, start: 55, end: 55, laidOut: false, lines: [{ line: 9, text: ':::page{split="55 / *"}' }] });
    expect(get().markdown).toBe(PAGE.replace('40 / *', '55 / *'));
    const after = await inspect();
    expect(after.splitters[0]).toMatchObject({ start: 55, end: 55 });
    expect(after.panels[0].box.height).toBeGreaterThan(before.panels[0].box.height);
    expect(after.panels[1].box.y).toBeGreaterThan(before.panels[1].box.y);

    expect(await edit({ action: 'move_splitter', splitter: 1, start: 55 })).toMatchObject({ ok: true, changed: false, note: 'The line is already there.' });
    // Past its range the line stops where the last cell keeps its 5 %.
    expect(await edit({ action: 'move_splitter', splitter: 1, start: 99 })).toMatchObject({ changed: true, start: 95, clamped: true, range: { start: [5, 95] } });
    // Both ends named: a slanted line.
    await edit({ action: 'move_splitter', splitter: 1, start: 30, end: 45 });
    expect(line(9)).toBe(':::page{split="30~45 / *"}');
    const slanted = await inspect();
    expect(slanted.splitters[0]).toMatchObject({ start: 30, end: 45 });
    expect(slanted.panels[0].outline).toHaveLength(4);
    // Start alone moves it whole, its slant kept.
    await edit({ action: 'move_splitter', splitter: 1, start: 40 });
    expect(line(9)).toBe(':::page{split="40~55 / *"}');

    expect((await edit({ action: 'move_splitter', splitter: 2, start: 40 })).error).toBe('Comic 1 has 1 splitter(s); splitter 2 is not one of them.');
    expect((await edit({ action: 'move_splitter', splitter: 1 })).error).toMatch(/move_splitter needs "start"/);
    expect((await edit({ comic: 3, action: 'move_splitter', splitter: 1, start: 40 })).error).toMatch(/Chapter 1 has 1 comic\(s\); comic 3 is not one of them/);
  });

  it('split a panel and merge it back', async () => {
    const { edit, inspect, get } = comics();
    const split = await edit({ action: 'split_panel', panel: 2, direction: 'columns' });
    expect(split).toMatchObject({ ok: true, changed: true, panel: 2 });
    expect(split.lines).toEqual([{ line: 9, text: ':::page{split="40 / * [* | *]"}' }, { line: 16, text: '::panel' }]);
    expect(get().markdown).toBe(PAGE.replace('40 / *', '40 / * [* | *]').replace('sfx: KRAK\n', 'sfx: KRAK\n::panel\n'));
    const three = await inspect();
    expect(three.panels.map((p: Answer) => [p.panel, p.canMergeNext])).toEqual([[1, false], [2, true], [3, false]]);
    // Side by side, in the second tier.
    expect(three.panels[2].box.y).toBe(three.panels[1].box.y);
    expect(three.panels[2].box.x).toBeGreaterThan(three.panels[1].box.x);
    expect(three.splitters).toHaveLength(2);

    // The first tier's next cell is split further.
    expect((await edit({ action: 'merge_panel', panel: 1 })).error).toMatch(/Panel 1 has no panel to merge with/);
    expect(await edit({ action: 'merge_panel', panel: 2 })).toMatchObject({ ok: true, changed: true, panel: 2 });
    expect(get().markdown).toBe(PAGE);
    expect((await edit({ action: 'merge_panel', panel: 2 })).error).toMatch(/it is the last of its row or column/);
    expect(get().markdown).toBe(PAGE);

    await edit({ action: 'split_panel', panel: 1, direction: 'rows' });
    expect(get().markdown).toContain(':::page{split="20 / 20 / *"}');
    expect((await edit({ action: 'split_panel', panel: 1 })).error).toMatch(/split_panel needs "direction"/);
    expect((await edit({ action: 'split_panel', panel: 9, direction: 'rows' })).error).toBe('Comic 1 has 3 panel(s); panel 9 is not one of them.');
  });

  it('leave an inset panel as the editor does', async () => {
    const inset = PAGE.replace('::panel\ntomas', '::panel{inset="60% 6% 30% 30%"}\ntomas');
    const { edit, inspect, get } = comics(inset);
    const comic = await inspect();
    expect(comic.panels[1]).toMatchObject({ panel: 2, inset: true, canSplit: false, canMergeNext: false });
    expect((await edit({ action: 'split_panel', panel: 2, direction: 'rows' })).error).toMatch(/Panel 2 fills no cell of the page's split/);
    expect(get().markdown).toBe(inset);
  });

  it('pin a balloon where it is put, in its panel or on the page, and unpin it', async () => {
    const { edit, inspect, line, get } = comics();
    const pinned = await edit({ action: 'move_balloon', balloon: 3, at: { x: 50, y: 50 } });
    expect(pinned).toMatchObject({ ok: true, changed: true, balloon: 3, at: { x: 50, y: 50 }, lines: [{ line: 14, text: 'tomas{at="50% 50%"}: Just in time.' }] });
    expect(pinned.clamped).toBeUndefined();
    expect(pinned.issues).toBeUndefined();
    let comic = await inspect();
    const panel = comic.panels[1].box;
    expect(comic.balloons[2]).toMatchObject({ pinned: true, at: { x: 50, y: 50 }, centre: { x: 50, y: 50 } });
    // A panel without a picture: the pin is a point of its box.
    expect(comic.balloons[2].box.x + comic.balloons[2].box.width / 2).toBeCloseTo(panel.x + panel.width / 2, 3);
    expect(comic.balloons[2].box.y + comic.balloons[2].box.height / 2).toBeCloseTo(panel.y + panel.height / 2, 3);
    expect(await edit({ action: 'move_balloon', balloon: 3, at: { x: 50, y: 50 } })).toMatchObject({ changed: false, note: 'The balloon is already there.' });

    // The same, given as a point of the page (of a picture of it).
    const onPage = await edit({ action: 'move_balloon', balloon: 3, space: 'page', at: { x: panel.x + 0.25 * panel.width, y: panel.y + 0.75 * panel.height } });
    expect(onPage).toMatchObject({ changed: true, at: { x: 25, y: 75 } });
    expect(line(14)).toBe('tomas{at="25% 75%"}: Just in time.');
    expect((await edit({ action: 'move_balloon', balloon: 3, space: 'page', at: { x: 40, y: 40 } })).error).toMatch(/fractions of the page: x and y from 0 to 1/);

    // Held inside its panel, as a drag is.
    const held = await edit({ action: 'move_balloon', balloon: 3, at: { x: 50, y: 0 } });
    expect(held).toMatchObject({ changed: true, clamped: true, at: { x: 50 } });
    expect(held.at.y).toBeGreaterThan(0);
    comic = await inspect();
    expect(comic.balloons[2].box.y).toBeGreaterThanOrEqual(comic.panels[1].box.y - 0.0001);

    expect(await edit({ action: 'unpin_balloon', balloon: 3 })).toMatchObject({ changed: true, lines: [{ line: 14, text: 'tomas: Just in time.' }] });
    expect(get().markdown).toBe(PAGE);
    expect(await edit({ action: 'unpin_balloon', balloon: 3 })).toMatchObject({ ok: true, changed: false, note: 'Balloon 3 is not pinned: its line writes no at.' });
    expect((await edit({ action: 'move_balloon', balloon: 7, at: { x: 1, y: 1 } })).error).toBe('Comic 1 has 4 balloon(s); balloon 7 is not one of them.');
    expect((await edit({ action: 'move_balloon', balloon: 3 })).error).toMatch(/move_balloon needs "at"/);
  });

  it('say what a balloon covers where it lands', async () => {
    const { edit, inspect, line } = comics();
    // On Maya's face, in percent of the picture as the resource marks it.
    const face = await edit({ action: 'move_balloon', balloon: 2, at: { x: 70, y: 55 } });
    expect(face).toMatchObject({ changed: true, at: { x: 70, y: 55 }, issues: ['It covers a face.'] });
    expect(line(12)).toBe('maya{at="70% 55%"}: Grandpa! I\'m here!');
    // The pin is a point of the picture, not of the panel that crops it.
    const comic = await inspect();
    const { picture } = comic.panels[0];
    expect(comic.balloons[1].box.x + comic.balloons[1].box.width / 2).toBeCloseTo(picture.x + 0.7 * picture.width, 3);
    const corner = await edit({ action: 'move_balloon', balloon: 2, at: { x: 20, y: 85 } });
    expect(corner.issues).toEqual(['It covers a part of the picture kept clear.']);
    expect((await edit({ action: 'move_balloon', balloon: 2, at: { x: 30, y: 30 } })).issues).toBeUndefined();
  });

  it('move balloons joined in one outline together, and warn of a letterboxed picture', async () => {
    const joined = PAGE.replace('tomas: Just in time.', "tomas: Just in time. The radio's gone deaf,\ntomas: and there's a storm on the way.");
    const safe: Resource = { ...room, safeArea: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } };
    const { edit, inspect, line, host } = comics(joined);
    host.store.dispatch({ type: 'SET_RESOURCES', payload: [safe] });
    const before = await inspect();
    expect(before.balloons.map((b: Answer) => b.joined)).toEqual([undefined, undefined, [3, 4], [3, 4], undefined]);
    expect(before.balloons[3].tail).toBeUndefined();
    // The second balloon of the group named: the pin goes on the first.
    const moved = await edit({ action: 'move_balloon', balloon: 4, at: { x: 50, y: 60 } });
    expect(moved).toMatchObject({ changed: true, balloon: 3 });
    expect(line(14)).toMatch(/^tomas\{at="[\d.]+% [\d.]+%"\}: Just in time\./);
    expect(line(15)).toBe("tomas: and there's a storm on the way.");
    const after = await inspect();
    expect(after.balloons[3].centre.y).toBeCloseTo(60, 0);
    expect(after.balloons[2].box.y).toBeGreaterThan(before.balloons[2].box.y);
    // Its tail is the group's, carried by the first balloon.
    expect(await edit({ action: 'move_tail', balloon: 4, to: { x: 10, y: 90 } })).toMatchObject({ changed: true, balloon: 3, to: { x: 10, y: 90 } });
    expect(await edit({ action: 'unpin_balloon', balloon: 4 })).toMatchObject({ changed: true, balloon: 3 });
    expect(line(14)).toBe('tomas{to="10% 90%"}: Just in time. The radio\'s gone deaf,');

    // A tier too flat for the picture's safe area.
    expect(await edit({ action: 'move_splitter', splitter: 1, start: 8 })).toMatchObject({ changed: true, start: 8, letterboxed: [1] });
    expect((await edit({ action: 'move_splitter', splitter: 1, start: 40 })).letterboxed).toBeUndefined();
  });

  it('turn a sound effect, and nothing else', async () => {
    const { edit, inspect, line } = comics();
    expect(await edit({ action: 'rotate', balloon: 4, degrees: -8 })).toMatchObject({ changed: true, balloon: 4, rotate: -8, lines: [{ line: 15, text: 'sfx{rotate=-8}: KRAK' }] });
    expect((await inspect()).balloons[3]).toMatchObject({ kind: 'sfx', rotate: -8 });
    // The same angle, written the other way round.
    expect(await edit({ action: 'rotate', balloon: 4, degrees: 352 })).toMatchObject({ changed: false, rotate: -8 });
    await edit({ action: 'rotate', balloon: 4, degrees: 0 });
    expect(line(15)).toBe('sfx{rotate=0}: KRAK');
    expect((await edit({ action: 'rotate', balloon: 3, degrees: 10 })).error).toBe('Only a sound effect turns (a script line whose key is sfx); balloon 3 is a balloon.');
    expect((await edit({ action: 'rotate', balloon: 4 })).error).toMatch(/rotate needs "degrees"/);
  });

  it('aim a tail, and point it back at its speaker', async () => {
    const { edit, inspect, line, get } = comics();
    const aimed = await edit({ action: 'move_tail', balloon: 2, to: { x: 30, y: 80 } });
    expect(aimed).toMatchObject({ changed: true, balloon: 2, to: { x: 30, y: 80 }, lines: [{ line: 12, text: 'maya{to="30% 80%"}: Grandpa! I\'m here!' }] });
    expect((await inspect()).balloons[1].tail).toMatchObject({ to: { x: 30, y: 80 } });
    expect(await edit({ action: 'move_tail', balloon: 2, to: { x: 30, y: 80 } })).toMatchObject({ changed: false, note: 'The tail already aims there.' });
    // A target off the picture is kept on it.
    expect(await edit({ action: 'move_tail', balloon: 2, to: { x: 130, y: 50 } })).toMatchObject({ changed: true, clamped: true, to: { x: 100, y: 50 } });
    expect(line(12)).toBe('maya{to="100% 50%"}: Grandpa! I\'m here!');
    expect(await edit({ action: 'reset_tail', balloon: 2 })).toMatchObject({ changed: true, balloon: 2 });
    expect(get().markdown).toBe(PAGE);
    expect(await edit({ action: 'reset_tail', balloon: 2 })).toMatchObject({ ok: true, changed: false });
    expect((await edit({ action: 'move_tail', balloon: 1, to: { x: 30, y: 80 } })).error).toMatch(/Balloon 1 has no tail to aim/);
  });

  it("go through the viewers' edit history, so the reader's undo takes an edit back", async () => {
    const { edit, get } = comics();
    await edit({ action: 'move_balloon', balloon: 3, at: { x: 50, y: 50 } });
    await edit({ action: 'move_splitter', splitter: 1, start: 60 });
    expect(get().markdown).not.toBe(PAGE);
    expect(undoViewerEdit()).toBe(true);
    expect(get().markdown).toBe(PAGE.replace('tomas:', 'tomas{at="50% 50%"}:'));
    expect(undoViewerEdit()).toBe(true);
    expect(get().markdown).toBe(PAGE);
    expect(undoViewerEdit()).toBe(false);
  });

  it('leave text written outside a script line alone', async () => {
    const stray = PAGE.replace('tomas: Just in time.', 'Just in time.');
    const { edit, inspect, get } = comics(stray);
    expect((await inspect()).balloons[2]).toMatchObject({ balloon: 3, stray: true, source: 'Just in time.' });
    expect((await edit({ action: 'move_balloon', balloon: 3, at: { x: 50, y: 50 } })).error).toMatch(/Balloon 3 is text written outside a script line/);
    expect(get().markdown).toBe(stray);
  });

  it('work on the chapter named: a strip in the text, a spread over two pages', async () => {
    const { call, edit, inspect, line, get } = comics();
    const outline = await call('sandbox_inspect_comic', { chapter: 'Second' });
    expect(outline.comics).toMatchObject([
      { comic: 1, kind: 'page', line: 3, pages: [{ position: 2, side: 'left' }, { position: 3, side: 'right' }], panels: 3, splitters: 2, balloons: 3 },
      { comic: 2, kind: 'strip', line: 12, pages: [{ position: 4 }], panels: 2, splitters: 1, balloons: 2 },
    ]);
    // Each half of the spread lists the whole comic.
    expect((await call('sandbox_inspect_comic', { chapter: 2, position: 3 })).comics.map((c: Answer) => c.comic)).toEqual([1]);
    const spread = await inspect({ chapter: 2, comic: 1 });
    expect(spread.panels.map((p: Answer) => [p.panel, p.position])).toEqual([[1, 2], [2, 2], [3, 3]]);
    // The middle panel crosses the spine.
    expect(spread.panels[1].alsoOn).toMatchObject([{ position: 3 }]);
    expect(spread.splitters.map((s: Answer) => [s.position, s.start, s.range.start])).toEqual([[2, 33.3, [5, 61.7]], [3, 66.7, [38.3, 95]]]);
    expect(spread.panels[2]).toMatchObject({ canSplit: true, canMergeNext: false });

    expect(await edit({ chapter: 2, action: 'move_splitter', splitter: 2, start: 80 })).toMatchObject({ changed: true, chapter: 2, start: 80 });
    expect(line(3, 1)).toBe(':::page{spread split="* | 46.7 | 20"}');
    await edit({ chapter: 2, action: 'split_panel', panel: 3, direction: 'rows' });
    expect(line(3, 1)).toBe(':::page{spread split="* | 46.7 | 20 [* / *]"}');
    expect((await inspect({ chapter: 2, comic: 1 })).panels).toHaveLength(4);

    const strip = await inspect({ chapter: 2, comic: 2 });
    expect(strip.pages[0].frame.width).toBeLessThan(0.75);
    await edit({ chapter: 2, comic: 2, action: 'move_balloon', balloon: 2, at: { x: 50, y: 50 } });
    expect(get().chapters[1]!.markdown).toContain('ben{at="50% 50%"}: Strip two');
    // The chapter on screen is another one, untouched.
    expect(get().markdown).toBe(PAGE);
    expect((await edit({ chapter: 1, comic: 2, action: 'merge_panel', panel: 1 })).error).toMatch(/Chapter 1 has 1 comic\(s\)/);
  });

  it('answer with the pages the book came to', async () => {
    const { call } = comics();
    const done = await call('sandbox_edit_comic', { comic: 1, action: 'move_splitter', splitter: 1, start: 50 });
    expect(done).toMatchObject({ ok: true, changed: true, laidOut: false });
    expect(done.book.chapters.map((c: Answer) => c.title)).toEqual(['Storm', 'Second']);
    const noComic = await call('sandbox_edit_comic', { chapter: 2, comic: 1, action: 'bend' });
    expect(noComic.error).toMatch(/action must be one of "move_splitter"/);
  });
});
