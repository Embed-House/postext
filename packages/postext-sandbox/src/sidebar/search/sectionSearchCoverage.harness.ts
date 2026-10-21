// The settings search mounts only the sections `planSettingsSearch` picks,
// so the static index must cover every word a rendered row can match. The
// sectionSearchCoverage.part*.test.ts files render each section
// (server-side, every card forced open by an active search) against
// several books, in English and Spanish, record what each field row and
// card title is tested against, and check every word is in that section's
// index — and that a section with a changed row counts as overridden for
// "Changed only". One file took three minutes for all the books; the
// parts share them (#1118). Each part mocks MatchScope to record.

import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PostextConfig, Resource } from 'postext';
import { SandboxStoreContext } from '../../context/SandboxContext';
import { createDefaultConfig } from '../../context/defaultConfig';
import { createPostextGuideConfig } from '../../context/guideConfig';
import { DEFAULT_LABELS } from '../../types/defaultLabels';
import type { SandboxLabels } from '../../types/labels';
import { SECTION_COMPONENTS } from '../sections/components';
import type { SettingsSectionId } from '../sections/registry';
import { sectionHasOverrides } from '../sections/sectionOverrides';
import { SettingsSearchContext, type SettingsSearchState } from './SearchContext';
import { MatchScopeProvider } from './MatchScope';
import { buildSectionSearchIndex } from './sectionIndex';
import { matchesTokens } from './normalize';
import { harvest } from './searchHarvest';

// Loaded through dynamic imports (the package has no Node typings).
const load = async <T>(path: string): Promise<T> =>
  ((await import(/* @vite-ignore */ new URL(path, import.meta.url).href)) as { default: T }).default;
const PRESETS = '../../../../../apps/web/public/presets/';
export const generator = (await import(/* @vite-ignore */ new URL('../../../scripts/build-settings-search-index.mjs', import.meta.url).href)) as {
  isIndexCurrent(): boolean;
};
const spanishMessages = await load<{ Sandbox: Record<string, string> }>('../../../../../apps/web/messages/es.json');
const presetIndex = await load<{ presets: Array<{ dir: string }> }>(`${PRESETS}index.json`);
const presets = await Promise.all(
  presetIndex.presets.map(async ({ dir }) => ({
    dir,
    preset: await load<{ config?: PostextConfig; resources?: Resource[] }>(`${PRESETS}${dir}/preset.json`),
  })),
);

/** A search that matches nothing but records every string it is asked
 *  about: rows and card titles still render (hidden) and all cards open. */
const RECORDING_SEARCH: SettingsSearchState = {
  query: '\u0001',
  matcher: { tokens: ['\u0001'], test: (s) => { harvest.strings.push(s); return false; } },
  overriddenOnly: false,
  active: true,
};

export function spanishLabels(): SandboxLabels {
  return { ...DEFAULT_LABELS, ...spanishMessages.Sandbox } as SandboxLabels;
}

export interface Book { name: string; config: PostextConfig; resources: Resource[] }

export function books(): Book[] {
  const out: Book[] = [
    { name: 'default', config: createDefaultConfig('en'), resources: [] },
    { name: 'guide', config: createPostextGuideConfig('en'), resources: [] },
  ];
  // Label styles (#969) are not built in: a book that stores some, with
  // every field written, shows every row of their cards.
  out.push({
    name: 'label styles',
    config: {
      ...createDefaultConfig('en'),
      paragraphStyles: [{ id: 'town-names', name: 'Town names' }],
      labelStyles: [
        { id: 'town', name: 'Towns', paragraphStyle: 'town-names', fontFamily: 'Lora', fontSize: { value: 8, unit: 'pt' }, fontWeight: 600, fontStyle: 'italic', color: { hex: '#1f3a5f', model: 'hex' }, textTransform: 'uppercase', letterSpacing: 0.05, halo: { color: { hex: '#ffffff', model: 'hex' }, width: { value: 2, unit: 'px' } }, background: { hex: '#f4f0e6', model: 'hex' }, padding: { value: 3, unit: 'px' }, minScale: 0.7, writingMode: 'vertical-rl', overlap: 'allow' },
        { id: 'sea' },
      ],
    },
    resources: [],
  });
  for (const { dir, preset } of presets) {
    if (preset.config) out.push({ name: dir, config: preset.config, resources: preset.resources ?? [] });
  }
  return out;
}

export function renderSection(id: SettingsSectionId, labels: SandboxLabels, locale: string, book: Book) {
  const state = { config: book.config, resources: book.resources, labels, locale };
  const store = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    dispatch: () => {},
  };
  harvest.strings = [];
  harvest.overridden = [];
  renderToString(
    h(SandboxStoreContext, { value: store as never },
      h(SettingsSearchContext, { value: RECORDING_SEARCH },
        h(MatchScopeProvider, { id: 'root', children: h(SECTION_COMPONENTS[id]) }))),
  );
  return { strings: harvest.strings, overridden: harvest.overridden };
}

export const WORD = /[^\p{L}\p{N}]+/u;


/** Registers part `part` (from 1) of `of`: each book in each language is a
 *  unit, weighed by the size of its configuration (the biochemistry book
 *  renders every section of the panel), and goes to the part with the least
 *  work so far, heaviest first. Every part computes the same split. */
export function registerCoverage(part: number, of: number): void {
  const locales: Array<[string, SandboxLabels]> = [['en', DEFAULT_LABELS], ['es', spanishLabels()]];
  const units = books().flatMap((book) => locales.map(([locale, labels]) => ({ book, locale, labels, weight: JSON.stringify(book.config).length + 20_000 })));
  units.sort((a, b) => b.weight - a.weight || (`${a.book.name} ${a.locale}` < `${b.book.name} ${b.locale}` ? -1 : 1));
  const load = new Array<number>(of).fill(0);
  const mine: typeof units = [];
  for (const unit of units) {
    let target = 0;
    for (let i = 1; i < of; i++) if (load[i]! < load[target]!) target = i;
    load[target]! += unit.weight;
    if (target === part - 1) mine.push(unit);
  }
  describe(`settings search index, part ${part} of ${of}`, () => {
    for (const { book, locale, labels } of mine) {
      it(`covers every rendered row of "${book.name}" (${locale})`, () => {
        const index = buildSectionSearchIndex(labels, book.config, book.resources);
        const missing: string[] = [];
        let rows = 0;
        for (const text of index) {
          const { strings, overridden } = renderSection(text.id, labels, locale, book);
          rows += strings.length;
          const gaps = new Set<string>();
          for (const s of strings) {
            for (const word of s.split(WORD)) {
              if (!word || /\d/.test(word) || (text.colors && /^[0-9a-f]+$/.test(word))) continue;
              if (!matchesTokens(text.all, [word])) gaps.add(word);
            }
          }
          if (gaps.size > 0) missing.push(`${text.id}: ${[...gaps].slice(0, 12).join(', ')}`);
          if (overridden.length > 0 && !sectionHasOverrides(book.config, text.id)) {
            missing.push(`${text.id}: sectionHasOverrides() is false but rows are changed: ${overridden.slice(0, 3).join(' / ')}`);
          }
        }
        expect(rows).toBeGreaterThan(300);
        expect(missing).toEqual([]);
        // The column-and-a-half biochemistry book renders every section of
        // the panel: 46–59 s on a CI runner, so a minute was a coin toss.
      }, 180_000);
    }
  });
}
