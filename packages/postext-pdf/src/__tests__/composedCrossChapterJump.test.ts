import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildBundle } from 'postext/bundle';
import type { PostextConfig } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #943: a story that jumps from one chapter to a page of a later one. The
// tagged PDF reads the rest where it stands, on its page, after what the
// page holds itself; the start stays in its own chapter's article.

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const face = fontkit.create(fontBytes);
class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const sizePx = parseFontString(this.font)?.sizePx ?? 16;
    return { width: (face.layout(s).advanceWidth / face.unitsPerEm) * sizePx };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const FIXTURE = new URL('../../../postext/src/__tests__/composed/fixtures/page8.ts', import.meta.url).href;

interface Elem { type: string; kids: Elem[] }

function readElem(pdf: PDFDocument, ref: PDFRef): Elem {
  const dict = pdf.context.lookup(ref, PDFDict);
  const elem: Elem = { type: (dict.get(PDFName.of('S')) as PDFName).decodeText(), kids: [] };
  const k = dict.get(PDFName.of('K'));
  for (const kid of k instanceof PDFArray ? k.asArray() : k ? [k] : []) {
    if (kid instanceof PDFRef) elem.kids.push(readElem(pdf, kid));
  }
  return elem;
}
const shape = (e: Elem): string => `${e.type}(${e.kids.map(shape).join(' ')})`;

const mm = (value: number) => ({ value, unit: 'mm' as const });
const top = { anchor: { to: 'container' as const, edge: 'top-left' as const } };
const para = (word: string, n: number): string => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

let root: Elem;

beforeAll(async () => {
  const { page8Fixture } = (await import(/* @vite-ignore */ FIXTURE)) as { page8Fixture: (l: 'es') => { config: PostextConfig } };
  const base = page8Fixture('es').config;
  const config: PostextConfig = {
    ...base,
    pageTemplates: [
      { id: 'articulo', header: false, frames: [{ name: 'cuerpo', style: 'caja-azul', flow: true, width: mm(186), height: mm(90), placement: top, overflow: { continueIn: 'page:{attr.sigue}' }, fit: { shrinkText: false } }] },
      { id: 'otra', header: false, frames: [{ name: 'texto', flow: true, width: mm(186), placement: top }] },
      { id: 'salto', header: false, frames: [{ name: 'breve', flow: true, width: mm(186), height: mm(40), placement: top }, { name: 'resto', style: 'caja-azul', width: mm(186), placement: { anchor: { to: '#breve', edge: 'below' }, offset: { y: mm(10) } } }] },
    ],
  };
  const chapters = [
    `::::page{template="articulo" sigue="p-salto"}\n${para('art', 900)}\n::::\n`,
    '# Otro capítulo\n\nTexto del otro capítulo.\n',
    `::::page{template="salto" id="p-salto"}\n${para('breve', 60)}\n::::\n\n::::page{template="otra"}\n- uno\n- dos\n::::\n`,
  ];
  const docs = buildBundle({ chapters: chapters.map((markdown) => ({ markdown })), config, resources: [] });
  const bytes = await renderToPdf(docs, { fontProvider: async () => new Uint8Array(fontBytes), accessible: true });
  const pdf = await PDFDocument.load(bytes);
  const treeRoot = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  root = readElem(pdf, (treeRoot.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef);
}, 60_000);

describe('a story that jumps to a page of a later chapter, tagged (#943)', () => {
  it('reads the start in its chapter and the rest on its page after what the page holds', () => {
    expect(root.kids.map(shape)).toEqual([
      // The article's start.
      'Div(P())',
      // The chapter between.
      'H1()',
      'P()',
      // The jump page: its own words, then the rest.
      'Div(P())',
      'Div(P())',
      // The page after it keeps its place after the rest.
      'Div(L(LI(Lbl() LBody()) LI(Lbl() LBody())))',
    ]);
  });
});
