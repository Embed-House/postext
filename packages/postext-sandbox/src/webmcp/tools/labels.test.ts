import { describe, expect, it } from 'vitest';
import { MAP_NOTES_CONFIG, MAP_NOTES_MARKDOWN, MAP_NOTES_RESOURCES } from '../../templates/mapNotes.fixture';
import { chapter, harness } from './testHarness';

// #1064: sandbox_edit_labels does what the anchor editor, the symbol picker
// and a frame's pointers do; sandbox_save_resource stores labelAt and leader.

const book = () => {
  const chapters = [chapter('a', 'Map', MAP_NOTES_MARKDOWN)];
  return { chapters, markdown: chapters[0]!.markdown, activeChapterId: 'a', config: MAP_NOTES_CONFIG, resources: MAP_NOTES_RESOURCES };
};

describe('sandbox_edit_labels (#1064)', () => {
  it('writes a label\'s own leader into the text, one step of the history', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_edit_labels', { action: 'leader', resource: 'island', anchor: 'scale', leader: 'off', wait: false });
    expect(done).toMatchObject({ labels: 1, changed: 1 });
    expect(get().markdown).toContain('::label[0 — 10 km]{at="scale" leader="none"}');
    await call('sandbox_edit_labels', { action: 'leader', resource: 'island', text: 'Black Hills', leader: 'on', wait: false });
    expect(get().markdown).toContain('::label[Black Hills]{at="hills" leader}');
    await call('sandbox_undo', {});
    expect(get().markdown).toContain('::label[Black Hills]{at="hills"}');
    expect((await call('sandbox_edit_labels', { action: 'leader', resource: 'island', anchor: 'nowhere', leader: 'on' })).error).toMatch(/Its labels stand at: title, legend, scale, hills, pond/);
  });

  it('writes a symbol at the start of a label, as a key\'s row', async () => {
    const { call, get } = harness(book());
    const done = await call('sandbox_edit_labels', { action: 'icon', resource: 'island', anchor: 'hills', icon: { glyph: '▲' }, alt: 'Hills', color: '#8a6a4a', wait: false });
    expect(done.directive).toBe(':icon[Hills]{glyph="▲" color="#8a6a4a"}');
    expect(get().markdown).toContain('::label[:icon[Hills]{glyph="▲" color="#8a6a4a"} Black Hills]{at="hills"}');
    expect((await call('sandbox_edit_labels', { action: 'icon', resource: 'island', anchor: 'hills', icon: {} })).error).toMatch(/resource \(a picture id\), glyph/);
  });

  it('adds, changes and removes a pointer from a note to an anchor of the map', async () => {
    const { call, get } = harness(book());
    const added = await call('sandbox_edit_labels', { action: 'pointer', template: 'parts', from: 'n1', toFrame: 'map', anchor: 'title', wait: false });
    expect(added.pointer).toBe('pointer-n1-title');
    expect(added.pointers).toEqual([{ id: 'pointer-n1-title', from: 'n1', toFrame: 'map', anchor: 'title' }]);
    const tpl = () => get().config.pageTemplates!.find((t) => t.id === 'parts')!;
    expect(tpl().frames!.find((f) => f.name === 'map')!.layer).toBeUndefined();
    await call('sandbox_edit_labels', { action: 'pointer', template: 'parts', id: 'pointer-n1-title', from: 'n1', toFrame: 'map', anchor: 'legend', wait: false });
    expect(tpl().decoration!.elements[0]).toMatchObject({ kind: 'connector', to: { to: '#map', anchor: 'legend' } });
    const removed = await call('sandbox_edit_labels', { action: 'pointer', template: 'parts', id: 'pointer-n1-title', remove: true, wait: false });
    expect(removed.pointers).toEqual([]);
    expect((await call('sandbox_edit_labels', { action: 'pointer', template: 'nope', from: 'n1', toFrame: 'map', anchor: 'x' })).error).toMatch(/No page template "nope"\. The book has: parts/);
  });
});

describe('a label away from its point through sandbox_save_resource (#1064)', () => {
  it('stores labelAt and leader with the anchor, and refuses a malformed one', async () => {
    const { call, get } = harness(book());
    const anchors = MAP_NOTES_RESOURCES[0]!.anchors!.map((a) => (a.id === 'hills' ? { ...a, labelAt: { x: 0.62, y: 0.6 }, leader: { routing: 'elbow' } } : a));
    const done = await call('sandbox_save_resource', { id: 'island', marks: { anchors }, wait: false });
    expect(done.ok).toBe(true);
    expect(get().resources.find((r) => r.id === 'island')!.anchors!.find((a) => a.id === 'hills')).toMatchObject({ labelAt: { x: 0.62, y: 0.6 }, leader: { routing: 'elbow' } });
    const bad = await call('sandbox_save_resource', { id: 'island', marks: { anchors: [{ id: 'x', x: 0.1, y: 0.1, labelAt: { x: 'a', y: 0 } }] }, wait: false });
    expect(bad.ok).not.toBe(true);
  });
});
