// Part 1 of the settings search coverage (sectionSearchCoverage.harness.ts, #1118).

import { vi } from 'vitest';
import { registerCoverage } from './sectionSearchCoverage.harness.js';

vi.mock('./MatchScope.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./MatchScope.js')>();
  const { harvest } = await import('./searchHarvest.js');
  return {
    ...orig,
    useFieldMatch: (haystack: string, overridden: boolean) => {
      if (overridden) harvest.overridden.push(haystack);
      return orig.useFieldMatch(haystack, overridden);
    },
    MatchScopeProvider: (props: Parameters<typeof orig.MatchScopeProvider>[0]) => {
      if (props.overridden) harvest.overridden.push(`scope ${props.id ?? ''}`);
      return orig.MatchScopeProvider(props);
    },
  };
});

registerCoverage(1, 4);
