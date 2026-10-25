import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/index.js';
import { createMeasurementCache } from '../../measure/index.js';
import { resolveFootnotesConfig, stripFootnotesDefaults } from '../../defaults/footnotes.js';
import { buildBundle } from '../../bundle/index.js';
import type { DesignElement, PostextConfig, VDTBlock, VDTDocument } from '../../index.js';

// Deterministic text measurement stub (no DOM in the node test env).
class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const SENTENCE =
  'La linterna del faro debe permanecer encendida toda la noche para guiar a los barcos que cruzan la bahía. ';
const filler = (n: number): string => SENTENCE.repeat(n).trim();
const mm = (value: number) => ({ value, unit: 'mm' as const });

const ONE_COL: PostextConfig = {
  headings: { balancing: { enabled: false } },
  page: { width: mm(160), height: mm(120), margins: { top: mm(10), bottom: mm(10), left: mm(10), right: mm(10) } },
  layout: { layoutType: 'single' },
};
const TWO_COL: PostextConfig = { ...ONE_COL, layout: { layoutType: 'double' } };

function build(md: string, config: PostextConfig, footnotes?: PostextConfig['footnotes']): VDTDocument {
  return buildDocument({ markdown: md }, { ...config, ...(footnotes ? { footnotes } : {}) }, createMeasurementCache());
}

const partsOf = (doc: VDTDocument, id: string): VDTBlock[] =>
  doc.blocks
    .filter((b) => b.footnoteNote === id)
    .sort((a, b) => a.pageIndex - b.pageIndex || a.columnIndex - b.columnIndex || a.bbox.y - b.bbox.y);
const noteLines = (parts: readonly VDTBlock[]): string[] => parts.flatMap((b) => b.lines.map((l) => l.text));
const markerLine = (doc: VDTDocument, id: string) => {
  for (const b of doc.blocks) {
    if (b.footnoteNote !== undefined) continue;
    for (const l of b.lines) if (l.segments?.some((s) => s.footnoteId === id)) return { block: b, line: l };
  }
  return undefined;
};
const markerText = (doc: VDTDocument, id: string): string | undefined =>
  markerLine(doc, id)?.line.segments?.find((s) => s.footnoteId === id)?.text;

function expectLossless(doc: VDTDocument, reference: VDTDocument, id: string): void {
  const parts = partsOf(doc, id);
  expect(noteLines(parts)).toEqual(noteLines(partsOf(reference, id)));
  parts.forEach((p, i) => {
    expect(p.lines.length, `part ${i} of ${id}`).toBeGreaterThan(0);
    if (i === 0) expect(p.footnoteContinuation).toBeUndefined();
    else expect(p.footnoteContinuation).toBe(i);
  });
}

function expectOnePerPage(doc: VDTDocument, id: string): void {
  const parts = partsOf(doc, id);
  const first = markerLine(doc, id)!.block.pageIndex;
  parts.forEach((p, i) => expect(p.pageIndex, `page of part ${i}`).toBe(first + i));
}

const CITED_MIDWAY = (note: string): string => [
  `${filler(25)} Aquí.[^n] ${filler(25)}`,
  filler(10),
  `[^n]: ${note}`,
].join('\n\n');

describe('footnotes.split config', () => {
  it('resolves only when asked, with its defaults', () => {
    const off = resolveFootnotesConfig({});
    expect('split' in off || 'splitMinLines' in off || 'continuationRule' in off).toBe(false);
    const on = resolveFootnotesConfig({ split: true });
    expect(on.split).toBe(true);
    expect(on.splitMinLines).toBe(2);
    expect(on.continuationRule).toEqual({ enabled: true, width: 1, lineWidth: { value: 0.5, unit: 'pt' } });
    expect(resolveFootnotesConfig({ split: true, splitMinLines: 0 }).splitMinLines).toBe(2);
    expect(resolveFootnotesConfig({ split: true, splitMinLines: 3 }).splitMinLines).toBe(3);
  });
  it('strips the defaults', () => {
    expect(stripFootnotesDefaults({ split: false, splitMinLines: 2, continuationRule: { enabled: true, width: 1 } })).toBeUndefined();
    expect(stripFootnotesDefaults({ split: true, splitMinLines: 3 })).toEqual({ split: true, splitMinLines: 3 });
  });
});

