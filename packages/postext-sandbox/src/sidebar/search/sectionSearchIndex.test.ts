// The settings search mounts only the sections `planSettingsSearch` picks,
// so the static index must cover every word a rendered row can match: the
// sectionSearchCoverage.part*.test.ts files check it (#1118). Here, that
// the index is current and how a query plans its sections.

import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { createDefaultConfig } from '../../context/defaultConfig';
import { DEFAULT_LABELS } from '../../types/defaultLabels';
import type { SandboxLabels } from '../../types/labels';
import { SETTINGS_SECTIONS } from '../sections/registry';
import { buildSectionSearchIndex, planSettingsSearch } from './sectionIndex';

// Loaded through dynamic imports (the package has no Node typings).
const spanishMessages = ((await import(/* @vite-ignore */ new URL('../../../../../apps/web/messages/es.json', import.meta.url).href)) as {
  default: { Sandbox: Record<string, string> };
}).default;
const spanishLabels = (): SandboxLabels => ({ ...DEFAULT_LABELS, ...spanishMessages.Sandbox } as SandboxLabels);

const generator = (await import(/* @vite-ignore */ new URL('../../../scripts/build-settings-search-index.mjs', import.meta.url).href)) as {
  isIndexCurrent(): boolean;
};

describe('settings search index', () => {
  it('is up to date with the section sources', () => {
    // Stale: run `node scripts/build-settings-search-index.mjs`.
    expect(generator.isIndexCurrent()).toBe(true);
  });
});

describe('planSettingsSearch', () => {
  const labels = spanishLabels();
  const config = createDefaultConfig('es');
  const index = buildSectionSearchIndex(labels, config, []);
  const ids = (tokens: string[], overriddenOnly = false) =>
    planSettingsSearch(index, tokens, overriddenOnly, config).flatMap((g) => g.sections);

  it('mounts every section for a word with a digit', () => {
    expect(ids(['2'])).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it('narrows a query to the sections that name it', () => {
    const hits = ids(['margen']);
    expect(hits).toContain('page');
    expect(hits.length).toBeLessThan(SETTINGS_SECTIONS.length);
    expect(ids(['zzzz'])).toEqual([]);
  });

  it('puts the group whose section title matches first', () => {
    expect(planSettingsSearch(index, ['paleta'], false, config)[0].id).toBe('colors');
  });

  it('keeps only overridden sections for "Changed only"', () => {
    const changed = planSettingsSearch(index, [], true, { ...config, math: { fontScale: 2 } } as PostextConfig)
      .flatMap((g) => g.sections);
    expect(changed).toContain('math');
    expect(changed).not.toContain('page');
  });
});
