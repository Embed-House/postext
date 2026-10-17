import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build';
import { createMeasurementCache } from '../../measure';
import { formatWarning } from '../../pipeline/contentWarnings';
import { overlappingLabels, polygonPenetration } from '../../composed/labels';
import { contrastDocument, contrastPairs } from '../../contrast';
import { preflightDocument } from '../../preflight';
import type { ContentWarning, PostextConfig, Resource, VDTDocument } from '../../index';

// #902: checks on the labels of a figure (overlap, overflow).

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
    const em = m ? Number(m[1]) : 10;
    return { width: [...s].length * em * 0.5 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const mm = (value: number) => ({ value, unit: 'mm' as const });
const px = (value: number) => ({ value, unit: 'px' as const });
const PAGE: PostextConfig = {
  page: { width: mm(200), height: mm(260), margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } as never,
  bodyText: { fontSize: px(20) } as never,
  labelStyles: [
    { id: 'small', fontSize: px(10) },
    { id: 'tight', fontSize: px(10), minScale: 0.5 },
  ],
};
const MAP: Resource = {
  id: 'mapa', typeId: 'figure', kind: 'bitmap', altText: 'A map', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'mapa.png', format: 'png', width: 400, height: 300 },
  anchors: [
    { id: 'a', x: 0.2, y: 0.5, style: 'small' },
    // 8 px right of a: the two words (60 px wide at 10 px) meet.
    { id: 'b', x: 0.22, y: 0.5, style: 'small' },
    { id: 'far', x: 0.8, y: 0.2, style: 'small' },
    { id: 'below', x: 0.2, y: 0.5 + 12 / 300, style: 'small' },
    { id: 'narrow', x: 0.6, y: 0.8, width: 0.04, style: 'tight' },
    { id: 'wide', x: 0.5, y: 0.9, width: 0.5, style: 'small' },
  ],
};
const figure = (...labels: string[]) => [':::figure{resource="mapa"}', ...labels, ':::', ''].join('\n');
const MAP_B: Resource = { ...MAP, id: 'mapb' };
const build = (markdown: string, config: PostextConfig = {}): VDTDocument =>
  buildDocument({ markdown, resources: [MAP, MAP_B] }, { ...PAGE, ...config }, createMeasurementCache());
const kinds = (doc: VDTDocument, ...wanted: string[]) => (doc.contentWarnings ?? []).filter((w) => wanted.includes(w.kind));

describe('overlapping labels (#902)', () => {
  it('measures how far two convex shapes run into each other', () => {
    const square = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
    expect(polygonPenetration(square(0, 0, 10), square(8, 0, 10))).toBeCloseTo(2, 6);
    expect(polygonPenetration(square(0, 0, 10), square(10, 0, 10))).toBe(0);
    expect(polygonPenetration(square(0, 0, 10), square(30, 30, 4))).toBe(0);
    // A diamond (a square turned 45°) against a square.
    const diamond: [number, number][] = [[13, 5], [18, 10], [13, 15], [8, 10]];
    expect(polygonPenetration(square(0, 0, 10), diamond)).toBeGreaterThan(0);
  });

  it('reports the later of two labels whose words meet, with the earlier one it meets', () => {
    const md = figure('::label[Madrid]{at="a"}', '::label[Toledo]{at="b"}', '::label[Oslo]{at="far"}');
    const doc = build(md, { locale: 'es' } as PostextConfig);
    const found = kinds(doc, 'labelOverlap') as Extract<ContentWarning, { kind: 'labelOverlap' }>[];
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ resourceId: 'mapa', text: 'Toledo', anchor: 'b', with: 'Madrid', withAnchor: 'a', count: 1, locale: 'es', pageIndex: 0 });
    expect(md.slice(found[0]!.sourceStart, found[0]!.sourceEnd)).toBe('Toledo');
    expect(formatWarning(found[0]!)).toContain('runs into "Madrid"');
  });

  it('counts every earlier label a label meets', () => {
    const doc = build(figure('::label[Madrid]{at="a"}', '::label[Toledo]{at="b"}', '::label[Avila]{at="a"}'));
    const found = kinds(doc, 'labelOverlap') as Extract<ContentWarning, { kind: 'labelOverlap' }>[];
    expect(found.map((w) => [w.text, w.count])).toEqual([['Toledo', 1], ['Avila', 2]]);
  });

  it('is quiet for labels apart, touching, or on lines that leave each other free', () => {
    expect(kinds(build(figure('::label[Madrid]{at="a"}', '::label[Oslo]{at="far"}')), 'labelOverlap')).toEqual([]);
    // 12 px below: the next line box starts where the first ends (11.5 px).
    expect(kinds(build(figure('::label[Madrid]{at="a"}', '::label[Toledo]{at="below"}')), 'labelOverlap')).toEqual([]);
  });

  it('is checked in each edition: longer words in one language meet where the short ones do not', () => {
    const short = build(figure('::label[M]{at="a"}', '::label[T]{at="b"}'));
    const long = build(figure('::label[Madrid]{at="a"}', '::label[Toledo]{at="b"}'));
    expect(kinds(short, 'labelOverlap')).toEqual([]);
    expect(kinds(long, 'labelOverlap')).toHaveLength(1);
  });

  it('works on the labels of a layout directly', () => {
    const doc = build(figure('::label[Madrid]{at="a"}', '::label[Toledo]{at="b"}'));
    const block = [...doc.blocks, ...doc.pages.flatMap((p) => p.floats ?? [])].find((b) => b.resourceBlock?.resource.id === 'mapa')!;
    expect([...overlappingLabels(block.resourceBlock!.labels!)]).toEqual([[1, [0]]]);
  });
});

