import type { RecipeT, RecipeView } from "./model";
import type { RecipeActionsData } from "./RecipeActions";
import { HEAD_ROWS } from "./sources";
import { wholeFiles } from "./wholeFiles";
import { WholeRecipeTabs, type WholeRecipePanel } from "./WholeRecipeTabs";
import { NewTabNote } from "@/components/ui/NewTabNote";

/** "The whole recipe" (generated): every composed file in tabs, highlighted
 *  on the server with line numbers and `#L<n>` anchors; the Markdown sample
 *  and the kit fold into `<details>`, since they are not the recipe's own
 *  code. The page carries each file's first rows; the rest comes from
 *  `code.json` (WholeRecipeTabs). Server component. */
export async function WholeRecipe({ view, t, data }: { view: RecipeView; t: RecipeT; data: RecipeActionsData }) {
  const { panels } = await wholeFiles(view, t, HEAD_ROWS);
  const tabs: WholeRecipePanel[] = panels.map(({ id, file, lines, rendered }) => ({
    id,
    file,
    lines,
    head: rendered.html,
    complete: rendered.complete,
  }));

  return (
    <>
      <WholeRecipeTabs panels={tabs} data={data} />
      <p className="cb-whole-note">
        {t("howToRun")}{" "}
        <a href={view.githubUrl} target="_blank" rel="noopener noreferrer">
          {t("recipeFolder")} <span className="inline-block rtl:-scale-x-100">↗</span>
          <NewTabNote />
        </a>
      </p>
    </>
  );
}
