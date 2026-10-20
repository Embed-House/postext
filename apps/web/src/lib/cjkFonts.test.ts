import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CJK_FACES, cjkCorpus, cjkDir, coveredChars, readCjkManifest, unicodeRange } from "./cjkFonts";

const WEB_DIR = process.cwd();
const manifest = readCjkManifest(WEB_DIR);
const FIX = "run `pnpm --filter web fonts:cjk` and commit apps/web/src/components/fonts/cjk";

describe("CJK font slices (#1050)", () => {
  for (const face of CJK_FACES) {
    it(`${face.family} covers every character the ${face.script} sources set`, () => {
      const covered = coveredChars(manifest, face.key);
      const missing = [...cjkCorpus(WEB_DIR, face)].filter((c) => !covered.has(c));
      expect(missing.join(""), `${missing.length} characters would fall to a system face: ${FIX}`).toBe("");
    });
  }

  it("slices do not overlap, and each has its file and its @font-face rule", () => {
    const css = fs.readFileSync(path.join(cjkDir(WEB_DIR), "cjk.css"), "utf8");
    for (const face of CJK_FACES) {
      const seen = new Set<string>();
      for (const slice of manifest.faces[face.key].slices) {
        for (const c of slice.chars) {
          expect(seen.has(c), `${face.family}: ${c} in two slices`).toBe(false);
          seen.add(c);
        }
        const file = `${face.slug}-${slice.id}.woff2`;
        expect(fs.existsSync(path.join(cjkDir(WEB_DIR), file)), file).toBe(true);
        expect(css).toContain(`url("./${file}") format("woff2");unicode-range:${unicodeRange(slice.chars)}}`);
      }
    }
  });

  it("merges runs of code points in a unicode-range", () => {
    expect(unicodeRange("あいう中")).toBe("U+3042,U+3044,U+3046,U+4E2D");
    expect(unicodeRange("ぁあぃい")).toBe("U+3041-3044");
    expect(unicodeRange("𠀀𠀁")).toBe("U+20000-20001");
  });
});
