import type { PlateRecipe } from "@/components/cookbook/RecipeCard";
import type { Catalog, CatalogRecipe } from "@/lib/cookbook/types";

export type PlateFacets = Pick<Catalog["facets"], "levels" | "genres">;

/** The fields a plate shows, nothing else: the server book view passes
 *  these rows to `PlateGrid`, so the RSC payload carries them
 *  instead of every plate's rendered tree. */
export function toPlate(r: CatalogRecipe): PlateRecipe {
  return {
    slug: r.slug,
    number: r.number,
    title: r.title,
    summary: r.summary,
    href: r.href,
    level: r.level,
    // The plate names the first genre only.
    genres: r.genres.slice(0, 1),
    outputs: r.outputs,
    pages: r.pages,
    gap: r.gap,
    ...(r.draft ? { draft: r.draft } : {}),
    card: r.card,
  };
}

/** The facet titles the given plates name (their level and first genre). */
export function plateFacets(facets: PlateFacets, plates: PlateRecipe[]): PlateFacets {
  const genres = new Set(plates.map((p) => p.genres[0]));
  return { levels: facets.levels, genres: facets.genres.filter((g) => genres.has(g.id)) };
}
