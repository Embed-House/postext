/**
 * Seeded shuffles (#1225): the order an exercise prints its options, pairs
 * or items in is drawn from the book's `exercises.seed`, the exercise's
 * ordinal and what is shuffled, so print, HTML, EPUB and the key agree, and
 * a rebuild lays the same page.
 */

/** A 32-bit hash of the strings. */
function hash(parts: ReadonlyArray<string | number>): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x1f;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A generator of numbers in [0, 1) (mulberry32). */
export function seededRandom(...parts: ReadonlyArray<string | number>): () => number {
  let a = hash(parts);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The indices `0 … n − 1` shuffled. With `moveAll`, no index stays where it
 *  was when there are three or more (and two swap), so the printed order
 *  never gives the written one away. */
export function shuffledOrder(n: number, random: () => number, moveAll = true): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  if (moveAll && n > 1 && order.some((v, i) => v === i)) {
    // Rotate the fixed points among themselves, else the whole order.
    const fixed = order.map((v, i) => (v === i ? i : -1)).filter((i) => i >= 0);
    if (fixed.length > 1) {
      const vals = fixed.map((i) => order[i]!);
      fixed.forEach((i, k) => { order[i] = vals[(k + 1) % vals.length]!; });
    } else {
      const i = fixed[0]!;
      const j = (i + 1) % n;
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
  }
  return order;
}
