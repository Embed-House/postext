import { describe, expect, it } from 'vitest';
import { warningAnchor } from './anchorTarget.js';
import { detailFor, titleFor } from '../sidebar/WarningsPanel.js';
import { DEFAULT_LABELS } from '../types/defaultLabels.js';

// #902: the Checks panel words the two label checks and leads to the anchor.

describe('the label checks in the Checks panel (#902)', () => {
  const overflow = { kind: 'labelOverflow', resourceId: 'mapa', text: 'Gibraltar', anchor: 'estrecho', widthPct: 4, scale: 0.5, page: 3, locale: 'es' } as const;
  const overlap = { kind: 'labelOverlap', resourceId: 'mapa', text: 'Toledo', anchor: 'b', with: 'Madrid', withAnchor: 'a', count: 1, page: 3 } as const;

  it('leads to the anchor, or to none for a label placed by percentages', () => {
    expect(warningAnchor(overflow)).toEqual({ anchor: 'estrecho', place: false });
    expect(warningAnchor(overlap)).toEqual({ anchor: 'b', place: false });
    expect(warningAnchor({ ...overlap, anchor: undefined })).toBeUndefined();
    expect(warningAnchor({ kind: 'labelAnchorUnknown', resourceId: 'mapa', anchor: 'rio', known: [], page: 1 })).toEqual({ anchor: 'rio', place: true });
    expect(warningAnchor({ kind: 'looseLine', page: 1 } as never)).toBeUndefined();
  });

  it('words each one with the text, the scale and the neighbour', () => {
    expect(titleFor(overflow, DEFAULT_LABELS)).toBe(DEFAULT_LABELS.warningsLabelOverflowTitle);
    expect(detailFor(overflow, DEFAULT_LABELS)).toContain('“Gibraltar” (page 3)');
    expect(detailFor(overflow, DEFAULT_LABELS)).toContain('50%');
    expect(detailFor(overlap, DEFAULT_LABELS)).toContain('“Toledo” overlaps “Madrid”');
    expect(detailFor({ ...overlap, count: 3 }, DEFAULT_LABELS)).toContain('and 2 more labels');
  });
});
