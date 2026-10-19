/**
 * The whole recipe's files, highlighted on the server: the page's first
 * rows (WholeRecipe) and the page's `code.json` (every row).
 */
import { highlightLines } from "@/lib/cookbook/highlight";
import { readRecipeSources } from "@/lib/cookbook/sources";
import { KIT_ORDER } from "@/lib/cookbook/types";
import { codeLinesHtml, escapeHtml } from "./CodeLines";
import type { RecipeT, RecipeView } from "./model";
import type { WholeCode } from "./sources";

export type WholeFileId = "js" | "html" | "css";

interface Fold {
  from: number;
  to: number;
  label: string;
}

/** Lines in a string (a trailing newline does not open another line). */
const lineCount = (text: string) => (text === "" ? 0 : text.replace(/\n$/, "").split("\n").length);

/** The content literals' file names, in marker order (`content.en.md`,
 *  `content.notes.es.md`), falling back like composition does. */
function contentFiles(view: RecipeView): string[] {
  const { recipe, pen } = view;
  const sources = readRecipeSources(recipe.slug);
  const fallback = recipe.meta.sample.locales[0];
  return [...sources.script.matchAll(/\/\* @content(?::([a-z0-9-]+))?(?:@([a-z]{2}))? \*\/ ''/g)].map((m) => {
    const prefix = m[1] ? `${m[1]}.` : "";
    const own = m[2] ?? pen.variant; // `@ja`: that edition's file in every edition
    const variant = sources.content[`${prefix}${own}`] !== undefined ? own : fallback;
    return `content.${prefix}${variant}.md`;
  });
}

/** The script's folds: the Markdown sample and the kit, which are not the
 *  recipe's own code. */
function scriptFolds(view: RecipeView, t: RecipeT, total: number): Fold[] {
  const { pen } = view;
  const folds: Fold[] = [];
  const files = contentFiles(view);
  pen.ranges.content.forEach(([a, b], i) => {
    // The literal's first and last lines carry code (`const md = String.raw\`…`
    // and the closing backtick): they stay visible around the fold.
    if (b - a >= 2) folds.push({ from: a + 1, to: b - 1, label: t("contentFold", { count: b - a - 1, file: files[i] ?? "content.md" }) });
  });
  if (pen.ranges.kit) {
    const [a, b] = pen.ranges.kit;
    const blocks = KIT_ORDER.filter((block) => view.recipe.meta.kit.includes(block)).join(", ");
    folds.push({ from: a, to: Math.min(b, total), label: t("kitFold", { blocks, count: Math.min(b, total) - a + 1 }) });
  }
  return folds.sort((x, y) => x.from - y.from);
}

export interface Rendered {
  /** The inner HTML of the file's `<pre>`. */
  html: string;
  /** Every line is in `html` (no row budget was hit). */
  complete: boolean;
}

/** A file's lines as `<code>` grids, its folds as `<details>` (a closed
 *  fold is one row), up to `rows` rows. */
export function renderFile(
  lines: Parameters<typeof codeLinesHtml>[0]["lines"],
  total: number,
  folds: Fold[],
  rows: number,
  options: { anchors: boolean; linkNumbers: boolean },
): Rendered {
  let html = "";
  let left = rows;
  const code = (from: number, to: number) =>
    `<code class="cb-code-lines">${codeLinesHtml({ lines, from, to, ...options })}</code>`;
  const segments: ({ from: number; to: number; fold?: Fold })[] = [];
  let cursor = 1;
  for (const fold of folds) {
    if (fold.from > cursor) segments.push({ from: cursor, to: fold.from - 1 });
    segments.push({ from: fold.from, to: fold.to, fold });
    cursor = fold.to + 1;
  }
  if (cursor <= total) segments.push({ from: cursor, to: total });
  for (const { from, to, fold } of segments) {
    if (left <= 0) return { html, complete: false };
    if (fold) {
      // Opening a cut fold loads the whole file (WholeRecipeTabs).
      const end = Math.min(to, from + left - 1);
      html += `<details class="cb-fold"><summary>${escapeHtml(fold.label)}</summary>${code(from, end)}</details>`;
      left -= 1;
      if (end < to) return { html, complete: false };
    } else {
      const end = Math.min(to, from + left - 1);
      html += code(from, end);
      left -= end - from + 1;
      if (end < to) return { html, complete: false };
    }
  }
  return { html, complete: true };
}

export interface WholeFiles {
  panels: { id: WholeFileId; file: string; lines: number; eol: boolean; rendered: Rendered }[];
}

/** Every composed file of the recipe, highlighted, with line numbers and
 *  (script.js) `#L<n>` anchors; with `rows`, each cut to its first rows. */
export async function wholeFiles(view: RecipeView, t: RecipeT, rows = Infinity): Promise<WholeFiles> {
  const { pen, jsLines } = view;
  const total = lineCount(pen.js);
  const panels: WholeFiles["panels"] = [
    {
      id: "js",
      file: "script.js",
      lines: total,
      eol: pen.js.endsWith("\n"),
      rendered: renderFile(jsLines, total, scriptFolds(view, t, total), rows, { anchors: true, linkNumbers: true }),
    },
  ];
  for (const [id, file, code] of [
    ["html", "index.html", pen.html],
    ["css", "style.css", pen.css],
  ] as const) {
    if (!code) continue;
    const count = lineCount(code);
    const lines = await highlightLines(code, id);
    panels.push({
      id,
      file,
      lines: count,
      eol: code.endsWith("\n"),
      rendered: renderFile(lines, count, [], rows, { anchors: false, linkNumbers: false }),
    });
  }
  return { panels };
}

/** The page's `code.json`: every file whole. */
export async function wholeCode(view: RecipeView, t: RecipeT): Promise<WholeCode> {
  const { panels } = await wholeFiles(view, t);
  return Object.fromEntries(panels.map((p) => [p.id, { html: p.rendered.html, eol: p.eol }]));
}

