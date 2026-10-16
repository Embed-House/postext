/** A `wrap` value as the settings show it (#627): `'start'` is the flow's
 *  left side, `'end'` its right; anything else is no wrap. */
export function wrapSideOf(value: unknown): 'none' | 'left' | 'right' {
  if (value === 'left' || value === 'start') return 'left';
  if (value === 'right' || value === 'end') return 'right';
  return 'none';
}

/** A `wrap` value as a choice of the settings: a side, `'contour'` (#883,
 *  the picture's shape) or none. */
export function wrapChoiceOf(value: unknown): 'none' | 'left' | 'right' | 'contour' {
  return value === 'contour' ? 'contour' : wrapSideOf(value);
}
