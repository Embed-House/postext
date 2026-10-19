import { describe, expect, it } from 'vitest';
import { buildDocument, resolvePageTemplate } from 'postext';
import type { PostextConfig, VDTDocument, VDTPage } from 'postext';
import { frameByName, frameHitAt, frameIsEmpty } from './frameHit';
import { chainHeadOf, frameAtCaret, frameClickTarget } from './frameLink';
import { frameMarksFor } from './frameOverlay';

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
const pt = (value: number) => ({ value, unit: 'pt' as const });

const config: PostextConfig = {
  page: { width: mm(160), height: mm(220), margins: { top: mm(15), bottom: mm(15), left: mm(15), right: mm(15) } } as never,
  locale: 'es',
  calloutStyles: [{
    id: 'caja',
    backgroundEnabled: true,
    background: { hex: '#d8ecf9', model: 'hex' },
    border: { enabled: false },
    padding: { top: mm(3), right: mm(3), bottom: mm(3), left: mm(3) },
    label: { position: 'top-left', background: { hex: '#ffffff', model: 'hex' }, color: { hex: '#231f20', model: 'hex' }, fontSize: pt(11), height: mm(6), paddingX: mm(2), offset: mm(6), inset: mm(0) },
  } as never],
  pageTemplates: [{
    id: 'tema',
    frames: [
      { name: 'titulo', takes: 'h1', width: mm(120) },
      { name: 'texto', flow: true, width: mm(120), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(2) } } },
      { name: 'caja', style: 'caja', width: mm(120), height: mm(40), next: 'sigue', placement: { anchor: { to: '#texto', edge: 'below' }, offset: { y: mm(12) } } },
      { name: 'sigue', width: mm(120), height: mm(30), placement: { anchor: { to: '#caja', edge: 'below' }, offset: { y: mm(4) } } },
      { name: 'vacio', width: mm(60), height: mm(20), placement: { anchor: { to: 'container', edge: 'bottom-left' } } },
    ],
  }] as never,
};

const MD = [
  'Antes de la página.',
  '',
  '::::page{template="tema"}',
  '# El dinero',
  '',
  'Cada familia necesita alimentos y ropa.',
  '',
  ':::frame{slot="caja" label="Para qué sirve"}',
  'El dinero nos deja cambiar nuestro trabajo por cosas.',
  ':::',
  '::::',
  '',
].join('\n');

function composedPage(doc: VDTDocument): VDTPage {
  const page = doc.pages.find((p) => p.composed);
  if (!page) throw new Error('no composed page');
  return page;
}

