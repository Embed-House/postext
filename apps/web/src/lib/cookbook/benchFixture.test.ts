import path from "node:path";
import { describe, expect, it } from "vitest";

// The bench's fixture recipe read the way the CLI reads it under
// COOKBOOK_RECIPES_DIR (#869): its own folder of recipes, the kit and the
// registries still from cookbook/. Set before the modules load, which read
// the folder once.
process.env.COOKBOOK_RECIPES_DIR = path.join(__dirname, "fixtures", "recipes");
const { RECIPES_DIR, COOKBOOK_DIR, KIT_DIR } = await import("./paths.ts");
const { listRecipeSlugs, readRecipeSources } = await import("./sources.ts");
const { lintRecipe } = await import("./lint.ts");
const { sourceHash } = await import("./hash.ts");
const { readRecipeMeta } = await import("./sources.ts");

describe("COOKBOOK_RECIPES_DIR: the bench's fixture recipe", () => {
  it("lists the fixture's folder alone, with the kit from cookbook/", () => {
    expect(RECIPES_DIR).toBe(path.join(__dirname, "fixtures", "recipes"));
    expect(KIT_DIR).toBe(path.join(COOKBOOK_DIR, "_kit"));
    expect(listRecipeSlugs()).toEqual(["composed-bench"]);
    expect(Object.keys(readRecipeSources("composed-bench").content).sort()).toEqual(["ca", "en", "es"]);
    expect(sourceHash("composed-bench", readRecipeMeta("composed-bench"))).toMatch(/^[0-9a-f]{8,}$/);
  });

  it("lints its three sample editions and their Markdown clean; only the write-ups a published recipe needs are missing", () => {
    const report = lintRecipe("composed-bench", { knownSlugs: ["composed-bench"] });
    const about = (re: RegExp) => [...report.fails, ...report.warns].filter((line) => re.test(line));
    expect(about(/^content\.|^script\.js|sample|::resource|:::|::::/)).toEqual([]);
    expect(report.fails.filter((line) => !/\.mdx is missing|^recipe\.json › /.test(line))).toEqual([]);
  });
});
