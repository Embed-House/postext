import { describe, expect, it } from 'vitest';
import type { VDTFrame } from 'postext';
import { fitMarksFor } from './fitMarks.js';

// #1095: the canvas marks a frame whose `:::frame` piece names a look the
// config does not have, beside the marks it already draws.

const frame = (over: Partial<VDTFrame>): VDTFrame => ({
  id: 'cp0:a', name: 'a', rect: { x: 0, y: 0, width: 100, height: 50 }, rotate: 0, layer: 1, scale: 1, overflowPx: 0, blockIds: ['b'], configPath: '/pageTemplates/0/frames/0', ...over,
});
const LABELS = { overflow: '__mm__ mm short', scaled: 'Text at __percent__ %', imageScaled: 'Pictures at __percent__ %', lookUnknown: 'Unknown look: __look__' };
const doc = { config: { page: { dpi: 300 } } } as never;

describe('fitMarksFor', () => {
  it('marks a frame of an unknown look with its name', () => {
    const marks = fitMarksFor(doc, { composed: { frames: [frame({ lookUnknown: 'azul' }), frame({ id: 'cp0:b', name: 'b' })] } } as never, LABELS);
    expect(marks.map((m) => [m.frame.name, m.kind, m.text])).toEqual([['a', 'look', 'Unknown look: azul']]);
  });

  it('keeps the overflow mark of the same frame', () => {
    const marks = fitMarksFor(doc, { composed: { frames: [frame({ lookUnknown: 'azul', overflowPx: 118.11 })] } } as never, LABELS, { locale: 'en' });
    expect(marks.map((m) => m.kind)).toEqual(['look', 'overflow']);
    expect(marks[1]!.text).toBe('10 mm short');
  });

  it('draws no look mark without the words for it', () => {
    const labels = { overflow: LABELS.overflow, scaled: LABELS.scaled, imageScaled: LABELS.imageScaled };
    expect(fitMarksFor(doc, { composed: { frames: [frame({ lookUnknown: 'azul' })] } } as never, labels)).toEqual([]);
  });
});

// #1160: which marks are drawn (all, the problems only, none) and the
// scale at which a scale badge is no longer drawn.
describe('fitMarksFor, filtered', () => {
  const page = {
    composed: {
      frames: [
        frame({ id: 'cp0:a', name: 'a', overflowPx: 118.11 }),
        frame({ id: 'cp0:b', name: 'b', scale: 0.9 }),
        frame({ id: 'cp0:c', name: 'c', scale: 0.97, imageScale: 0.8 }),
        frame({ id: 'cp0:d', name: 'd', lookUnknown: 'azul' }),
      ],
    },
  } as never;
  const kinds = (options: Parameters<typeof fitMarksFor>[3]) => fitMarksFor(doc, page, LABELS, { locale: 'en', ...options }).map((m) => `${m.frame.name} ${m.kind}`);

  it('all: every mark, as before', () => {
    expect(kinds({})).toEqual(['a overflow', 'b scaled', 'c scaled', 'd look']);
    expect(kinds({ mode: 'all' })).toEqual(kinds({}));
  });

  it('problems: frames that do not fit and unknown looks', () => {
    expect(kinds({ mode: 'problems' })).toEqual(['a overflow', 'd look']);
  });

  it('none: nothing, but the frame a check just reached', () => {
    expect(kinds({ mode: 'none' })).toEqual([]);
    expect(kinds({ mode: 'none', targetFrameId: 'cp0:b' })).toEqual(['b target']);
  });

  it('minScale: a scale at or above it gets no badge, text and pictures apart', () => {
    expect(fitMarksFor(doc, page, LABELS, { locale: 'en', minScale: 0.95 }).map((m) => `${m.frame.name} ${m.text}`)).toEqual([
      'a 10 mm short', 'b Text at 90 %', 'c Pictures at 80 %', 'd Unknown look: azul',
    ]);
    expect(kinds({ minScale: 0.9 })).toEqual(['a overflow', 'c scaled', 'd look']);
    expect(kinds({ minScale: 0.8 })).toEqual(['a overflow', 'd look']);
    // Above 1 is the same as 1: an unscaled frame is never marked.
    expect(kinds({ minScale: 2 })).toEqual(kinds({}));
    // The threshold never hides a problem.
    expect(kinds({ mode: 'problems', minScale: 0 })).toEqual(['a overflow', 'd look']);
  });
});
