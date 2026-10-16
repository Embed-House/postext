import { describe, expect, it } from 'vitest';
import { emptyFrameInsertion, flowInsertion, pageSites, siteCaret, sitesOf, slotAtOffset } from './slotSource';

const BEFORE = 'A paragraph before the page.\n\n';
const PAGE = [
  '::::page{template="tema-cajas" tema="Retos"}',
  '# El dinero',
  '',
  'Cada familia necesita alimentos.',
  '',
  ':::frame{slot="dinero" label="Para qué sirve el dinero"}',
  'El dinero nos deja cambiar.',
  '',
  ':::callout',
  'Dentro.',
  ':::',
  ':::',
  '',
  '::resource{id="foto-dinero" slot="dinero-fotos"}',
  '',
  ':::frame{slot="vacio"}',
  '',
  ':::',
  '::::',
].join('\n');
const MD = `${BEFORE}${PAGE}\n\nAfter.\n`;
const START = BEFORE.length;
const END = START + PAGE.length;

describe('pageSites', () => {
  const page = pageSites(MD, START, END)!;

  it('reads the page fence and its slots, with absolute offsets', () => {
    expect(page.start).toBe(START);
    expect(page.end).toBe(END);
    expect(MD.slice(page.closerStart, page.end)).toBe('::::');
    expect(page.sites.map((s) => `${s.kind}:${s.slot}`)).toEqual(['frame:dinero', 'block:dinero-fotos', 'frame:vacio']);
    const dinero = sitesOf(page, 'dinero')[0]!;
    expect(MD.slice(dinero.start, dinero.end)).toMatch(/^:::frame\{slot="dinero".*\n[\s\S]*\n:::$/);
    expect(MD.slice(dinero.contentStart, dinero.contentEnd)).toBe('El dinero nos deja cambiar.\n\n:::callout\nDentro.\n:::\n');
    expect(dinero.label!.text).toBe('Para qué sirve el dinero');
    expect(MD.slice(dinero.label!.start, dinero.label!.end)).toBe('Para qué sirve el dinero');
    const foto = sitesOf(page, 'dinero-fotos')[0]!;
    expect(MD.slice(foto.start, foto.end)).toBe('::resource{id="foto-dinero" slot="dinero-fotos"}');
  });

  it('keeps the unslotted text with its headings', () => {
    expect(page.unslotted.map((u) => MD.slice(u.start, u.end))).toEqual(['# El dinero', 'Cada familia necesita alimentos.']);
    expect(page.unslotted[0]!.heading).toBe(1);
  });

  it('tells the slot an offset is written in', () => {
    expect(slotAtOffset(page, MD.indexOf('nos deja'))?.slot).toBe('dinero');
    // The nested callout is part of the frame's slot.
    expect(slotAtOffset(page, MD.indexOf('Dentro'))?.slot).toBe('dinero');
    expect(slotAtOffset(page, MD.indexOf('foto-dinero'))?.slot).toBe('dinero-fotos');
    expect(slotAtOffset(page, MD.indexOf('Cada familia'))).toBeNull();
    expect(slotAtOffset(page, MD.indexOf('After'))).toBeNull();
  });

  it('puts the caret on the first line of a slot, or the blank line of an empty one', () => {
    const dinero = sitesOf(page, 'dinero')[0]!;
    expect(MD.slice(siteCaret(MD, dinero)).startsWith('El dinero nos deja')).toBe(true);
    const vacio = sitesOf(page, 'vacio')[0]!;
    expect(siteCaret(MD, vacio)).toBe(MD.indexOf(':::frame{slot="vacio"}\n') + ':::frame{slot="vacio"}\n'.length);
  });

  it('writes an empty slot fence before the closing fence', () => {
    const ins = emptyFrameInsertion(MD, page, 'nuevo');
    const next = MD.slice(0, ins.at) + ins.insert + MD.slice(ins.at);
    expect(next).toContain(':::\n\n:::frame{slot="nuevo"}\n\n:::\n::::');
    expect(next.slice(ins.caret, ins.caret + 4)).toBe('\n:::');
    const again = pageSites(next, START, END + ins.insert.length)!;
    expect(sitesOf(again, 'nuevo')).toHaveLength(1);
  });

  it('finds where the running text goes', () => {
    const ins = flowInsertion(MD, page);
    expect(ins.insert).toBe('');
    expect(MD.slice(0, ins.caret).endsWith('Cada familia necesita alimentos.')).toBe(true);
    const bare = '::::page{template="t"}\n:::frame{slot="a"}\n\n:::\n::::';
    const p2 = pageSites(bare, 0, bare.length)!;
    const f = flowInsertion(bare, p2);
    expect(f.insert).toBe('\n\n');
    expect(f.caret).toBe('::::page{template="t"}'.length + 1);
  });

  it('is null where no page fence opens', () => {
    expect(pageSites('Just text.', 0, 10)).toBeNull();
  });
});
