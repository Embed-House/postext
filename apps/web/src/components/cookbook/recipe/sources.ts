import type { PenJson } from "@/lib/cookbook/types";

/** The id of the `<script type="application/json">` that carries each
 *  edition's pen.json (spec §4.3, payload discipline). The files themselves
 *  are not embedded: they come from the page's `code.json` (below). */
export const SOURCES_ID = "recipe-sources";

export interface RecipeSourcesPayload {
  [variant: string]: { pen: PenJson };
}

/** A composed file of the whole recipe: its highlighted lines, folds
 *  included, as the inner HTML of its `<pre>`, and whether the file ends
 *  with a newline. */
export interface WholeFile {
  html: string;
  eol: boolean;
}

/** `/<locale>/cookbook/<slug>/code.json`: every composed file of the page,
 *  whole. The page itself carries only each file's first lines (what the
 *  collapsed block shows): the whole script is ~340 KB of markup, and on
 *  the page it travelled three times (the HTML, the RSC payload in it and
 *  the `.rsc` file) in every locale. */
export type WholeCode = Partial<Record<"js" | "html" | "css", WholeFile>>;

export const wholeCodeUrl = (locale: string, slug: string) => `/${locale}/cookbook/${slug}/code.json`;

/** Lines shown before "Show all" (recipe.css sizes the block to match). */
export const COLLAPSED_LINES = 40;
/** Rows the page renders of each file before `code.json` arrives: the
 *  collapsed block and its fade, a fold's summary counting as one row
 *  (a line that wraps only makes the block fill sooner). */
export const HEAD_ROWS = 48;
