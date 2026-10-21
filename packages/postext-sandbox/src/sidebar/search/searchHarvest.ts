/** What a rendered settings section was asked about, recorded by the
 *  MatchScope mock of the search coverage tests. A module of its own, with
 *  no imports, so the mock can reach it while MatchScope loads (#1118). */
export const harvest = { strings: [] as string[], overridden: [] as string[] };