describe('labelOverflow (#902)', () => {
  it('reports a label still too wide for its measure at the smallest scale its style allows', () => {
    // 0.04 × 400 = 16 px for "Gibraltar" (45 px at 10 px): 0.5 is not enough.
    const md = figure('::label[Gibraltar]{at="narrow"}');
    const doc = build(md, { locale: 'en' } as PostextConfig);
    const found = kinds(doc, 'labelOverflow') as Extract<ContentWarning, { kind: 'labelOverflow' }>[];
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ resourceId: 'mapa', text: 'Gibraltar', anchor: 'narrow', widthPct: 4, scale: 0.5, locale: 'en', pageIndex: 0 });
    expect(md.slice(found[0]!.sourceStart, found[0]!.sourceEnd)).toBe('Gibraltar');
    expect(formatWarning(found[0]!)).toContain('minScale');
  });

  it('is quiet when the label fits, or fits once set smaller', () => {
    expect(kinds(build(figure('::label[Madrid]{at="wide"}')), 'labelOverflow')).toEqual([]);
  });
});

describe('part palettes recolour label styles (#902)', () => {
  const link = (id: string, hex: string) => ({ hex, model: 'hex' as const, paletteId: id });
  const palette = [
    { id: 'accent', name: 'Accent', value: { hex: '#00aa00', model: 'hex' as const } },
    { id: 'paper', name: 'Paper', value: { hex: '#ffeecc', model: 'hex' as const } },
    { id: 'ink', name: 'Ink', value: { hex: '#222222', model: 'hex' as const } },
  ];
  const config: PostextConfig = {
    colorPalette: palette,
    headings: { levels: [{ level: 1, breakBefore: { enabled: true, parity: 'any' } }] } as never,
    labelStyles: [
      { id: 'plate', fontSize: px(10), color: link('accent', '#00aa00'), halo: { color: link('paper', '#ffeecc'), width: px(1) }, background: link('paper', '#ffeecc'), padding: px(2) },
      { id: 'plain', fontSize: px(10) },
    ],
  };
  /** The labels of the first (`which` 0) or last figure of the book. */
  const labelsOf = (doc: VDTDocument, which: number) => {
    const found = doc.pages.flatMap((p) => [...p.columns.flatMap((c) => c.blocks), ...(p.floats ?? [])]).filter((b) => b.resourceBlock?.labels?.length);
    return (which === 0 ? found[0]! : found[found.length - 1]!).resourceBlock!.labels!;
  };

  it('gives a part’s pages the label colours its palette overrides', () => {
    const map = (id: string, res = 'mapa') => [`:::figure{resource="${res}"}`, `::label[Madrid]{at="${id}" style="plate"}`, ':::'].join('\n');
    const markdown = ['# Zero', '', map('a'), '', ':::part{number="II" title="Two" palette="accent=#f6c297,paper=#112233"}', ':::', '', '# One', '', map('a', 'mapb')].join('\n');
    const doc = build(markdown, config);
    const first = labelsOf(doc, 0)[0]!.layout!;
    const last = labelsOf(doc, 1)[0]!.layout!;
    expect(first.color).toBe('#00aa00');
    expect(first.background!.color).toBe('#ffeecc');
    expect(first.halo!.color).toBe('#ffeecc');
    expect(last.color.toLowerCase()).toBe('#f6c297');
    expect(last.background!.color.toLowerCase()).toBe('#112233');
    expect(last.halo!.color.toLowerCase()).toBe('#112233');
  });

  it('leaves a label that sets no colour of its own on the text colour', () => {
    const markdown = ['# Zero', '', ':::figure{resource="mapa"}', '::label[Madrid]{at="a" style="plain"}', ':::', '', ':::part{number="II" title="Two" palette="accent=#f6c297"}', ':::', '', '# One', '', ':::figure{resource="mapb"}', '::label[Madrid]{at="a" style="plain"}', ':::'].join('\n');
    const doc = build(markdown, { ...config, bodyText: { color: link('ink', '#222222') } as never });
    expect(labelsOf(doc, 1)[0]!.layout!.color.toLowerCase()).toBe('#222222');
  });
});

