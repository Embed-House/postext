import { describe, expect, it } from "vitest";
import { sandboxLink } from "./images.ts";
import { getAllRecipes } from "./recipes.ts";
import { recipeBundleCandidates } from "./sandboxBundles.ts";
import { LOCALES } from "./types.ts";

// Open in Sandbox opens the edition the recipe page shows (#737). The host's
// resolver never tried the edition a link names: a Catalan page opened the
// Spanish document, a Chinese, Japanese or Arabic one the English.

const urls = (slug: string, ...variants: string[]) => variants.map((v) => `/cookbook/${slug}/${v}/${slug}.postext`);

describe("recipeBundleCandidates (#737)", () => {
  it("tries the edition the link names first, then English and Spanish", () => {
    expect(recipeBundleCandidates("a-recipe", "ca")).toEqual(urls("a-recipe", "ca", "es", "en"));
    expect(recipeBundleCandidates("a-recipe", "zh")).toEqual(urls("a-recipe", "zh", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "ja")).toEqual(urls("a-recipe", "ja", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "ar")).toEqual(urls("a-recipe", "ar", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "pt")).toEqual(urls("a-recipe", "pt", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "es")).toEqual(urls("a-recipe", "es", "en"));
    expect(recipeBundleCandidates("a-recipe", "en")).toEqual(urls("a-recipe", "en", "es"));
  });

  it("reads the primary subtag of the tag the Sandbox made canonical", () => {
    expect(recipeBundleCandidates("a-recipe", "zh-Hans")).toEqual(urls("a-recipe", "zh", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "pt-BR")).toEqual(urls("a-recipe", "pt", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "ca-ES")).toEqual(urls("a-recipe", "ca", "es", "en"));
    expect(recipeBundleCandidates("a-recipe", "ES-mx")).toEqual(urls("a-recipe", "es", "en"));
    expect(recipeBundleCandidates("a-recipe", "pt_BR")).toEqual(urls("a-recipe", "pt", "en", "es"));
  });

  it("falls back on English and Spanish for no language and for one the Cookbook has no edition in", () => {
    expect(recipeBundleCandidates("a-recipe", null)).toEqual(urls("a-recipe", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "")).toEqual(urls("a-recipe", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "de")).toEqual(urls("a-recipe", "en", "es"));
    expect(recipeBundleCandidates("a-recipe", "fr-CA")).toEqual(urls("a-recipe", "en", "es"));
  });

  it("refuses a slug that is not a recipe's", () => {
    expect(recipeBundleCandidates("../secrets", "en")).toBeNull();
    expect(recipeBundleCandidates("A-Recipe", "en")).toBeNull();
    expect(recipeBundleCandidates("a/recipe", "en")).toBeNull();
    expect(recipeBundleCandidates("", "en")).toBeNull();
  });
});

describe("the recipe page and the Sandbox agree on the file (#737)", () => {
  it("the first candidate of every link the site builds is the bundle the page reports", () => {
    const recipes = getAllRecipes({ includeDrafts: true });
    let links = 0;
    const own: Record<string, number> = {};
    for (const recipe of recipes) {
      for (const locale of LOCALES) {
        const link = sandboxLink(recipe, locale);
        if (!link) continue;
        links++;
        const hash = new URLSearchParams(link.href.slice(link.href.indexOf("#") + 1));
        expect(hash.get("recipe"), link.href).toBe(recipe.slug);
        const candidates = recipeBundleCandidates(hash.get("recipe")!, hash.get("lang"));
        expect(candidates?.[0], link.href).toBe(link.bundle);
        if (link.variant === locale) own[locale] = (own[locale] ?? 0) + 1;
      }
    }
    expect(links).toBeGreaterThan(300);
    // Editions beyond English, Spanish and Portuguese are opened at last.
    for (const locale of ["ca", "zh", "ja", "ar"]) expect(own[locale], locale).toBeGreaterThan(0);
  });
});
