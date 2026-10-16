import { describe, expect, it } from 'vitest';
import { buildDocument } from 'postext';
import type { PageTemplate, PostextConfig, VDTDocument, VDTPage } from 'postext';
import { updateFrame, updateTemplate } from './templateEdits';

// #859: what the template editor writes for continuation (the frame's
// "Content that does not fit goes to" and "Mark at the cut", the
// template's "Added pages use") is what the layout reads.

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
const TEMPLATES: PageTemplate[] = [
  { id: 'tema', frames: [{ name: 'titulo', takes: 'h1' }, { name: 'caja', height: mm(30), placement: { anchor: { to: '#titulo', edge: 'below' } } }] },
  { id: 'sigue', frames: [{ name: 'caja' }] },
];
const MD = ['::::page{template="tema"}', '# El dinero', '', ':::frame{slot="caja"}', ...Array.from({ length: 8 }, (_, i) => [`Párrafo ${i} ${'palabra '.repeat(40).trim()}.`, '']).flat(), ':::', '::::', ''].join('\n');
const config = (templates: PageTemplate[]): PostextConfig => ({ locale: 'es', page: { width: mm(150), height: mm(200) } as never, pageTemplates: templates });
const build = (templates: PageTemplate[]): VDTDocument => buildDocument({ markdown: MD }, config(templates));
const composed = (doc: VDTDocument): VDTPage[] => doc.pages.filter((p) => p.composed);
const marks = (page: VDTPage): string[] => {
  const frame = page.composed!.frames.find((f) => f.name === 'caja')!;
  const box = page.floats!.find((b) => b.id === frame.blockIds[0])!;
  return (box.designOverlay?.blocks ?? []).flatMap((d) => (d.kind === 'text' ? [d.lines.map((l) => l.text).join(' ')] : []));
};

describe('the template editor drives continuation (#859)', () => {
  it('Nowhere: one page and a frameOverflow', () => {
    const doc = build(TEMPLATES);
    expect(composed(doc)).toHaveLength(1);
    expect((doc.contentWarnings ?? []).some((w) => w.kind === 'frameOverflow')).toBe(true);
  });

  it('A page added after this one: the same template again, the language’s mark', () => {
    const doc = build(updateFrame(TEMPLATES, 'tema', 'base', 'caja', { overflow: { continueIn: 'next-page' } }));
    const pages = composed(doc);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]!.composed!.template).toBe('tema');
    expect(marks(pages[0]!)).toContain('Continúa');
    expect((doc.contentWarnings ?? []).filter((w) => w.kind === 'frameOverflow')).toEqual([]);
  });

  it('Added pages use another template; the mark in my own words, or none', () => {
    let t = updateFrame(TEMPLATES, 'tema', 'base', 'caja', { overflow: { continueIn: 'next-page', mark: 'sigue' } });
    t = updateTemplate(t, 'tema', 'base', { overflowTemplate: 'sigue' });
    const doc = build(t);
    expect(composed(doc)[1]!.composed!.template).toBe('sigue');
    expect(marks(composed(doc)[0]!)).toContain('sigue');
    const none = build(updateFrame(t, 'tema', 'base', 'caja', { overflow: { continueIn: 'next-page', mark: false } }));
    expect(marks(composed(none)[0]!)).toEqual([]);
  });

  it('A page of a template', () => {
    const doc = build(updateFrame(TEMPLATES, 'tema', 'base', 'caja', { overflow: { continueIn: 'template:sigue' } }));
    expect(composed(doc).map((p) => p.composed!.template)).toEqual(['tema', ...composed(doc).slice(1).map(() => 'sigue')]);
  });
});