describe('a footnote split across pages', () => {
  it('(a) sets a 25-line note on two pages', () => {
    const md = CITED_MIDWAY(filler(54));
    const reference = build(md, ONE_COL);
    expect(partsOf(reference, 'n')).toHaveLength(1);
    const total = partsOf(reference, 'n')[0]!.lines.length;
    expect(total).toBeGreaterThanOrEqual(20);
    const doc = build(md, ONE_COL, { split: true });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(2);
    expect(markerLine(doc, 'n')!.block.pageIndex).toBe(0);
    expectOnePerPage(doc, 'n');
    expectLossless(doc, reference, 'n');
    expect(parts[0]!.lines.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]!.lines[0]!.text.startsWith('1')).toBe(true);
    const page = doc.pages[0]!;
    const text = page.columns[0]!.blocks;
    const textBottom = Math.max(...text.map((b) => b.bbox.y + b.bbox.height));
    expect(parts[0]!.bbox.y).toBeGreaterThan(textBottom - 0.5);
    expect(parts[0]!.bbox.y + parts[0]!.bbox.height).toBeLessThanOrEqual(page.contentArea.y + page.contentArea.height + 0.5);
  });

  it('(b) runs a long note on to a third page', () => {
    const md = CITED_MIDWAY(filler(170));
    const doc = build(md, ONE_COL, { split: true });
    expect(partsOf(doc, 'n').length).toBeGreaterThanOrEqual(3);
    expectOnePerPage(doc, 'n');
    expectLossless(doc, build(md, ONE_COL), 'n');
    expect(doc.pages.length).toBeLessThan(15);
  });

  it('(b) runs a longer note on to a fourth page', () => {
    const md = CITED_MIDWAY(filler(240));
    const doc = build(md, ONE_COL, { split: true });
    expect(partsOf(doc, 'n').length).toBeGreaterThanOrEqual(4);
    expectOnePerPage(doc, 'n');
    expectLossless(doc, build(md, ONE_COL), 'n');
    for (const p of partsOf(doc, 'n')) {
      const area = doc.pages[p.pageIndex]!.contentArea;
      expect(p.bbox.y + p.bbox.height).toBeLessThanOrEqual(area.y + area.height + 0.5);
    }
  });

  it('(c) sets the continuation before the page\'s own notes, under a full rule', () => {
    const md = [
      `${filler(25)} Aquí.[^n] ${filler(25)}`,
      `${filler(2)} Otra.[^m] ${filler(2)}`,
      `[^n]: ${filler(54)}`,
      '[^m]: Una nota breve.',
    ].join('\n\n');
    const doc = build(md, ONE_COL, { split: true });
    const n = partsOf(doc, 'n');
    const m = partsOf(doc, 'm');
    expect(n).toHaveLength(2);
    expect(m).toHaveLength(1);
    expect(m[0]!.pageIndex).toBe(n[1]!.pageIndex);
    expect(m[0]!.bbox.y).toBeGreaterThan(n[1]!.bbox.y + n[1]!.bbox.height - 0.5);
    const page = doc.pages[n[1]!.pageIndex]!;
    const area = page.footnoteAreas!.find((a) => a.columnIndex === n[1]!.columnIndex)!;
    expect(area.noteIds).toEqual(['m']);
    expect(area.rule!.width).toBeCloseTo(page.columns[0]!.bbox.width, 1);
    const firstArea = doc.pages[n[0]!.pageIndex]!.footnoteAreas![0]!;
    expect(firstArea.rule!.width).toBeLessThan(page.columns[0]!.bbox.width * 0.5);
    expectLossless(doc, build(md, ONE_COL), 'n');
  });

  it('(d) keeps the note whole when splitMinLines do not fit under the citing line', () => {
    const md = CITED_MIDWAY(filler(54));
    const reference = build(md, ONE_COL);
    const doc = build(md, ONE_COL, { split: true, splitMinLines: 30 });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(1);
    expect(parts[0]!.footnoteContinuation).toBeUndefined();
    expect(parts[0]!.pageIndex).toBe(markerLine(doc, 'n')!.block.pageIndex);
    expect(parts[0]!.pageIndex).toBe(1);
    expect(noteLines(parts)).toEqual(noteLines(partsOf(reference, 'n')));
  });

  it('(e) numbers by page without counting the continuation', () => {
    const md = [
      `Inicio.[^k] ${filler(24)} Aquí.[^n] ${filler(25)}`,
      `${filler(2)} Otra.[^m] ${filler(2)}`,
      '[^k]: Primera nota.',
      `[^n]: ${filler(54)}`,
      '[^m]: Una nota breve.',
    ].join('\n\n');
    const doc = build(md, ONE_COL, { split: true, numbering: 'page' });
    const n = partsOf(doc, 'n');
    expect(n).toHaveLength(2);
    expect(markerText(doc, 'k')).toBe('1');
    expect(markerText(doc, 'n')).toBe('2');
    expect(partsOf(doc, 'm')[0]!.pageIndex).toBe(n[1]!.pageIndex);
    expect(markerText(doc, 'm')).toBe('1');
    expect(n[0]!.lines[0]!.text.startsWith('2')).toBe(true);
    expect(n[1]!.lines[0]!.text.startsWith('2')).toBe(false);
    expect(partsOf(doc, 'm')[0]!.lines[0]!.text.startsWith('1')).toBe(true);
    expectLossless(doc, build(md, ONE_COL), 'n');
  });

  it('(f) runs a note on from the first column to the second', () => {
    const md = [
      `${filler(12)} Aquí.[^n] ${filler(30)}`,
      filler(60),
      `[^n]: ${filler(27)}`,
    ].join('\n\n');
    const reference = build(md, TWO_COL);
    const doc = build(md, TWO_COL, { split: true });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(2);
    const cite = markerLine(doc, 'n')!.block;
    expect([parts[0]!.pageIndex, parts[0]!.columnIndex]).toEqual([cite.pageIndex, cite.columnIndex]);
    expect([parts[1]!.pageIndex, parts[1]!.columnIndex]).toEqual([cite.pageIndex, cite.columnIndex + 1]);
    expect(parts[1]!.footnoteContinuation).toBe(1);
    expectLossless(doc, reference, 'n');
  });

  it('(g) with split off, a long note is never cut', () => {
    const short = build(CITED_MIDWAY(filler(54)), ONE_COL);
    const s = partsOf(short, 'n');
    expect(s).toHaveLength(1);
    expect(s[0]!.footnoteContinuation).toBeUndefined();
    expect(s[0]!.pageIndex).toBe(markerLine(short, 'n')!.block.pageIndex);
    expect(s[0]!.pageIndex).toBe(1);
    expect(short.blocks.some((b) => b.footnoteContinuation !== undefined)).toBe(false);
    const long = build(CITED_MIDWAY(filler(240)), ONE_COL);
    expect(partsOf(long, 'n')).toHaveLength(1);
    expect(partsOf(long, 'n')[0]!.lines.length).toBeGreaterThan(60);
    expect(long.blocks.some((b) => b.footnoteContinuation !== undefined)).toBe(false);
  });
});

