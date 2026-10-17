import { describe, expect, it } from 'vitest';
import type { PostextConfig, Resource, VDTBlock, VDTDocument } from 'postext';
import { baseConfig, layOut } from './__tests__/vdt';
import { figureLabelsOverlay } from './labels';

// #955: the labels of a figure that the print draws as text, drawn over the
// picture of a reflowable book as one SVG in the picture's coordinates.

const resource = (extra: Partial<Resource> = {}): Resource => ({
  id: 'mapa', typeId: 'figure', kind: 'bitmap', altText: 'A map', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'mapa.png', format: 'png', width: 400, height: 300 },
  anchors: [
    { id: 'a', x: 0.2, y: 0.5, style: 'sea' },
    { id: 'b', x: 0.7, y: 0.3, style: 'plate' },
    { id: 'v', x: 0.5, y: 0.2, writingMode: 'vertical-rl' },
    { id: 'f', x: 0.5, y: 0.9 },
  ],
  ...extra,
});
const config: PostextConfig = {
  ...baseConfig,
  labelStyles: [
    { id: 'sea', halo: { color: { hex: '#ffffff', model: 'hex' }, width: { value: 1, unit: 'px' } } },
    { id: 'plate', background: { hex: '#ffeecc', model: 'hex' }, padding: { value: 2, unit: 'px' } },
  ],
};
const figure = (...labels: string[]) => [':::figure{resource="mapa"}', ...labels, ':::', ''].join('\n');
const block = (doc: VDTDocument): VDTBlock => [...doc.blocks, ...doc.pages.flatMap((p) => p.floats ?? [])].find((b) => b.resourceBlock?.resource.id === 'mapa')!;
const overlay = (md: string, res = resource(), cfg = config): string | undefined => figureLabelsOverlay(block(layOut(md, cfg, [res])).resourceBlock!);

describe('the labels drawn over a picture in the reflowable EPUB (#955)', () => {
  it('draws a label as text at its place, its words at the x the print measured', () => {
    const svg = overlay(figure('::label[Atlantic]{at="f"}'))!;
    expect(svg).toMatch(/^<svg class="pt-label-layer" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toMatch(/<g transform="matrix\(1 0 0 1 [\d.]+ [\d.]+\)"><text y="[\d.-]+" fill="#[0-9a-f]{6}"><tspan x="-?[\d.]+" font-size="[\d.]+" font-family="[^"]*">Atlantic<\/tspan>/);
  });

  it('strokes the halo under the text and fills the plate behind it', () => {
    const svg = overlay(figure('::label[Sea]{at="a"}', '::label[Plate]{at="b"}'))!;
    // The halo: the line twice, stroked then filled.
    expect(svg).toMatch(/stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/);
    expect(svg.match(/>Sea<\/tspan>/g)).toHaveLength(2);
    expect(svg).toMatch(/<rect [^>]*fill="#ffeecc"\/>/);
  });

  it('sets bold and italic words in their faces', () => {
    const svg = overlay(figure('::label[**Big** *slant*]{at="f"}'))!;
    expect(svg).toMatch(/font-weight="700"[^>]*>Big<\/tspan>/);
    expect(svg).toMatch(/font-style="italic"[^>]*>slant<\/tspan>/);
  });

  it('turns a label by the anchor’s rotation', () => {
    const rotated = resource({ anchors: [{ id: 'a', x: 0.2, y: 0.5, rotate: 90 }] });
    expect(overlay(figure('::label[Turned]{at="a"}'), rotated)).toMatch(/<g transform="matrix\(0 1 -1 0 /);
  });

  it('leaves a vertical label, which an SVG text sets differently, to the list', () => {
    expect(overlay(figure('::label[縦書き]{at="v"}'))).toBeUndefined();
    const svg = overlay(figure('::label[Atlantic]{at="a"}', '::label[縦書き]{at="v"}'))!;
    expect(svg).toContain('Atlantic');
    expect(svg).not.toContain('縦書き');
  });

  it('draws over the whole picture past a safe area the print crops to', () => {
    const cropped = resource({ safeArea: { x: 0.1, y: 0.1, width: 0.6, height: 0.6 } });
    const doc = layOut(figure('::label[Atlantic]{at="a"}'), config, [cropped]);
    const rb = block(doc).resourceBlock!;
    const svg = figureLabelsOverlay(rb)!;
    const [x, y, w, h] = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg)!.slice(1).map(Number) as [number, number, number, number];
    if (rb.bodySource) {
      // The viewBox is the picture's box in the body's coordinates.
      expect(w / h).toBeCloseTo(400 / 300, 1);
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
    } else expect([x, y]).toEqual([0, 0]);
  });

  it('is nothing for a figure with no label, or one that is not a picture', () => {
    expect(overlay(figure())).toBeUndefined();
  });
});
