/** Item `i` of `items` in part `i % of + 1` of `of`. A sweep that one test
 *  file ran alone is cut in files of its own, one per part, so the
 *  workers share it (#1118). */
export const partOf = <T>(items: readonly T[], part: number, of: number): T[] =>
  items.filter((_, i) => i % of === part - 1);