const furniture = (id: string, pages: DesignElement['pages']): DesignElement => ({
  kind: 'text', id, pages, content: '{pageNumber}', fontSize: { value: 8, unit: 'pt' }, overflow: 'ellipsis-end',
  placement: { anchor: { to: 'container', edge: 'bottom' }, size: { width: 'auto', height: 'auto' } },
});
const WITH_FURNITURE: PostextConfig = {
  ...ONE_COL,
  header: { elements: [furniture('head', 'body')] },
  footer: { elements: [furniture('folio', 'all')] },
};

const CITED_LAST = (note: string): string => [`${filler(25)} Aquí.[^n]`, `[^n]: ${note}`].join('\n\n');
const textBlocksOn = (doc: VDTDocument, pageIndex: number): VDTBlock[] =>
  doc.blocks.filter((b) => b.pageIndex === pageIndex && b.footnoteNote === undefined);
const notesOnlyPage = (doc: VDTDocument, pageIndex: number): boolean =>
  doc.pages[pageIndex]!.columns.every((c) => c.blocks.length === 0) && textBlocksOn(doc, pageIndex).length === 0;

describe('a split footnote at page breaks, parity and the end of a chapter', () => {
  it('(h) a chapter ending in a split note sets the rest on a page of notes only', () => {
    const md = CITED_LAST(filler(54));
    const doc = build(md, ONE_COL, { split: true });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(2);
    expect(markerLine(doc, 'n')!.block.pageIndex).toBe(0);
    expectOnePerPage(doc, 'n');
    expectLossless(doc, build(md, ONE_COL), 'n');
    expect(doc.pages).toHaveLength(2);
    expect(notesOnlyPage(doc, 1)).toBe(true);
    expect(parts[1]!.footnoteContinuation).toBe(1);
    expect(parts[1]!.lines[0]!.text.startsWith('1')).toBe(false);
  });

  it('(i) the page of notes only takes the body running head and the folio', () => {
    const doc = build(CITED_LAST(filler(54)), WITH_FURNITURE, { split: true });
    expect(doc.pages).toHaveLength(2);
    const page = doc.pages[1]!;
    expect(notesOnlyPage(doc, 1)).toBe(true);
    expect(page.blankForParity).toBeFalsy();
    expect(page.role).toBe('body');
    expect(page.header?.blocks).toHaveLength(1);
    expect(page.footer?.blocks).toHaveLength(1);
    expect(page.pageNumberValue).toBe(2);
  });

  it('(j) a page break after the citing paragraph sends the rest to the first page of text after it', () => {
    const md = [`${filler(25)} Aquí.[^n]`, ':::pagebreak', filler(10), `[^n]: ${filler(54)}`].join('\n\n');
    const doc = build(md, ONE_COL, { split: true });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.pageIndex).toBe(0);
    expect(parts[1]!.pageIndex).toBe(1);
    expect(doc.pages).toHaveLength(2);
    const text = textBlocksOn(doc, 1);
    expect(text.length).toBeGreaterThan(0);
    expect(parts[1]!.bbox.y).toBeGreaterThan(Math.max(...text.map((b) => b.bbox.y + b.bbox.height)) - 0.5);
    expectLossless(doc, build(md, ONE_COL), 'n');
  });

  it('(k) a parity blank after the break takes no note, the rest goes to the next page of text', () => {
    const md = [`${filler(25)} Aquí.[^n]`, ':::pagebreak{parity="odd"}', filler(10), `[^n]: ${filler(54)}`].join('\n\n');
    const doc = build(md, ONE_COL, { split: true });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(2);
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages[1]!.blankForParity).toBe(true);
    expect(doc.blocks.filter((b) => b.pageIndex === 1)).toHaveLength(0);
    expect(doc.pages[1]!.footnoteAreas).toBeUndefined();
    expect(parts[1]!.pageIndex).toBe(2);
    expect(textBlocksOn(doc, 2).length).toBeGreaterThan(0);
    expectLossless(doc, build(md, ONE_COL), 'n');
  });

  it('(l) a rest longer than a page runs over several pages of notes only and the layout ends', () => {
    for (const sentences of [170, 240]) {
      const md = CITED_LAST(filler(sentences));
      const doc = build(md, ONE_COL, { split: true });
      const parts = partsOf(doc, 'n');
      expect(parts.length).toBeGreaterThanOrEqual(sentences === 170 ? 3 : 4);
      expectOnePerPage(doc, 'n');
      expectLossless(doc, build(md, ONE_COL), 'n');
      expect(doc.pages).toHaveLength(parts.length);
      for (let i = 1; i < doc.pages.length; i++) expect(notesOnlyPage(doc, i), `page ${i}`).toBe(true);
      for (const p of parts) {
        const area = doc.pages[p.pageIndex]!.contentArea;
        expect(p.bbox.y + p.bbox.height).toBeLessThanOrEqual(area.y + area.height + 0.5);
      }
    }
  });

  it('(m) a fresh page too short for splitMinLines takes the whole rest', () => {
    const md = ['Aquí.[^n] Breve.', '## Dos {style="tight"}', 'Fin.', `[^n]: ${filler(30)}`].join('\n\n');
    const config: PostextConfig = {
      ...ONE_COL,
      headingStyles: [{ id: 'tight', margins: { top: mm(85), bottom: mm(10), left: mm(10), right: mm(10) } }],
    };
    const notes = { lineHeight: { value: 40, unit: 'pt' as const } };
    const doc = build(md, config, { ...notes, split: true });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.pageIndex).toBe(0);
    expect(parts[0]!.lines.length).toBeGreaterThanOrEqual(2);
    expect(parts[1]!.pageIndex).toBe(1);
    expect(parts[1]!.footnoteContinuation).toBe(1);
    const lineHeight = parts[1]!.bbox.height / parts[1]!.lines.length;
    expect(doc.pages[1]!.contentArea.height).toBeLessThan(2 * lineHeight);
    expect(parts[1]!.lines.length).toBeGreaterThanOrEqual(2);
    expectLossless(doc, build(md, config, notes), 'n');
  });

  it('(n) the end of the flow in the first column sets the rest in the second', () => {
    const md = [`${filler(12)} Aquí.[^n]`, `[^n]: ${filler(27)}`].join('\n\n');
    const doc = build(md, TWO_COL, { split: true });
    const parts = partsOf(doc, 'n');
    expect(parts).toHaveLength(2);
    expect([parts[0]!.pageIndex, parts[0]!.columnIndex]).toEqual([0, 0]);
    expect([parts[1]!.pageIndex, parts[1]!.columnIndex]).toEqual([0, 1]);
    expect(doc.pages).toHaveLength(1);
    expectLossless(doc, build(md, TWO_COL), 'n');
  });

  it('(o) split is ignored with notes at the end of the chapter', () => {
    const doc = build(CITED_MIDWAY(filler(54)), ONE_COL, { split: true, placement: 'chapterEnd' });
    expect(partsOf(doc, 'n').length).toBeGreaterThan(0);
    expect(doc.blocks.some((b) => b.footnoteContinuation !== undefined)).toBe(false);
  });
});

