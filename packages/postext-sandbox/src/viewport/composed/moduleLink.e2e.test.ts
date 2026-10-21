import { describe, expect, it } from 'vitest';
import { buildDocument, resolvePageTemplate } from 'postext';
import type { PostextConfig, VDTPage } from 'postext';
import { frameByName } from './frameHit.js';
import { frameAtCaret, frameClickTarget } from './frameLink.js';
import { frameMarksFor } from './frameOverlay.js';
import { emptyFrameInsertion, pageSites, sitesOf } from './slotSource.js';

// Modules (#1062): the frames of a `:::module` are named `<module>.<slot>`
// on the page; a click on one finds its slot inside the module's block.

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });

const config: PostextConfig = {
  page: { width: mm(160), height: mm(220), margins: { top: mm(15), bottom: mm(15), left: mm(15), right: mm(15) } } as never,
  locale: 'en',
  pageTemplates: [
    { id: 'tema', frames: [{ name: 'titulo', takes: 'h1' }], groups: [{ name: 'cuerpo', modules: true, gap: mm(4), placement: { anchor: { to: '#titulo', edge: 'below' }, size: { width: 'fill', height: 'fill' } } }] },
    { id: 'nota', role: 'module', frames: [{ name: 'texto', width: mm(80) }, { name: 'extra', optional: true, width: mm(40), height: mm(10), placement: { anchor: { to: '#texto', edge: 'right-of' } } }] },
  ] as never,
};

const MD = [
  '::::page{template="tema"}',
  '# The river',
  '',
  ':::module{template="nota" name="a"}',
  ':::frame{slot="texto"}',
  'Words of the first note.',
  ':::',
  ':::',
  '',
  ':::module{template="nota"}',
  ':::frame{slot="texto"}',
  'Words of the second note.',
  ':::',
  ':::',
  '::::',
  '',
].join('\n');

describe('module frames ↔ their slots (#1062)', () => {
  const doc = buildDocument({ markdown: MD }, config);
  const page = doc.pages.find((p) => p.composed) as VDTPage;
  const composed = page.composed!;
  const template = resolvePageTemplate(config, 'tema', { modules: composed.modules })!;

  it('reads the slots of each module under its scoped name', () => {
    expect(composed.frames.map((f) => f.name)).toEqual(['titulo', 'a.texto', 'a.extra', 'nota[2].texto', 'nota[2].extra']);
    const sites = pageSites(MD, composed.sourceStart, composed.sourceEnd)!;
    expect(sites.modules.map((m) => m.name)).toEqual(['a', 'nota[2]']);
    expect(sitesOf(sites, 'a.texto')).toHaveLength(1);
    expect(sitesOf(sites, 'nota[2].texto')).toHaveLength(1);
  });

  it('puts the caret in the module frame clicked, and finds the frame at the caret', () => {
    const second = frameByName(page, 'nota[2].texto')!;
    const target = frameClickTarget(MD, composed, second, template);
    expect(target?.kind).toBe('caret');
    if (target?.kind !== 'caret') return;
    expect(MD.slice(target.offset).startsWith('Words of the second note.')).toBe(true);
    expect(frameAtCaret(MD, page, MD.indexOf('second note'))?.name).toBe('nota[2].texto');
    expect(frameAtCaret(MD, page, MD.indexOf('first note'))?.name).toBe('a.texto');
  });

  it('writes the slot of an empty module frame inside its module, by its own name', () => {
    const sites = pageSites(MD, composed.sourceStart, composed.sourceEnd)!;
    const ins = emptyFrameInsertion(MD, sites, 'a.extra');
    const next = MD.slice(0, ins.at) + ins.insert + MD.slice(ins.at);
    expect(next).toContain('Words of the first note.\n:::\n\n:::frame{slot="extra"}\n\n:::\n:::\n');
    const again = pageSites(next, composed.sourceStart, composed.sourceEnd + ins.insert.length)!;
    expect(sitesOf(again, 'a.extra')).toHaveLength(1);
  });

  it('marks the module frames in Design mode by their scoped names', () => {
    const marks = frameMarksFor(doc, page, { mode: 'design', markdown: MD, caret: null, selectedFrameId: 'cp0:a.texto', writeHere: '' } as never);
    expect(marks.find((m) => m.kind === 'selected')?.frame.name).toBe('a.texto');
  });
});
