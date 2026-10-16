import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend';
import { parseFontString } from '../fontString';

// #862: the tagged PDF of the stand-in for a textbook's page 8 (#855's
// fixture) reads the composed page's frames in Markdown order — the
// title, the running text, each box followed by its photo — whatever
// order the template's layers paint them in, and a `:::figure`'s labels
// as part of its figure's alternative text.

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

/** The fixture, read from the engine's tests as it is (outside this
 *  package's sources: a dynamic import the compiler does not follow). */
const FIXTURE = new URL('../../../postext/src/__tests__/composed/fixtures/page8.ts', import.meta.url).href;

interface Elem { type: string; alt?: string; kids: Elem[] }

function readElem(pdf: PDFDocument, ref: PDFRef): Elem {
  const dict = pdf.context.lookup(ref, PDFDict);
  const altObj = dict.get(PDFName.of('Alt'));
  const alt = altObj instanceof PDFHexString || altObj instanceof PDFString ? altObj.decodeText() : undefined;
  const elem: Elem = { type: (dict.get(PDFName.of('S')) as PDFName).decodeText(), ...(alt !== undefined ? { alt } : {}), kids: [] };
  const k = dict.get(PDFName.of('K'));
  for (const kid of k instanceof PDFArray ? k.asArray() : k ? [k] : []) {
    if (kid instanceof PDFRef) elem.kids.push(readElem(pdf, kid));
  }
  return elem;
}

/** An element as `Type(kid types)`, figures with their alternative text. */
const shape = (e: Elem): string => (e.type === 'Figure' ? `Figure[${e.alt}]` : `${e.type}(${e.kids.map(shape).join(' ')})`);

let root: Elem;

beforeAll(async () => {
  const { page8Fixture } = (await import(/* @vite-ignore */ FIXTURE)) as { page8Fixture: (l: 'en') => { markdown: string; config: PostextConfig; resources: Resource[] } };
  const fixture = page8Fixture('en');
  const markdown = fixture.markdown.replace(
    '::resource{id="foto-gasto" slot="gasto-fotos"}',
    [':::figure{resource="foto-gasto" slot="gasto-fotos"}', '::label[Rent]{at="20% 30%"}', '::label[Electricity]{at="70% 25%"}', '::label[Food]{at="50% 80%"}', ':::'].join('\n'),
  );
  const alt: Record<string, string> = { 'foto-dinero': 'A card payment', 'foto-gasto': 'A shopping basket', 'foto-ahorro': 'A piggy bank' };
  const resources = fixture.resources.map((r) => (alt[r.id] ? { ...r, altText: alt[r.id] } : r));
  const doc = buildDocument({ markdown, resources }, fixture.config);
  expect(doc.pages[0]!.composed?.frames.map((f) => f.layer)).toEqual([1, 1, 1, 2, 1, 2, 1, 2]);
  const bytes = await renderToPdf(doc, { fontProvider: async () => new Uint8Array(fontBytes), accessible: true });
  const pdf = await PDFDocument.load(bytes);
  const treeRoot = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  root = readElem(pdf, (treeRoot.get(PDFName.of('K')) as PDFArray).get(0) as PDFRef);
}, 60_000);

describe('the composed page 8 stand-in in the tagged PDF (#862)', () => {
  it('reads the frames in Markdown order, each photo after its box, not in layer order', () => {
    expect(root.kids.map(shape)).toEqual([
      // titulo: the tabbed title.
      'Div(H1())',
      // texto: the running text.
      'Div(H2() P() L(LI(Lbl() LBody()) LI(Lbl() LBody())))',
      // dinero (its tab is its title paragraph), then its photo.
      'Div(P() P() P())',
      'Div(Figure[A card payment])',
      'Div(P() P() L(LI(Lbl() LBody()) LI(Lbl() LBody()) LI(Lbl() LBody())))',
      'Div(Figure[A shopping basket (Rent, Electricity, Food)])',
      'Div(P() P())',
      'Div(Figure[A piggy bank])',
    ]);
  });

  it('leaves the decoration out of the structure', () => {
    const all = JSON.stringify(root);
    expect(all).not.toContain('banda');
    expect(root.kids.every((k) => k.type === 'Div')).toBe(true);
  });
});
