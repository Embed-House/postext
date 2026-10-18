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

/** The languages a recipe was captured in, in the Cookbook's order: the
 *  variants its `capture.json` lists (the capture writes one bundle per
 *  variant). Pure. */
export function captureVariants(capture: unknown): SampleLocale[] {
  const variants = (capture as { variants?: unknown } | null)?.variants;
  if (!variants || typeof variants !== "object") return [];
  return SAMPLE_LOCALES.filter((locale) => locale in variants);
}

/**
 * The editions of a recipe for the Sandbox's language switcher (#1011): the
 * languages its capture wrote a bundle in, read from
 * `public/cookbook/<slug>/capture.json`. Null for a slug that is not a
 * recipe's, or a capture the site does not have.
 */
export async function recipeBundleEditions(slug: string): Promise<string[] | null> {
  if (!RECIPE_SLUG.test(slug)) return null;
  try {
    const res = await fetch(`/cookbook/${slug}/capture.json`, { cache: "no-cache" });
    if (!res.ok) return null;
    const variants = captureVariants(await res.json());
    return variants.length > 0 ? variants : null;
  } catch {
    return null;
  }
}
