// The overlap checks of composed pages, for an agent (#1066):
// sandbox_get_warnings lists frameCovered and frameOutsideArea with what
// the check measured and their fixes, numbered; sandbox_apply_proposal makes
// one (the one-click fix of the Checks and Reflow panels) and says whether
// the check is gone; a repeating grid given too many items is listed too.

// @ts-expect-error -- a Node built-in: the package compiles without @types/node.
import { readFileSync as readFile } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { PostextConfig, Resource } from 'postext';
import { setActiveHistory } from '../../history/sandboxHistory.js';
import { resetViewerEdits } from '../../editor/viewerEdits.js';
import { chapter, harness } from './testHarness.js';

const readFileSync = readFile as (path: URL, encoding: 'utf8') => string;
const DIR = new URL('../../../../postext/src/__tests__/composed/fixtures/overlap/', import.meta.url);
const CONFIG = JSON.parse(readFileSync(new URL('config.json', DIR), 'utf8')) as PostextConfig;
const MARKDOWN = readFileSync(new URL('overlap.md', DIR), 'utf8');
const RESOURCES: Resource[] = ([['chart', 1200, 600], ['photo', 900, 600], ['cutout', 720, 720]] as const).map(([id, width, height]) => ({
  id,
  typeId: 'pic',
  kind: 'bitmap' as const,
  caption: '',
  createdAt: 0,
  updatedAt: 0,
  bitmap: { fileId: `${id}.png`, format: 'png', width, height, resolution: 300 },
})) as Resource[];

afterEach(() => {
  setActiveHistory(null);
  resetViewerEdits();
});

function book(markdown = MARKDOWN, config: PostextConfig = structuredClone(CONFIG)) {
  const chapters = [chapter('ov', 'Overlaps', markdown)];
  return { chapters, activeChapterId: 'ov', markdown, config, resources: RESOURCES };
}

type Listed = { kind: string; frame?: string; page?: number; proposals?: { number: number; kind: string; words: string }[] } & Record<string, unknown>;

describe('sandbox_get_warnings on the overlap fixture', () => {
  it('lists the overlap checks with their data and fixes', async () => {
    const { call } = harness(book());
    const found = await call('sandbox_get_warnings');
    const listed = found.warnings as Listed[];
    const figure = listed.find((w) => w.kind === 'frameCovered' && w.frame === 'figure')!;
    expect(figure).toMatchObject({ category: 'typesetting', template: 'overlaps', coveredBy: 'photo', page: 1, locale: 'en', title: 'Frame under another frame' });
    expect(figure.overlapMm2).toBeGreaterThan(10);
    expect(figure.text).toMatch(/^Rainfall/);
    expect(figure.detail).toMatch(/lies under photo/);
    // Every move off the caption takes the photo out of the figure it is
    // anchored inside (#1075): no fix is offered but overlap: 'allow' on
    // the photo (#1081).
    expect(figure.proposals).toEqual([{ number: 1, kind: 'allowOverlap', words: 'set overlap: \'allow\' on "photo"' }]);
    const card = listed.find((w) => w.kind === 'frameCovered' && w.frame === 'card')!;
    expect(card.proposals).toEqual([
      { number: 1, kind: 'move', words: expect.stringMatching(/^move "cutout" [\d.]+ mm right$/) },
      { number: 2, kind: 'allowOverlap', words: 'set overlap: \'allow\' on "cutout"' },
    ]);
    const note = listed.find((w) => w.kind === 'frameOutsideArea' && w.frame === 'note')!;
    expect(note).toMatchObject({ past: 'frame', target: 'card', title: 'Frame runs past its edge' });
    expect((note.sides as { bottom: number }).bottom).toBeGreaterThan(10);
    expect(note.proposals!.map((p) => p.kind)).toEqual(['maxHeight', 'continueNextPage', 'minHeight', 'allowOverlap']);
    expect(listed.find((w) => w.kind === 'frameOutsideArea' && w.frame === 'strap')).toMatchObject({ past: 'trim' });
  });
});

