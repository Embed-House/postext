// The site's search, as the search palette and the WebMCP tools run it:
// one index of the docs' sections and one of the Cookbook's entries, per
// language.

import MiniSearch from "minisearch";
import type { SearchSection } from "@/lib/docs";
import { cjkAwareTokenizer, makeProcessTerm, searchLocale, tokenize } from "@/lib/cookbook/search";

/** MiniSearch's own word splitting, with Chinese and Japanese runs cut into
 *  characters and pairs. */
const docsTokenize = cjkAwareTokenizer(MiniSearch.getDefault("tokenize") as (text: string) => string[]);

/** The docs' sections. Chinese and Japanese have no spaces between words,
 *  so a zh or ja index splits its text with the Cookbook's tokenizer
 *  (characters and character pairs, kana folded, particles cut). The other languages keep MiniSearch's word splitting and term
 *  handling, except for the Chinese or Japanese a page quotes (縦中横,
 *  ルビ), which is cut the same way, so a query typed in kana or hanzi
 *  finds it on any locale's pages. */
export function docsIndex(sections: SearchSection[], locale: string): MiniSearch<SearchSection> {
  const lang = searchLocale(locale);
  const cjk = lang === "zh" || lang === "ja";
  const ms = new MiniSearch<SearchSection>({
    ...(cjk ? { tokenize, processTerm: makeProcessTerm(lang) } : { tokenize: docsTokenize }),
    fields: ["sectionTitle", "docTitle", "breadcrumb", "body"],
    storeFields: ["id"],
    idField: "id",
    searchOptions: {
      boost: { sectionTitle: 3, docTitle: 2, breadcrumb: 1.5 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
  ms.addAll(sections);
  return ms;
}

/** The Cookbook's entries, indexed with the gallery's tokenizer (camelCase
 *  and dotted config paths split, accents and plurals folded). */
export function cookbookIndex(entries: SearchSection[], locale: string): MiniSearch<SearchSection> {
  const ms = new MiniSearch<SearchSection>({
    fields: ["sectionTitle", "breadcrumb", "body"],
    storeFields: ["id"],
    idField: "id",
    tokenize,
    processTerm: makeProcessTerm(searchLocale(locale)),
    searchOptions: {
      boost: { sectionTitle: 3, breadcrumb: 1.5 },
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
    },
  });
  ms.addAll(entries);
  return ms;
}
