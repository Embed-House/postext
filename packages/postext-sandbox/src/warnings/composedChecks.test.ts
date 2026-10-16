import { describe, expect, it } from 'vitest';
import type { VDTDocument } from 'postext';
import { composedChecksOf, isComposedCheckKind } from './composedChecks';
import type { Warning } from './types';

/** A document of two pages, the second a composed page (fence 0) whose
 *  frame `mapa` sets the figure `foto-mapa`. */
const doc = {
  config: { pageTemplates: [{ id: 'tema', frames: [{ name: 'texto' }, { name: 'mapa' }] }] },
  pageIndexOffset: 0,
  blocks: [{ id: 'b-fig', resourceBlock: { resource: { id: 'foto-mapa' } } }],
  pages: [
    { index: 0, pageNumberValue: 7 },
    {
      index: 1,
      pageNumberValue: 8,
      composed: {
        template: 'tema',
        fenceIndex: 0,
        frames: [
          { id: 'cp0:texto', name: 'texto', blockIds: ['b-text'] },
          { id: 'cp0:mapa', name: 'mapa', blockIds: ['b-fig'] },
        ],
      },
    },
  ],
} as unknown as VDTDocument;

const w = (id: string, payload: Warning['payload']): Warning => ({ id, payload });

describe('composed checks of the label and continuation warnings', () => {
  it('counts them as composed checks', () => {
    for (const kind of ['frameContinuationLimit', 'labelAnchorUnknown', 'anchorUnlabelled'] as const) expect(isComposedCheckKind(kind)).toBe(true);
    expect(isComposedCheckKind('looseLine')).toBe(false);
  });

  it('places a continuation past its limit on its page and frame', () => {
    const [c] = composedChecksOf('ca', [{ index: 2, doc, warnings: [
      w('x', { kind: 'frameContinuationLimit', template: 'tema', frame: 'texto', fenceIndex: 0, pages: 3, overflowMm: 4, page: 2, configPath: '/pageTemplates/0/frames/0' }),
    ] }]);
    expect(c).toMatchObject({ locale: 'ca', chapterIndex: 2, page: 8, pageIndex: 1, fenceIndex: 0, frame: 'texto', frameId: 'cp0:texto' });
  });

  it('places a figure label on its page, in the frame that sets the figure', () => {
    const checks = composedChecksOf('en', [{ index: 0, doc, warnings: [
      w('a', { kind: 'labelAnchorUnknown', resourceId: 'foto-mapa', anchor: 'rio', known: ['mar'], page: 2 }),
      w('b', { kind: 'anchorUnlabelled', resourceId: 'foto-mapa', anchor: 'mar', style: 'chip', page: 2 }),
    ] }]);
    expect(checks.map((c) => [c.page, c.fenceIndex, c.template, c.frame, c.frameId])).toEqual([
      [8, 0, 'tema', 'mapa', 'cp0:mapa'],
      [8, 0, 'tema', 'mapa', 'cp0:mapa'],
    ]);
  });
});
