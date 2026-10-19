import { getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { recipeView } from "@/components/cookbook/recipe/model";
import { wholeCode } from "@/components/cookbook/recipe/wholeFiles";
import { getRecipe, getVisibleRecipes } from "@/lib/cookbook/recipes";
import type { Locale } from "@/lib/cookbook/types";

// The page's whole recipe, every composed file highlighted (sources.ts,
// `WholeCode`), fetched by the page when it is needed. Static per locale
// and recipe; the dotted segment skips the locale proxy (like catalog.json).
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  const slugs = getVisibleRecipes().map((r) => r.slug);
  return routing.locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function GET(_req: Request, ctx: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await ctx.params;
  const recipe = hasLocale(routing.locales, locale) ? getRecipe(slug) : null;
  const view = recipe ? await recipeView(recipe, locale as Locale) : null;
  if (!view) return new Response("Not found", { status: 404 });
  const t = await getTranslations({ locale, namespace: "CookbookRecipe" });
  return Response.json(await wholeCode(view, t));
}
