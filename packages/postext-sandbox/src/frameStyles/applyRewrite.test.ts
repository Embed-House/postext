import { describe, expect, it } from 'vitest';
import type { HistoryStepInfo } from '../history/sandboxHistory';
import { canUndoStyleRewrite, undoStyleRewrite, type StyleRewriteRecord } from './applyRewrite';

/** A history whose latest steps are `steps` (top last). */
function fakeHistory(steps: HistoryStepInfo[]) {
  const undone: HistoryStepInfo[] = [];
  return {
    undone,
    peek: () => steps[steps.length - 1] ?? null,
    undo: () => {
      const s = steps.pop() ?? null;
      if (s) undone.push(s);
      return s;
    },
  };
}

const RECORD: StyleRewriteRecord = { message: '', chapters: ['a', 'b'], steps: 3 };
const design: HistoryStepInfo = { kind: 'config', paths: ['calloutStyles'], keys: ['calloutStyles'] };

describe('the undo of a style merge', () => {
  it('takes back its design step and the fences of its chapters, whatever order they reached the history in', () => {
    const h = fakeHistory([{ kind: 'text', chapterId: 'z' }, { kind: 'text', chapterId: 'a' }, design, { kind: 'text', chapterId: 'b' }]);
    expect(canUndoStyleRewrite(h, RECORD)).toBe(true);
    expect(undoStyleRewrite(h, RECORD)).toBe(3);
    // The edit of chapter z made before the merge stays.
    expect(h.peek()).toEqual({ kind: 'text', chapterId: 'z' });
  });

  it('is not offered once something else was changed after it', () => {
    const h = fakeHistory([{ kind: 'text', chapterId: 'a' }, design, { kind: 'config', paths: ['bodyText.fontSize'], keys: ['bodyText'] }]);
    expect(canUndoStyleRewrite(h, RECORD)).toBe(false);
    expect(undoStyleRewrite(h, RECORD)).toBe(0);
  });
});
