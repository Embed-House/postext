import type { VDTLineSegment } from '../vdt';

/** The two word-space ratios of a justified line (see `VDTLine`). */
export interface SpaceRatios {
  justifiedSpaceRatio?: number;
  justifiedSpaceLimitRatio?: number;
}

/** Under this difference the two ratios are one number, and the line
 *  carries only `justifiedSpaceRatio`. */
const SAME = 1e-9;

/**
 * The word-space ratios of a line justified to `lineMaxWidth`, its spaces
 * measured against `normalSpaceWidth` (the regular face's space, with the
 * block's tracking); none for a line with no space.
 *
 * `justifiedSpaceRatio` is the width every space of the line is painted at,
 * over the regular space: the painters share the measure left by the words
 * among the spaces, all alike. `justifiedSpaceLimitRatio` (#704) is the
 * line's adjustment as the breaker bounds it, in the units of
 * `minWordSpacing` and `maxWordSpacing`: 1 plus the slack over the spaces,
 * each space counted at its own width. A space of an italic or a bold run
 * is narrower or wider than the regular one, so a line that holds one is
 * painted a little under or over the limit it was broken within; the second
 * number says what the breaker did. It is given only when it differs from
 * the first, that is, when the line's own spaces are not regular ones.
 */
export function justifiedSpaceRatios(segments: readonly VDTLineSegment[], lineMaxWidth: number, normalSpaceWidth: number): SpaceRatios {
  if (!(normalSpaceWidth > 0)) return {};
  let wordWidth = 0;
  let ownSpaces = 0;
  let spaceCount = 0;
  for (const seg of segments) {
    if (seg.kind === 'space') {
      spaceCount++;
      ownSpaces += seg.width;
    } else wordWidth += seg.width;
  }
  if (spaceCount === 0) return {};
  return ratiosOf(lineMaxWidth - wordWidth, ownSpaces, spaceCount, normalSpaceWidth);
}

/** {@link justifiedSpaceRatios} from the sums: `room` is the measure the
 *  words leave, `ownSpaces` the natural width of the line's `spaceCount`
 *  spaces. */
export function ratiosOf(room: number, ownSpaces: number, spaceCount: number, normalSpaceWidth: number): SpaceRatios {
  if (!(normalSpaceWidth > 0) || spaceCount <= 0) return {};
  const justifiedSpaceRatio = room / spaceCount / normalSpaceWidth;
  const limit = 1 + (room - ownSpaces) / (spaceCount * normalSpaceWidth);
  return Math.abs(limit - justifiedSpaceRatio) > SAME ? { justifiedSpaceRatio, justifiedSpaceLimitRatio: limit } : { justifiedSpaceRatio };
}
