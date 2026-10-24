"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

// The recipe page's exact Sandbox URL (the edition its band opens), set by
// <RecipeSandboxTarget> while that page is mounted. The navbar lives in the
// Cookbook layout, which never sees the recipe.
let recipeHref: string | null = null;
const listeners = new Set<() => void>();

function setRecipeHref(href: string | null) {
  recipeHref = href;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hands the navbar's Sandbox button the recipe's own Sandbox URL. */
export function RecipeSandboxTarget({ href }: { href: string }) {
  useEffect(() => {
    setRecipeHref(href);
    return () => setRecipeHref(null);
  }, [href]);
  return null;
}

/** The recipe slug of a locale-less `/cookbook/<slug>` path, or null. */
function recipeSlugOf(pathname: string): string | null {
  return /^\/cookbook\/([a-z0-9-]+)$/.exec(pathname)?.[1] ?? null;
}

/**
 * The navbar's call to action (#1247). On a recipe page it reads "Open in
 * Sandbox" and opens that recipe, as the band's action does: readers took
 * "Open the Sandbox" for it and landed on an empty Sandbox. Everywhere else
 * it opens the Sandbox.
 */
export function SandboxCta({
  label,
  recipeLabel,
  recipeTitle,
  className,
}: {
  label: string;
  recipeLabel: string;
  recipeTitle: string;
  className: string;
}) {
  const slug = recipeSlugOf(usePathname());
  const locale = useLocale();
  const href = useSyncExternalStore(subscribe, () => recipeHref, () => null);
  if (!slug) {
    return (
      <Link href="/sandbox" className={className}>
        {label}
      </Link>
    );
  }
  // Before the page hands over its URL, the Sandbox picks the edition from
  // the language (sandboxBundles.ts).
  return (
    <a href={href ?? `/${locale}/sandbox#recipe=${slug}&lang=${locale}`} title={recipeTitle} className={className}>
      {recipeLabel}
    </a>
  );
}
