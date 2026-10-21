'use client';

import { useSandboxSelector } from '../context/SandboxContext.js';
import { localeDisplayName, localeShortTag } from '../presets/localeNames.js';
import { RowTag } from '../ui/index.js';

/** A book's content locale as a row tag: short (繁, 简, EN) among the
 *  locales of its book `all`, named in full in the interface language by
 *  its tooltip. */
export function LocaleTag({ locale, all }: { locale: string; all?: readonly string[] }) {
  const uiLocale = useSandboxSelector((s) => s.locale);
  const pool = all && all.includes(locale) ? all : [...(all ?? []), locale];
  const short = localeShortTag(locale, pool);
  return (
    <RowTag label={localeDisplayName(locale, uiLocale)}>
      {short.lang ? <span lang={short.lang}>{short.text}</span> : short.text}
    </RowTag>
  );
}
