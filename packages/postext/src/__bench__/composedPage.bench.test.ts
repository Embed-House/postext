/**
 * Relayout cost of a chapter of composed pages (#857): twenty copies of the
 * p. 8 stand-in (`__tests__/composed/fixtures/page8.ts`), each with its own
 * theme. Times a cold build, a rebuild with nothing changed, a property
 * change on one page (its fence's `tema`, no text reflows) and an edit
 * inside one of its frames (the frame's text reflows), each with the
 * composed-page memo and without it, and `sourceAt` over a grid of points.
 * Skipped by `pnpm test`; run with `pnpm bench` (BENCH=1).
 *
 * Text measurement is stubbed (no canvas in node): absolute numbers are
 * not the browser's, the ratios and the budgets' margins are (DESIGN §6:
 * under 100 ms for a property change on one page, under 300 ms with reflow).
 */
import { describe, it } from 'vitest';
import { buildDocument } from '../pipeline/build.js';
import { createMeasurementCache } from '../measure/index.js';
import { clearComposedPageMemo, composedPageMemoStats, setComposedPageMemo } from '../composed/pageMemo.js';
import { sourceAt } from '../composed/sourceMap.js';
import { page8Fixture } from '../__tests__/composed/fixtures/page8.js';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    let w = 0;
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) % 5 + 5;
    return { width: w };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const PAGES = 20;
const { markdown: PAGE8, config, resources } = page8Fixture('es');
const chapter = (themeOf: (k: number) => string, edit?: { page: number; from: string; to: string }): string =>
  Array.from({ length: PAGES }, (_, k) => {
    const page = PAGE8.replace('tema="Retos del planeta"', `tema="${themeOf(k)}"`);
    return edit && edit.page === k ? page.replace(edit.from, edit.to) : page;
  }).join('\n');

const base = chapter((k) => `Tema ${k + 1}`);
const property = chapter((k) => (k === 9 ? 'Otro tema' : `Tema ${k + 1}`));
const reflow = chapter((k) => `Tema ${k + 1}`, { page: 9, from: 'El dinero nos deja', to: 'El dinero, que tanto cuesta ganar con el trabajo de cada día, nos deja' });

const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined>; stdout: { write(s: string): void } } }).process;

describe.skipIf(!nodeProcess?.env?.BENCH)('composed pages relayout bench', () => {
  const ROUNDS = 7;
  const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const time = (fn: () => void): number => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };
  const build = (md: string, cache = createMeasurementCache()) => buildDocument({ markdown: md, resources }, config, cache);

  it('reports relayout times with and without the composed-page memo', { timeout: 300_000 }, () => {
    const cold: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      clearComposedPageMemo();
      cold.push(time(() => build(base)));
    }
    const rows: string[] = [];
    for (const memo of [true, false]) {
      setComposedPageMemo(memo);
      const cache = createMeasurementCache();
      const same: number[] = [];
      const prop: number[] = [];
      const edit: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        clearComposedPageMemo();
        setComposedPageMemo(memo);
        build(base, cache);
        same.push(time(() => build(base, cache)));
        // A change on page 10, then back: each a relayout of that page.
        prop.push(time(() => build(property, cache)));
        build(base, cache);
        edit.push(time(() => build(reflow, cache)));
      }
      const s = composedPageMemoStats();
      rows.push(`${memo ? 'memo' : 'no memo'}: unchanged ${median(same).toFixed(1)} ms, property ${median(prop).toFixed(1)} ms, reflow ${median(edit).toFixed(1)} ms${memo ? ` (hits ${s.hits}, laid ${s.misses}, skipped ${s.skipped})` : ''}`);
    }
    setComposedPageMemo(true);
    // sourceAt over a 40 × 50 grid of the tenth page.
    const doc = build(base);
    const page = doc.pages[9]!;
    let calls = 0;
    const hover = time(() => {
      for (let i = 0; i < 40; i++) for (let j = 0; j < 50; j++) { sourceAt(doc, 9, (i + 0.5) * page.width / 40, (j + 0.5) * page.height / 50); calls++; }
    });
    nodeProcess?.stdout.write(
      `[bench] composed: ${doc.pages.length} pages; cold median ${median(cold).toFixed(1)} ms; ${rows.join('; ')}; `
      + `sourceAt ${(hover / calls * 1000).toFixed(1)} µs a point (${ROUNDS} rounds)\n`,
    );
  });
});