describe('sandbox_apply_proposal on an overlap', () => {
  it('moves the covering frame off the tab; sandbox_undo takes it back', async () => {
    const { call, get } = harness(book());
    const before = get().config;
    const done = await call('sandbox_apply_proposal', { frame: 'card', proposal: 'move' });
    expect(done).toMatchObject({ ok: true, changed: true, check: 'frameCovered', fixed: true, fix: { kind: 'move' } });
    expect(done.settings[0]).toMatchObject({ pointer: '/pageTemplates/0/frames/3/placement/offset', setting: 'overlaps › cutout › placement.offset' });
    const undone = await call('sandbox_undo');
    expect(undone).toMatchObject({ ok: true });
    expect(get().config).toEqual(before);
  });

  it('raises the card to hold the note, by number', async () => {
    const { call } = harness(book());
    const found = await call('sandbox_get_warnings');
    const note = (found.warnings as Listed[]).find((w) => w.kind === 'frameOutsideArea' && w.frame === 'note')!;
    const min = note.proposals!.find((p) => p.kind === 'minHeight')!;
    const done = await call('sandbox_apply_proposal', { frame: 'note', proposal: min.number });
    expect(done).toMatchObject({ ok: true, check: 'frameOutsideArea', fixed: true });
    expect(done.settings[0].pointer).toBe('/pageTemplates/0/frames/2/minHeight');
  });

  it('lets the covering frame overlap on purpose, the field the frame editor writes (#1081)', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_apply_proposal', { frame: 'figure', proposal: 'allowOverlap' });
    expect(done).toMatchObject({ ok: true, changed: true, check: 'frameCovered', fixed: true, fix: { kind: 'allowOverlap' } });
    expect(done.settings[0]).toMatchObject({ pointer: '/pageTemplates/0/frames/1/overlap', setting: 'overlaps › photo › overlap', value: '"allow"' });
    expect(get().config.pageTemplates![0]!.frames!.find((f) => f.name === 'photo')!.overlap).toBe('allow');
    // A frame past its edge on purpose: allowed on itself.
    const note = await call('sandbox_apply_proposal', { frame: 'note', proposal: 'allowOverlap' });
    expect(note).toMatchObject({ ok: true, check: 'frameOutsideArea', fixed: true });
    expect(note.settings[0].setting).toBe('overlaps › note › overlap');
  });

  it('reads and writes a frame\'s overlap as a setting', async () => {
    const { call } = harness(book());
    const done = await call('sandbox_set_config', { changes: [{ path: 'pageTemplates[id=overlaps].frames[name=strap].overlap', value: 'allow' }], wait: false });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    const read = await call('sandbox_get_config', { effective: true });
    expect(JSON.stringify(read.effective)).toContain('"overlap":"allow"');
    const found = await call('sandbox_get_warnings');
    expect((found.warnings as Listed[]).some((w) => w.kind === 'frameOutsideArea' && w.frame === 'strap')).toBe(false);
  });

  it('refuses a frame with no check, a check it does not have, and a fix it does not have', async () => {
    const { call } = harness(book());
    expect((await call('sandbox_apply_proposal', { frame: 'photo', proposal: 1 })).error).toMatch(/"photo" has no such check .* The frames with fixes: /);
    expect((await call('sandbox_apply_proposal', { frame: 'note', check: 'frameCovered', proposal: 1 })).error).toMatch(/"note" has no frameCovered check/);
    expect((await call('sandbox_apply_proposal', { frame: 'note', proposal: 'layer' })).error).toMatch(/No such fix for "note"\. Its fixes: 1\. maxHeight/);
  });
});

describe('sandbox_get_warnings on a grid given more items than it holds', () => {
  it('lists repeatOverflow with the grid, the item and the limit', async () => {
    const mm = (value: number) => ({ value, unit: 'mm' as const });
    const config: PostextConfig = {
      ...structuredClone(CONFIG),
      pageTemplates: [{
        id: 'cards',
        frames: [
          { name: 'main', width: mm(160), placement: { anchor: { to: 'container', edge: 'top-left' } } },
          { name: 'card', style: 'sticky', height: mm(30) },
        ],
        groups: [{ name: 'grid', kind: 'grid', columns: 2, repeat: { frames: ['card'], max: 2 }, placement: { anchor: { to: 'container', edge: 'bottom-left' } } }],
      } as unknown as NonNullable<PostextConfig['pageTemplates']>[number]],
    };
    const items = [1, 2, 3].map((n) => `:::frame{slot="card"}\nCard number ${n}.\n:::`).join('\n\n');
    const markdown = `::::page{template="cards"}\n:::frame{slot="main"}\nThe page's own text.\n:::\n\n${items}\n::::\n`;
    const { call } = harness(book(markdown, config));
    const found = await call('sandbox_get_warnings');
    const listed = (found.warnings as Listed[]).find((w) => w.kind === 'repeatOverflow');
    expect(listed).toMatchObject({ frame: 'card', group: 'grid', item: 3, max: 2, title: 'More items than the grid holds' });
  });
});

// #1089: a frame piece naming a look `frameLooks` lacks.
describe('sandbox_get_warnings on a frame piece naming an unknown look', () => {
  it('lists lookUnknown with the frame, the look and the nearest id', async () => {
    const config: PostextConfig = {
      ...structuredClone(CONFIG),
      frameLooks: [{ id: 'pill-1', background: { hex: '#e63946', model: 'hex' } }],
    };
    const markdown = '::::page{template="overlaps"}\n:::frame{slot="note" look="pill-01"}\nA note.\n:::\n::::\n';
    const { call } = harness(book(markdown, config));
    const found = await call('sandbox_get_warnings');
    const listed = (found.warnings as Listed[]).find((w) => w.kind === 'lookUnknown');
    expect(listed).toMatchObject({ frame: 'note', look: 'pill-01', suggestion: 'pill-1', title: 'A look the book does not have' });
    expect(listed!.detail).toMatch(/Did you mean pill-1\?/);
  });
});
