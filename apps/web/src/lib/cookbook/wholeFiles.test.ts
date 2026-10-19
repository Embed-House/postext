import { describe, expect, it } from "vitest";
import { renderFile } from "@/components/cookbook/recipe/wholeFiles";

const lines = Array.from({ length: 100 }, (_, i) => [{ content: `line ${i + 1}` }]);
const opts = { anchors: true, linkNumbers: true };
const ids = (html: string) => [...html.matchAll(/id="L(\d+)"/g)].map((m) => Number(m[1]));

describe("renderFile", () => {
  it("renders every line when no budget is hit", () => {
    const { html, complete } = renderFile(lines, 100, [], Infinity, opts);
    expect(complete).toBe(true);
    expect(ids(html)).toHaveLength(100);
  });

  it("cuts a file to its first rows", () => {
    const { html, complete } = renderFile(lines, 100, [], 48, opts);
    expect(complete).toBe(false);
    expect(ids(html)).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
  });

  it("counts a closed fold as one row and cuts its body to the rows left", () => {
    const folds = [{ from: 11, to: 90, label: "80 lines <content.en.md>" }];
    const { html, complete } = renderFile(lines, 100, folds, 20, opts);
    expect(complete).toBe(false);
    expect(html).toContain("<summary>80 lines &lt;content.en.md&gt;</summary>");
    // Lines 1–10, then the fold (one row) holding the 10 rows left.
    expect(ids(html)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("goes on after a fold that fits, which took one row", () => {
    const folds = [{ from: 3, to: 7, label: "fold" }];
    const { html, complete } = renderFile(lines, 100, folds, 8, opts);
    expect(complete).toBe(false);
    // 1–2, the fold (3–7, one row), then 8–12 for the five rows left.
    expect(ids(html)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});
