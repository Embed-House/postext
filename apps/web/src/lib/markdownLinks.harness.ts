import { describe, expect, it } from "vitest";
import { markdownPaths, pageMarkdown } from "./markdown";
import { partOf } from "./testing/parts";

/** Registers part `part` of `of` of the locales whose Markdown renditions
 *  must hold no site-relative link or stray inline HTML (nor so in
 *  llms-full.txt): seven locales took about 95 s in one test, so the
 *  markdownLinks.part*.test.ts files share them (#1118). */
export function registerRenditionLinks(part: number, of: number): void {
  describe(`markdown renditions, part ${part} of ${of}`, () => {
    it.each(partOf(["en", "es", "ca", "zh", "ja", "ar", "pt"], part, of))("leave no site-relative link or stray inline HTML in %s", (locale) => {
      // One assertion at the end: an expect per line made this test outlast CI's timeout.
      const offending: string[] = [];
      for (const path of markdownPaths(locale)) {
        // Prose only: fenced blocks and code spans hold samples.
        let fence = false;
        for (const line of pageMarkdown(locale, path)!.split("\n")) {
          if (/^\s*(```|~~~)/.test(line)) fence = !fence;
          if (fence) continue;
          const prose = line.replace(/(`+)[\s\S]*?\1/g, "");
          if (/\]\(\/(?!\/)/.test(prose) || /<\/?(?:a|em|strong|code)\b[^>]*>/.test(prose)) {
            offending.push(`${locale}${path}: ${prose}`);
          }
        }
      }
      expect(offending).toEqual([]);
      // It took 342 s for all seven when every doc rendition reread the docs folder.
    }, 300_000);
  });
}
