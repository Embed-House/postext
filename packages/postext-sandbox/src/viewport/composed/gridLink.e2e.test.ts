import { describe, expect, it } from 'vitest';
import { buildDocument, resolvePageTemplate, type VDTPage } from 'postext';
import { applyTextChanges } from '../../book/textChanges.js';
import { planFramesToGrid } from '../../templates/framesToGrid.js';
import { templateFrameOf } from '../../templates/instanceNames.js';
import { laidFrames } from '../../templates/pagePieces.js';
import { ONE_OFF_TEMPLATE, RESHAPE_CONFIG, RESHAPE_RESOURCES, oneOffPage } from '../../templates/reshape.fixture.js';
import { frameByName } from './frameHit.js';
import { frameAtCaret, frameClickTarget } from './frameLink.js';
import { frameMarksFor } from './frameOverlay.js';

// A grid's instances ↔ their items in the Markdown (#1065): a click on
// `foto[3]` puts the caret in the third card's piece, on `pie[3]` in the
// caption written inside it; the caret in a piece marks its instance.

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

const CARDS = ['foto1', 'pie1', 'foto2', 'pie2', 'foto3', 'pie3', 'foto4', 'pie4', 'foto5', 'pie5'];

describe('grid instances ↔ their items (#1065)', () => {
  const start = oneOffPage();
  const first = buildDocument({ markdown: start, resources: RESHAPE_RESOURCES }, RESHAPE_CONFIG);
  const laid = laidFrames(first, first.pages.findIndex((p) => p.composed), 'content')!;
  const plan = planFramesToGrid({ templates: [ONE_OFF_TEMPLATE], templateId: 'rio', frames: CARDS, laid, chapters: [{ id: 'c', markdown: start }] });
  if (!plan.ok) throw new Error(plan.reason);
  // The fourth card's caption is taken out: its pill has nothing yet.
  const MD = applyTextChanges(start, plan.chapters[0]!.changes).replace('\n\n:::frame{slot="pie"}\nThe dragonfly\n:::\n', '\n');
  const config = { ...RESHAPE_CONFIG, pageTemplates: plan.templates };
  const doc = buildDocument({ markdown: MD, resources: RESHAPE_RESOURCES }, config);
  const page = doc.pages.find((p) => p.composed) as VDTPage;
  const composed = page.composed!;
  const template = resolvePageTemplate(config, 'rio')!;

  it('names the instances on the page', () => {
    expect(composed.frames.map((f) => f.name)).toEqual(expect.arrayContaining(['foto[1]', 'pie[1]', 'foto[5]', 'pie[5]']));
    const marks = frameMarksFor(doc, page, { mode: 'design', markdown: MD, caret: null, selectedFrameId: null, writeHere: '', continues: '' });
    expect(marks.map((m) => m.text[0])).toContain('pie[3]');
  });

  it('puts the caret in the item clicked, and in the member written inside it', () => {
    const third = frameClickTarget(MD, composed, frameByName(page, 'foto[3]')!, template);
    expect(third?.kind).toBe('caret');
    if (third?.kind === 'caret') expect(MD.slice(third.offset).startsWith('::resource{id="foto-c"}')).toBe(true);
    const pill = frameClickTarget(MD, composed, frameByName(page, 'pie[3]')!, template);
    expect(pill?.kind).toBe('caret');
    if (pill?.kind === 'caret') expect(MD.slice(pill.offset).startsWith('The toad')).toBe(true);
  });

  it('writes an empty member inside its item', () => {
    const fourth = frameClickTarget(MD, composed, frameByName(page, 'pie[4]')!, template);
    expect(fourth?.kind).toBe('insert');
    if (fourth?.kind !== 'insert') return;
    const next = MD.slice(0, fourth.at) + fourth.insert + MD.slice(fourth.at);
    expect(next).toContain('::resource{id="foto-a"}\n\n:::frame{slot="pie"}\n\n:::\n:::\n');
  });

  it('finds the instance at the caret', () => {
    expect(frameAtCaret(MD, page, MD.indexOf('The otter'), undefined, template)?.name).toBe('pie[2]');
    expect(frameAtCaret(MD, page, MD.indexOf('::resource{id="foto-b"}\n\n:::frame{slot="pie"}\nThe kingfisher'), undefined, template)?.name).toBe('foto[5]');
  });

  it('opens the template frame of an instance or a module frame in the editor', () => {
    expect(templateFrameOf({ name: 'pie[3]', template: 'rio', configPath: '/pageTemplates/0/frames/2' }, plan.templates)).toEqual({ templateId: 'rio', frame: 'pie' });
    const templates = [...plan.templates, { id: 'caja', role: 'module' as const, frames: [{ name: 'nota' }] }];
    expect(templateFrameOf({ name: 'caja[1].nota', template: 'rio', configPath: '/pageTemplates/1/frames/0' }, templates)).toEqual({ templateId: 'caja', frame: 'nota' });
  });
});
