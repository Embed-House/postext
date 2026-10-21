import { describe, expect, it } from 'vitest';
import { resolvePageTemplate, templateFrameRects } from '../../index.js';
import { PAGE8_CONFIG } from './fixtures/page8.js';

// Millimetres as pixels (25.4 dpi): the boxes read in the template's units.
const ctx = {
  areas: {
    area: { x: 22, y: 24, width: 186, height: 242 },
    page: { x: 0, y: 0, width: 230, height: 288 },
    bleed: { x: -3, y: -3, width: 236, height: 294 },
  },
  dpi: 25.4,
  emPx: 4.2,
};

describe('templateFrameRects (#863)', () => {
  const template = resolvePageTemplate(PAGE8_CONFIG, 'tema-cajas')!;

  it('places every frame of the p. 8 template, anchors after what they anchor to', () => {
    const rects = templateFrameRects(template, ctx, () => 20);
    expect([...rects.keys()].sort()).toEqual(template.frames.map((f) => f.name).sort());
    const titulo = rects.get('titulo')!;
    expect(titulo.x).toBeCloseTo(18);
    expect(titulo.y).toBeCloseTo(22);
    expect(titulo.width).toBeCloseTo(170);
    // `texto` sits below the title, 4 mm in and 2 mm down.
    const texto = rects.get('texto')!;
    expect(texto.x).toBeCloseTo(22);
    expect(texto.y).toBeCloseTo(titulo.y + titulo.height + 2);
    // The picture frame of a box hangs from its top-right corner.
    const dinero = rects.get('dinero')!;
    const fotos = rects.get('dinero-fotos')!;
    expect(fotos.x + fotos.width).toBeCloseTo(dinero.x + dinero.width - 2);
  });

  it('gives an auto height a fifth of the area when no measure is given', () => {
    const rects = templateFrameRects(template, ctx);
    expect(rects.get('titulo')!.height).toBeCloseTo(242 / 5);
  });
});