describe('frame ↔ slot on a laid-out composed page', () => {
  const doc = buildDocument({ markdown: MD }, config);
  const page = composedPage(doc);
  const composed = page.composed!;
  const template = resolvePageTemplate(config, 'tema')!;

  it('lays the page with its frames', () => {
    expect(composed.frames.map((f) => f.name)).toEqual(['titulo', 'texto', 'caja', 'sigue', 'vacio']);
    expect(frameIsEmpty(frameByName(page, 'vacio')!)).toBe(true);
    expect(frameIsEmpty(frameByName(page, 'caja')!)).toBe(false);
  });

  it('a click on a frame finds it, and its slot holds the caret target', () => {
    const caja = frameByName(page, 'caja')!;
    const hit = frameHitAt(page, caja.rect.x + caja.rect.width - 2, caja.rect.y + caja.rect.height - 2);
    expect(hit?.name).toBe('caja');
    const target = frameClickTarget(MD, composed, hit!, template);
    expect(target).toEqual({ kind: 'caret', offset: MD.indexOf('El dinero nos deja'), slot: 'caja' });
  });

  it('a frame a chain continues into goes to the chain head', () => {
    expect(chainHeadOf(template, 'sigue')).toBe('caja');
    const target = frameClickTarget(MD, composed, frameByName(page, 'sigue')!, template);
    expect(target?.slot).toBe('caja');
  });

  it('a takes frame goes to its heading; the flow frame to its paragraph', () => {
    const titulo = frameClickTarget(MD, composed, frameByName(page, 'titulo')!, template);
    expect(titulo).toMatchObject({ kind: 'caret', slot: 'titulo' });
    expect(MD.slice((titulo as { offset: number }).offset).startsWith('# El dinero')).toBe(true);
    const texto = frameClickTarget(MD, composed, frameByName(page, 'texto')!, template);
    expect(MD.slice((texto as { offset: number }).offset).startsWith('Cada familia')).toBe(true);
  });

  it('an empty frame gets an empty slot fence to write in', () => {
    const target = frameClickTarget(MD, composed, frameByName(page, 'vacio')!, template);
    expect(target?.kind).toBe('insert');
    const t = target as Extract<typeof target, { kind: 'insert' }>;
    const next = MD.slice(0, t.at) + t.insert + MD.slice(t.at);
    expect(next).toContain(':::frame{slot="vacio"}\n\n:::\n::::');
    // Laid out again, the caret is in the new slot and the frame is found from it.
    const doc2 = buildDocument({ markdown: next }, config);
    const page2 = composedPage(doc2);
    expect(frameAtCaret(next, page2, t.caret)?.name).toBe('vacio');
  });

  it('the caret in a slot names its frame', () => {
    expect(frameAtCaret(MD, page, MD.indexOf('nos deja'))?.name).toBe('caja');
    expect(frameAtCaret(MD, page, MD.indexOf(':::frame{slot="caja"') + 3)?.name).toBe('caja');
    expect(frameAtCaret(MD, page, MD.indexOf('Cada familia') + 2)?.name).toBe('texto');
    expect(frameAtCaret(MD, page, MD.indexOf('Antes'))).toBeNull();
  });

  it('the label tab maps back to the fence label, to be selected and edited in place', () => {
    const caja = frameByName(page, 'caja')!;
    // The tab rises above the box's top-left corner.
    const box = page.floats!.find((b) => b.id === caja.blockIds[0])!;
    const tab = box.designOverlay!.blocks.find((b) => b.kind === 'text')!;
    expect(tab.kind === 'text' && tab.attr).toBe('label');
    expect(tab.kind === 'text' && MD.slice(tab.sourceStart, tab.sourceEnd)).toBe('Para qué sirve');
  });

  it('marks the empty frames, the caret\'s frame, and every frame in Design mode', () => {
    const base = { markdown: MD, caret: null, selectedFrameId: null, writeHere: 'Write here', continues: 'Continues __frame__' };
    const content = frameMarksFor(doc, page, { ...base, mode: 'content' });
    const marks = content.map((m) => `${m.kind}:${m.frame.name}:${m.text.join('|')}`);
    expect(marks).toContain('empty:vacio:vacio|Write here');
    // A frame a chain continues into never asks to be written in.
    const sigue = frameByName(page, 'sigue')!;
    expect(marks.filter((m) => m.startsWith('empty:sigue'))).toEqual(frameIsEmpty(sigue) ? ['empty:sigue:sigue|Continues caja'] : []);
    const inBox = frameMarksFor(doc, page, { ...base, mode: 'content', caret: MD.indexOf('nos deja') });
    expect(inBox.find((m) => m.kind === 'active')?.frame.name).toBe('caja');
    const design = frameMarksFor(doc, page, { ...base, mode: 'design', selectedFrameId: 'cp0:texto' });
    expect(design.map((m) => m.kind)).toEqual(['outline', 'selected', 'outline', 'outline', 'outline']);
  });
});

describe('a page added by continuation (#859)', () => {
  const long = MD.replace('El dinero nos deja cambiar nuestro trabajo por cosas.', Array.from({ length: 12 }, (_, i) => `Párrafo ${i} ${'palabra '.repeat(40).trim()}.`).join('\n\n'));
  const cont = { ...config, pageTemplates: [{ ...(config.pageTemplates![0] as object), frames: (config.pageTemplates![0] as { frames: { name: string }[] }).frames.map((f) => (f.name === 'sigue' ? { ...f, overflow: { continueIn: 'next-page' } } : f)) }] } as PostextConfig;
  const doc = buildDocument({ markdown: long }, cont);
  const pages = doc.pages.filter((p) => p.composed);

  it('marks no empty frame to write in, and a click on its box goes to the slot that sent it', () => {
    expect(pages.length).toBeGreaterThan(1);
    const added = pages[1]!;
    expect(added.composed!.continuationOf).toBe(pages[0]!.index);
    const base = { markdown: long, caret: null, selectedFrameId: null, writeHere: 'Write here', continues: 'Continues __frame__' };
    expect(frameMarksFor(doc, added, { ...base, mode: 'content' }).filter((m) => m.kind === 'empty')).toEqual([]);
    const sigue = frameByName(added, 'sigue')!;
    expect(sigue.id).toBe('cp0:sigue~1');
    expect(frameIsEmpty(sigue)).toBe(false);
    const template = resolvePageTemplate(doc.config as never, added.composed!.template);
    expect(frameClickTarget(long, added.composed!, sigue, template)).toMatchObject({ kind: 'caret', slot: 'caja' });
  });
});
