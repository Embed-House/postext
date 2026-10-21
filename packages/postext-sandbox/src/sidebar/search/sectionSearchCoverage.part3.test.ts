// Part 3 of the settings search coverage (sectionSearchCoverage.harness.ts, #1118).

import { vi } from 'vitest';
import { registerCoverage } from './sectionSearchCoverage.harness';

vi.mock('./MatchScope', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./MatchScope')>();
  const { harvest } = await import('./searchHarvest');
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

registerCoverage(3, 4);
