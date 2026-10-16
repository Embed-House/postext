import { describe, expect, it } from "vitest";
import { buildDocument, type PostextConfig } from "postext";
import { firstPageIsRecto } from "./postext";
import { spreadOfPage, spreadsOf } from "./spreads";

// #861: the two pages of a spread template open together in the Folio, the
// verso facing the recto, in a left-bound and a right-bound book alike
// (only the viewer mirrors a right-bound one).

class StubCtx {
  font = "";
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const mm = (value: number) => ({ value, unit: "mm" as const });
const config: PostextConfig = {
  page: { width: mm(200), height: mm(260), margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } as never,
  pageTemplates: [{ id: "tl", spread: true, frames: [{ name: "band", crossGutter: true, height: mm(20) }] }],
};
const markdown = "Before.\n\n:::pagebreak\n\nMore.\n\n::::page{template=\"tl\" spread}\n:::frame{slot=\"band\"}\nAcross the spine\n:::\n::::\n\nAfter.";

describe("a spread template in the Folio (#861)", () => {
  for (const direction of ["ltr", "rtl"] as const) {
    it(`opens its two pages as one spread (${direction})`, () => {
      const doc = buildDocument({ markdown }, { ...config, ...(direction === "rtl" ? { direction: "rtl" } : {}) } as PostextConfig);
      const [verso, recto] = doc.pages.filter((p) => p.composed?.spread);
      expect(verso!.index % 2).toBe(1);
      const spreads = spreadsOf(doc.pages.length, firstPageIsRecto(doc));
      expect(spreads[spreadOfPage(spreads, verso!.index)]).toEqual([verso!.index, recto!.index]);
      expect(verso!.composed!.spread).toBe(direction === "rtl" ? "right" : "left");
    });
  }
});
