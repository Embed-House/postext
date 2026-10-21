import { describe, expect, it } from "vitest";
import { partOf } from "../testing/parts";
import { lintRecipe, previewDraftsAllowed } from "./lint.ts";
import { listRecipeSlugs } from "./sources.ts";

/** Registers part `part` of `of` of the recipes, each linted as `pnpm
 *  cookbook lint` lints it in every edition; with COOKBOOK_PREVIEW=1, as
 *  `--engine local` (a draft may preview the next release). The whole
 *  Cookbook took half a minute in one test: the recipeLint.part*.test.ts
 *  files share it (#1118). */
export function registerRecipeLint(part: number, of: number): void {
  describe(`recipe pens, part ${part} of ${of}`, () => {
    it("pass the lint in every edition", () => {
      const preview = previewDraftsAllowed();
      const failures = partOf(listRecipeSlugs(), part, of).flatMap((slug) => lintRecipe(slug, { preview }).fails.map((f) => `${slug}: ${f}`));
      expect(failures).toEqual([]);
    }, 120_000);
  });
}
