import { describe, expect, it } from 'vitest';
import type { VDTFrame } from 'postext';
import { fitMarksFor } from './fitMarks';

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
