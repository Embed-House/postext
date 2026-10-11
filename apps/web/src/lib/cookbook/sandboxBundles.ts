import { SAMPLE_LOCALES } from "./types.ts";
import type { SampleLocale } from "./types.ts";

const RECIPE_SLUG = /^[a-z0-9-]+$/;

/** A recipe's `.postext` bundle as the capture writes it, beside its pages. */
export function recipeBundleUrl(slug: string, variant: SampleLocale): string {
  return `/cookbook/${slug}/${variant}/${slug}.postext`;
}

/** The edition a language tag names: its primary subtag, when it is one of
 *  the Cookbook's sample languages (`zh-Hans` → zh, `pt-BR` → pt). */
function editionOf(lang: string | null): SampleLocale | null {
  const primary = (lang ?? "").split(/[-_]/)[0]!.toLowerCase();
  return SAMPLE_LOCALES.find((locale) => locale === primary) ?? null;
}

/**
 * Cookbook recipes open in the Sandbox by link: `#recipe=<slug>&lang=<tag>`
 * names the recipe's `.postext` bundle, which the capture writes next to its
 * pages (`public/cookbook/<slug>/<variant>/<slug>.postext`). The Sandbox
 * tries the URLs in order and a 404 moves on to the next, so the list starts
 * with the edition the link names (#737: a Catalan, Chinese, Japanese or
 * Arabic page used to open the Spanish or the English document) and goes on
 * with the editions most recipes have: English and Spanish, the nearer one
 * first (Spanish for a Catalan link). A recipe captured in fewer languages
 * than the site has still opens from every language's link. Null for a
 * slug that is not a recipe's.
 */
export function recipeBundleCandidates(slug: string, lang: string | null): string[] | null {
  if (!RECIPE_SLUG.test(slug)) return null;
  const edition = editionOf(lang);
  const rest: SampleLocale[] = edition === "es" || edition === "ca" ? ["es", "en"] : ["en", "es"];
  const variants = edition ? [edition, ...rest.filter((variant) => variant !== edition)] : rest;
  return variants.map((variant) => recipeBundleUrl(slug, variant));
}
