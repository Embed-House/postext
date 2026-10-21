import { describe, expect, it } from 'vitest';
import type { LabelStyle, Resource } from 'postext';
import type { SandboxAction } from '../context/SandboxContext.js';
import { applyLabelStyleRename } from './applyRename.js';

const STYLES: LabelStyle[] = [{ id: 'city' } as LabelStyle, { id: 'river' } as LabelStyle];
const RESOURCES = [
  { id: 'map', anchors: [{ id: 'a', x: 0, y: 0, style: 'city' }, { id: 'b', x: 0, y: 0, style: 'river' }] },
  { id: 'other', anchors: [{ id: 'c', x: 0, y: 0 }] },
] as unknown as Resource[];
const CHAPTERS = [
  { id: 'one', markdown: ':::figure{resource="map"}\n::label[Madrid]{at="a" style="city"}\n:::\n' },
  { id: 'two', markdown: 'No labels here.\n' },
];

describe('renaming a label style (#994)', () => {
  it('rewrites the label lines and the anchors that name it, then the design, in that order', () => {
    const actions: SandboxAction[] = [];
    const done = applyLabelStyleRename((a) => actions.push(a), STYLES, 'city', 'town', { chapters: CHAPTERS, resources: RESOURCES, activeChapterId: 'two' });
    expect(done).toEqual({ anchors: 1, resources: 1, lines: 1, chapters: 1 });
    expect(actions.map((a) => a.type)).toEqual(['EDIT_CHAPTER_MARKDOWN', 'UPSERT_RESOURCE', 'UPDATE_CONFIG']);
    const edit = actions[0] as Extract<SandboxAction, { type: 'EDIT_CHAPTER_MARKDOWN' }>;
    expect(edit.payload.chapterId).toBe('one');
    expect(edit.payload.changes).toHaveLength(1);
    expect(edit.payload.changes[0]!.insert).toBe('town');
    const resource = (actions[1] as Extract<SandboxAction, { type: 'UPSERT_RESOURCE' }>).payload;
    expect(resource.id).toBe('map');
    expect(resource.anchors!.map((a) => a.style)).toEqual(['town', 'river']);
    const config = actions[2] as Extract<SandboxAction, { type: 'UPDATE_CONFIG' }>;
    expect(config.payload.labelStyles!.map((s) => s.id)).toEqual(['town', 'river']);
    expect(config.history).toEqual({ merge: false });
  });

  it('writes only the design when nothing names the style', () => {
    const actions: SandboxAction[] = [];
    const done = applyLabelStyleRename((a) => actions.push(a), STYLES, 'river', 'brook', { chapters: [CHAPTERS[1]!], resources: [RESOURCES[1]!] });
    expect(done).toEqual({ anchors: 0, resources: 0, lines: 0, chapters: 0 });
    expect(actions.map((a) => a.type)).toEqual(['UPDATE_CONFIG']);
  });
});