describe('label colours in the contrast check and the preflight (#902)', () => {
  const hex = (h: string) => ({ hex: h, model: 'hex' as const });
  const config: PostextConfig = {
    labelStyles: [
      // Pale text on a pale plate.
      { id: 'weak', fontSize: px(10), color: hex('#cfd8dc'), background: hex('#eceff1') },
      // Dark text on a white plate.
      { id: 'fine', fontSize: px(10), color: hex('#102a43'), background: hex('#ffffff') },
      // Pale text inside a dark halo: no plate.
      { id: 'halo', fontSize: px(10), color: hex('#ffffff'), halo: { color: hex('#102a43'), width: px(1) } },
      // Pale text on the picture, nothing under it we can read.
      { id: 'bare', fontSize: px(10), color: hex('#eeeeee') },
      // Small type in a process colour.
      { id: 'process', fontSize: px(4), color: hex('#336699') },
    ],
  };
  const MAP2: Resource = {
    ...MAP,
    anchors: [
      { id: 'w', x: 0.2, y: 0.2, style: 'weak' }, { id: 'f', x: 0.5, y: 0.2, style: 'fine' },
      { id: 'h', x: 0.2, y: 0.5, style: 'halo' }, { id: 'b', x: 0.5, y: 0.5, style: 'bare' },
      { id: 'p', x: 0.2, y: 0.8, style: 'process' },
    ],
  };
  const md = figure('::label[Weak]{at="w"}', '::label[Fine]{at="f"}', '::label[Halo]{at="h"}', '::label[Bare]{at="b"}', '::label[Process]{at="p"}');
  const doc = buildDocument({ markdown: md, resources: [MAP2] }, { ...PAGE, ...config }, createMeasurementCache());

  it('reads a label on its plate, or inside its halo, and skips one bare on the picture', () => {
    const pairs = contrastPairs(doc).filter((p) => p.role === 'label');
    expect(pairs.map((p) => p.text).sort()).toEqual(['Fine', 'Halo', 'Weak']);
    expect(pairs.find((p) => p.text === 'Weak')).toMatchObject({ color: '#cfd8dc', background: '#eceff1' });
    expect(pairs.find((p) => p.text === 'Halo')).toMatchObject({ color: '#ffffff', background: '#102a43' });
  });

  it('flags the pale label on a pale plate, with its source range', () => {
    const issues = contrastDocument(doc).filter((i) => i.role === 'label');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'lowContrast', text: 'Weak', color: '#cfd8dc', background: '#eceff1' });
    expect(md.slice(issues[0]!.sourceStart, issues[0]!.sourceEnd)).toBe('Weak');
  });

  it('counts a small label in a process colour as small multi-ink text', () => {
    const found = preflightDocument(doc).filter((i) => i.kind === 'smallProcessText');
    expect(found.some((i) => i.kind === 'smallProcessText' && i.color === '#336699')).toBe(true);
  });
});
