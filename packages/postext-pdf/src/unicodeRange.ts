/**
 * The characters a file of a face answers for: the `unicode-range` of its
 * `@font-face` rule (CSS Fonts 4 §4.5), as a font provider hands it with
 * the file (`PdfFontFile`, postext #770).
 */

/** The code points of a range, as intervals from low to high that neither
 *  overlap nor touch. */
export type CodePointRanges = ReadonlyArray<readonly [number, number]>;

const MAX_CODE_POINT = 0x10ffff;
const INTERVAL_RE = /^u\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/i;
const WILDCARD_RE = /^u\+([0-9a-f]{0,5})(\?{1,6})$/i;

/**
 * A `unicode-range` value (`U+0000-00FF, U+0131, U+4E??`) as intervals.
 * Undefined for a value a browser would not read (a part that is no
 * range, a range that ends before it starts or leaves Unicode): the
 * descriptor is then dropped and the rule answers for every character,
 * as one written without it.
 */
export function parseUnicodeRange(value: string): CodePointRanges | undefined {
  const found: Array<[number, number]> = [];
  for (const raw of value.split(',')) {
    const part = raw.trim();
    const interval = INTERVAL_RE.exec(part);
    const wildcard = interval ? null : WILDCARD_RE.exec(part);
    let lo: number;
    let hi: number;
    if (interval) {
      lo = parseInt(interval[1]!, 16);
      hi = interval[2] === undefined ? lo : parseInt(interval[2], 16);
    } else if (wildcard && wildcard[1]!.length + wildcard[2]!.length <= 6) {
      lo = parseInt(wildcard[1]! + '0'.repeat(wildcard[2]!.length), 16);
      hi = parseInt(wildcard[1]! + 'f'.repeat(wildcard[2]!.length), 16);
    } else {
      return undefined;
    }
    if (lo > hi || hi > MAX_CODE_POINT) return undefined;
    found.push([lo, hi]);
  }
  if (found.length === 0) return undefined;
  found.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [lo, hi] of found) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

/** Whether `ranges` ({@link parseUnicodeRange}) hold the code point `cp`. */
export function rangesHold(ranges: CodePointRanges, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = ranges[mid]!;
    if (cp < range[0]) hi = mid - 1;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}
