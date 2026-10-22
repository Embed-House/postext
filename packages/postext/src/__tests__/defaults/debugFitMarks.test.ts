import { describe, expect, it } from 'vitest';
import { DEFAULT_DEBUG_CONFIG, FIT_MARKS_MODES, resolveDebugConfig, stripConfigDefaults, stripDebugDefaults } from '../../index.js';

// #1160: the book's default for the fit marks the Sandbox canvas draws over
// composed pages, and the scale at which a scale badge is left out. Since
// #1200 the default shows the problems only.

describe('debug.fitMarks and debug.fitMarksMinScale', () => {
  it('default to the problems, every scale badge kept when all are shown', () => {
    expect(DEFAULT_DEBUG_CONFIG.fitMarks).toBe('problems');
    expect(DEFAULT_DEBUG_CONFIG.fitMarksMinScale).toBe(1);
    expect(resolveDebugConfig(undefined)).toMatchObject({ fitMarks: 'problems', fitMarksMinScale: 1 });
    expect(resolveDebugConfig({})).toMatchObject({ fitMarks: 'problems', fitMarksMinScale: 1 });
    expect(FIT_MARKS_MODES).toEqual(['all', 'problems', 'none']);
  });

  it('resolve what the book sets, and fall back on a value they do not know', () => {
    expect(resolveDebugConfig({ fitMarks: 'all', fitMarksMinScale: 0.95 })).toMatchObject({ fitMarks: 'all', fitMarksMinScale: 0.95 });
    expect(resolveDebugConfig({ fitMarks: 'some' as never, fitMarksMinScale: -1 })).toMatchObject({ fitMarks: 'problems', fitMarksMinScale: 1 });
  });

  it('are stripped at their defaults and kept otherwise', () => {
    expect(stripDebugDefaults({ fitMarks: 'problems', fitMarksMinScale: 1 })).toBeUndefined();
    expect(stripDebugDefaults({ fitMarks: 'none', fitMarksMinScale: 0.9 })).toEqual({ fitMarks: 'none', fitMarksMinScale: 0.9 });
    // A book that asks for every mark keeps asking.
    expect(stripConfigDefaults({ debug: { fitMarks: 'all' } }).debug).toEqual({ fitMarks: 'all' });
  });
});
