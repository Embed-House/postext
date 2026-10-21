import type { ResourcePlacement } from 'postext';

/** The choice a `placement.captionSide` shows as: under the figure, in
 *  the side column (`true`), or beside the picture inside its slot
 *  (`'inside'`, #1106). */
export type CaptionSideChoice = 'off' | 'margin' | 'inside';

export function captionSideValue(side: ResourcePlacement['captionSide']): CaptionSideChoice {
  return side === 'inside' ? 'inside' : side === true ? 'margin' : 'off';
}

/** The `placement.captionSide` a choice writes. */
export function captionSideOf(choice: string): boolean | 'inside' {
  return choice === 'inside' ? 'inside' : choice === 'margin';
}
