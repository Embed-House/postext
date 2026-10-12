/**
 * The OpenType language systems of a language (postext #764).
 *
 * A font keeps the forms of a language (`locl`: the Catalan `l·l`, the
 * Romanian `ș`, the Simplified Chinese dash) under an OpenType language
 * tag (`CAT`, `ROM`, `ZHS`), and a shaper is told the language as a BCP 47
 * tag (`ca`, `ro`, `zh-Hans`). HarfBuzz, which shapes for the browser that
 * measured the layout, turns one into the other with a table made from
 * the IANA and OpenType registries: up to three tags for a language, in
 * order of preference (`zh-MO`: `ZHTM`, then `ZHH`), of which it takes the
 * first the font has. fontkit, which shapes the plain text of the PDF,
 * wants the OpenType tag itself; this module gives it HarfBuzz's.
 *
 * The table (`otLanguageData.ts`) is read out of the HarfBuzz build this
 * package ships by `scripts/make-ot-languages.mjs`, which also checks the
 * lookup below against HarfBuzz for more than a million tags.
 */
import { OT_LANGUAGE_DATA } from './otLanguageData';

const NONE: readonly string[] = [];

let table: Map<string, readonly string[]> | undefined;

/** The entries of the table by language (`ca`, `zh-Hant`, `ro-MD`,
 *  `*-polyton`), parsed on first use. */
function entries(): Map<string, readonly string[]> {
  if (table) return table;
  table = new Map();
  for (const group of OT_LANGUAGE_DATA.split(';')) {
    const at = group.indexOf('=');
    const tags: readonly string[] = at === 0 ? NONE : group.slice(0, at).split(',');
    for (const language of group.slice(at + 1).split(' ')) table.set(language, tags);
  }
  return table;
}

/** The subtags of a tag the table goes by. */
interface Subtags {
  language: string;
  script?: string;
  region?: string;
  variants: string[];
}

/** `tag` in canonical form (`Intl.Locale`: `zh_hant_hk` and `zh-HANT-hk`
 *  are `zh-Hant-HK`, `iw` is `he`), cut into its subtags; undefined when
 *  it is no language tag. */
function subtagsOf(tag: string): Subtags | undefined {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag.trim().replace(/_/g, '-'));
  } catch {
    return undefined;
  }
  // What follows the language, script and region in the base name.
  const named = [locale.language, locale.script, locale.region].filter((sub) => sub !== undefined).length;
  return {
    language: locale.language,
    ...(locale.script ? { script: locale.script } : {}),
    ...(locale.region ? { region: locale.region } : {}),
    variants: locale.baseName.split('-').slice(named).map((sub) => sub.toLowerCase()),
  };
}

const known = new Map<string, readonly string[]>();
/** Tags kept before the cache is emptied (a document names a handful). */
const KNOWN_SLOTS = 500;

/**
 * The OpenType language tags HarfBuzz takes for the BCP 47 tag `tag`, in
 * its order of preference, without their trailing spaces (`['CAT']` for
 * `ca`, `['MOL', 'ROM']` for `ro-MD`, `['ZHH']` for `zh-Hant-HK`): the
 * language system a text is shaped in is the first of them the font's
 * script has. Empty for a language with none (`''`, a language of two
 * letters out of the table, a tag that is no language tag).
 *
 * The steps, the first that has an entry: the language with each variant
 * (`el-polyton`), with its script and region, with its script; each
 * variant and the script in any language (`fonipa`, `Syre`); the language
 * with its region; the language. A language of three letters with no
 * entry has its own letters in capitals (ISO 639-3, as HarfBuzz does).
 */
export function openTypeLanguagesOf(tag: string | undefined): readonly string[] {
  if (!tag) return NONE;
  const hit = known.get(tag);
  if (hit) return hit;
  const tags = lookUp(tag);
  if (known.size >= KNOWN_SLOTS) known.clear();
  known.set(tag, tags);
  return tags;
}

function lookUp(tag: string): readonly string[] {
  const subtags = subtagsOf(tag);
  if (!subtags) return NONE;
  const { language, script, region, variants } = subtags;
  const keys: string[] = [];
  for (const variant of variants) keys.push(`${language}-${variant}`);
  if (script && region) keys.push(`${language}-${script}-${region}`);
  if (script) keys.push(`${language}-${script}`);
  for (const variant of variants) keys.push(`*-${variant}`);
  if (script) keys.push(`*-${script}`);
  if (region) keys.push(`${language}-${region}`);
  keys.push(language);
  const all = entries();
  for (const key of keys) {
    const tags = all.get(key);
    if (tags) return tags;
  }
  return language.length === 3 ? [language.toUpperCase()] : NONE;
}
