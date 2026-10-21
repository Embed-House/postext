import { describe, expect, it } from 'vitest';
import { isCardOpen, moveCardState, openCard, setCardsOpen } from './ItemCard.js';

describe('the fold of a Design panel card (#1031)', () => {
  it('starts folded and opens on its own', () => {
    expect(isCardOpen('paragraphStyles', 'lead')).toBe(false);
    openCard('paragraphStyles', 'lead');
    expect(isCardOpen('paragraphStyles', 'lead')).toBe(true);
    // Another list with the same id keeps its own fold.
    expect(isCardOpen('calloutStyles', 'lead')).toBe(false);
  });

  it('follows a rename', () => {
    openCard('calloutStyles', 'note');
    moveCardState('calloutStyles', 'note', 'aside');
    expect(isCardOpen('calloutStyles', 'aside')).toBe(true);
    setCardsOpen('calloutStyles', ['tip'], false);
    moveCardState('calloutStyles', 'tip', 'hint');
    expect(isCardOpen('calloutStyles', 'hint')).toBe(false);
  });

  it('opens and folds a whole list', () => {
    setCardsOpen('tableStyles', ['a', 'b', 'c'], true);
    expect(['a', 'b', 'c'].map((id) => isCardOpen('tableStyles', id))).toEqual([true, true, true]);
    setCardsOpen('tableStyles', ['a', 'b', 'c'], false);
    expect(['a', 'b', 'c'].map((id) => isCardOpen('tableStyles', id))).toEqual([false, false, false]);
  });
});
