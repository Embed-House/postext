import { describe, expect, it } from "vitest";
import type { DocEntry } from "@/lib/docs";
import { docNumbers } from "./docNumbers";

const doc = (slug: string, parent = ""): DocEntry => ({
  slug,
  locales: {
    en: { slug, title: slug, sidebarTitle: slug, description: "", lang: "en", lastUpdated: "", readingTime: "", order: 0, parent, plainSummary: "" },
  },
});

describe("docNumbers", () => {
  it("numbers chapters in order and their pages under them", () => {
    const n = docNumbers([doc("intro"), doc("config"), doc("config-a", "config"), doc("config-b", "config"), doc("format")], "en");
    expect([...n.entries()]).toEqual([
      ["intro", "1"],
      ["config", "2"],
      ["config-a", "2.1"],
      ["config-b", "2.2"],
      ["format", "3"],
    ]);
  });

  it("counts a page whose parent is missing as a chapter", () => {
    expect(docNumbers([doc("a"), doc("b-1", "b")], "en").get("b-1")).toBe("2");
  });
});