describe('a split footnote across the chapters of a book', () => {
  const BOOK: PostextConfig = {
    ...WITH_FURNITURE,
    headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: true, parity: 'odd' } }] },
    footnotes: { numbering: 'chapter', split: true, splitMinLines: 2 },
  };
  const chapterOne = [
    ':::pagebreak{parity="odd"}',
    ':::numbering{format="decimal" startAt=1}',
    '# Uno',
    filler(40),
    `${filler(30)} Aquí.[^n]`,
    `[^n]: ${filler(75)}`,
  ].join('\n\n');
  const chapterTwo = ['# Dos', `${filler(3)} Otra.[^m]`, '[^m]: Una nota breve.'].join('\n\n');

  it('(p) the next chapter opens on an odd page counted after the page of notes only', () => {
    const [one, two] = buildBundle({ chapters: [{ markdown: chapterOne }, { markdown: chapterTwo }], config: BOOK }, { cache: createMeasurementCache() });
    const parts = partsOf(one!, 'n');
    expect(parts).toHaveLength(2);
    expect(markerLine(one!, 'n')!.block.pageIndex).toBe(1);
    expect(one!.pages).toHaveLength(3);
    expect(parts[1]!.pageIndex).toBe(2);
    expect(notesOnlyPage(one!, 2)).toBe(true);
    expect(one!.pages[2]!.role).toBe('body');
    expect(two!.pageIndexOffset).toBe(3);
    expect(two!.pages[0]!.blankForParity).toBe(true);
    expect(two!.blocks.filter((b) => b.pageIndex === 0)).toHaveLength(0);
    expect(two!.pages[0]!.footnoteAreas).toBeUndefined();
    const opener = two!.blocks.find((b) => b.type === 'heading')!;
    expect(opener.pageIndex).toBe(1);
    expect((opener.pageIndex + two!.pageIndexOffset! + 1) % 2).toBe(1);
    expect(two!.pages[opener.pageIndex]!.pageNumberValue).toBe(5);
  });

  it('(q) chapter numbering starts again and the continuation stays with its chapter', () => {
    const [one, two] = buildBundle({ chapters: [{ markdown: chapterOne }, { markdown: chapterTwo }], config: BOOK }, { cache: createMeasurementCache() });
    const parts = partsOf(one!, 'n');
    expect(markerText(one!, 'n')).toBe('1');
    expect(parts[0]!.lines[0]!.text.startsWith('1')).toBe(true);
    expect(parts[1]!.lines[0]!.text.startsWith('1')).toBe(false);
    expect(markerText(two!, 'm')).toBe('1');
    expect(partsOf(two!, 'm')).toHaveLength(1);
    expect(partsOf(two!, 'm')[0]!.lines[0]!.text.startsWith('1')).toBe(true);
    expect(two!.blocks.some((b) => b.footnoteNote === 'n' || b.footnoteContinuation !== undefined)).toBe(false);
    const area = two!.pages[partsOf(two!, 'm')[0]!.pageIndex]!.footnoteAreas![0]!;
    expect(area.noteIds).toEqual(['m']);
  });
});
