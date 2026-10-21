import { describe, expect, it } from "vitest";
import { partOf } from "./testing/parts";
import { serialize } from "next-mdx-remote/serialize";
import { getAllDocs, getDocSource } from "./docs";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { line: number } };
}

/** The `**` runs that did not become bold on a page, as the site's MDX
 *  parser reads it: asterisks left in the text, and bold nested in bold
 *  (a closer that cannot close becomes an opener and pairs with the next
 *  run). CommonMark closes `**` only when it is right-flanking, so
 *  `**粗体。**中文` (punctuation before, a letter after) stays literal; the
 *  docs move the punctuation out (`**粗体**。中文`) or write `<strong>`. */
async function strayEmphasis(source: string): Promise<string[]> {
  const found: string[] = [];
  const inspect = () => (tree: Node) => {
    const walk = (node: Node, inStrong: boolean) => {
      const line = node.position?.start.line;
      if (node.type === "strong" && inStrong) found.push(`${line}: bold inside bold`);
      // `(** †† ‡‡…)` is the doubled footnote symbol, written as such.
      if (node.type === "text" && node.value!.replace(/\*\* ††/g, "").includes("**")) {
        found.push(`${line}: ${node.value!.trim().slice(0, 60)}`);
      }
      for (const child of node.children ?? []) walk(child, inStrong || node.type === "strong");
    };
    walk(tree, false);
  };
  await serialize(source, { mdxOptions: { remarkPlugins: [inspect] } });
  return found;
}

/** Registers part `part` of `of` of the languages: one test per language,
 *  every page through the MDX compiler, about ten seconds for all of them
 *  on a workstation and ten to fifteen times as long on CI (#805). The
 *  docsEmphasis.part*.test.ts files share them (#1118). */
export function registerEmphasis(part: number, of: number): void {
  describe(`docs emphasis, part ${part} of ${of}`, () => {
    const locales = partOf([...new Set(getAllDocs().flatMap((doc) => Object.keys(doc.locales)))].sort(), part, of);
    it.each(locales)("leaves no literal ** on any %s page, CJK text included", async (locale) => {
      const stray: string[] = [];
      for (const doc of getAllDocs()) {
        if (!(locale in doc.locales)) continue;
        const page = getDocSource(doc.slug, locale)!;
        for (const hit of await strayEmphasis(page.source)) stray.push(`${doc.slug}-${locale}.mdx:${hit}`);
      }
      expect(stray).toEqual([]);
    }, 120_000);
  });
}
