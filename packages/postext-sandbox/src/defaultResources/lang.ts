// The languages the built-in Postext guide is written in, and the helpers
// its figures, tables, captions and design read their wording through.

/** An edition of the guide. */
export type GuideLang = 'en' | 'es' | 'zh-Hans' | 'ca' | 'ar' | 'ja' | 'pt-BR' | 'fr' | 'de' | 'it';

/** Every edition, in the order the guide's fingerprint lists them. */
export const GUIDE_LANGS: readonly GuideLang[] = ['en', 'es', 'zh-Hans', 'ca', 'ar', 'ja', 'pt-BR', 'fr', 'de', 'it'];

/** The edition of the guide for a locale tag: Spanish for any `es` tag,
 *  Catalan for any `ca` tag, Simplified Chinese for any Chinese tag (the guide has no Traditional
 *  edition), Arabic for any `ar` tag (Modern Standard Arabic, whatever the
 *  region), Japanese for any `ja` tag, Brazilian Portuguese for any `pt` tag
 *  (`pt`, `pt-BR`, `pt-PT`: the guide has only the Brazilian edition),
 *  French for any `fr` tag, German for any `de` tag (`de`, `de-DE`, `de-AT`,
 *  `de-CH`), Italian for any `it` tag, English for
 *  everything else. */
export function guideLang(locale: string): GuideLang {
  const tag = locale.toLowerCase().replace(/_/g, '-');
  if (tag.startsWith('es')) return 'es';
  if (tag === 'ca' || tag.startsWith('ca-')) return 'ca';
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-Hans';
  if (tag === 'ar' || tag.startsWith('ar-')) return 'ar';
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
  if (tag === 'pt' || tag.startsWith('pt-')) return 'pt-BR';
  if (tag === 'fr' || tag.startsWith('fr-')) return 'fr';
  if (tag === 'de' || tag.startsWith('de-')) return 'de';
  if (tag === 'it' || tag.startsWith('it-')) return 'it';
  return 'en';
}

/** One value per edition. */
export type ByLang<T = string> = Record<GuideLang, T>;

/** A {@link ByLang} from its ten values, in the order en, es, zh-Hans,
 *  ca, ar, ja, pt-BR, fr, de, it. */
export function byLang<T>(en: T, es: T, zh: T, ca: T, ar: T, ja: T, pt: T, fr: T, de: T, it: T): ByLang<T> {
  return { en, es, 'zh-Hans': zh, ca, ar, ja, 'pt-BR': pt, fr, de, it };
}
