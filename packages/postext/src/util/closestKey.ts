// The known key a misspelt one is a slip of, for config warnings.

/** Edit distance with transpositions (optimal string alignment), capped:
 *  anything above `max` returns `max + 1`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** The known key (or word) `key` is a slip of: the same letters in another
 *  case, or one or two letters apart (a longer key allows two). */
export function closestKey(key: string, known: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  const sameCase = known.find((k) => k.toLowerCase() === lower);
  if (sameCase) return sameCase;
  const max = key.length >= 8 ? 2 : 1;
  let best: string | undefined;
  let bestD = max + 1;
  for (const k of known) {
    const dist = editDistance(lower, k.toLowerCase(), max);
    if (dist < bestD) { best = k; bestD = dist; }
  }
  return best;
}
