/* Every edition of every public showcase bundle (apps/web/public/presets)
   hyphenates in its own language. An explicit `bodyText.hyphenation.locale`
   wins over the document `locale`, and a localized config replaces whole
   top-level keys, so an edition that changes only `locale` keeps the base
   edition's patterns (#804: the English Bioquímica split "su-rrounding"). */
import { describe, expect, it } from 'vitest';
import { matchHyphenationLocale, type PostextConfig } from 'postext';

// Loaded through a dynamic import (the package has no Node typings).
const PRESETS = '../../../../apps/web/public/presets/';
const load = async <T>(path: string): Promise<T> =>
  ((await import(/* @vite-ignore */ new URL(`${PRESETS}${path}`, import.meta.url).href)) as { default: T }).default;

interface Manifest {
  locale: string;
  config: PostextConfig;
  localized?: Record<string, { config?: Partial<PostextConfig> }>;
}

const index = await load<{ presets: { dir: string }[] }>('index.json');
const bundles = await Promise.all(index.presets.map(async ({ dir }) => ({ dir, manifest: await load<Manifest>(`${dir}/preset.json`) })));

/** Each edition: its language and the patterns its body text hyphenates with. */
function editions(m: Manifest): { edition: string; language: string; hyphenation?: string; enabled: boolean }[] {
  const of = (edition: string, config: Partial<PostextConfig>) => {
    const language = config.locale ?? edition;
    const hyphenation = config.bodyText?.hyphenation;
    return { edition, language, hyphenation: hyphenation?.locale ?? language, enabled: hyphenation?.enabled !== false };
  };
  return [
    of(m.locale, m.config),
    ...Object.entries(m.localized ?? {}).map(([edition, o]) => of(edition, { ...m.config, ...o.config })),
  ];
}

describe('showcase bundles hyphenate each edition in its own language', () => {
  it.each(bundles.map((b) => [b.dir, b.manifest] as const))('%s', (_dir, manifest) => {
    for (const e of editions(manifest)) {
      const own = matchHyphenationLocale(e.language);
      if (!own || !e.enabled) continue;
      expect({ edition: e.edition, hyphenation: matchHyphenationLocale(e.hyphenation!) })
        .toEqual({ edition: e.edition, hyphenation: own });
    }
  });
});
