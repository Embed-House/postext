import { describe, expect, it } from "vitest";
import { runTool, type WebMcpTool } from "postext-sandbox/webmcp";
import { buildCatalogWire } from "@/lib/cookbook/catalog";
import { buildSearchIndex } from "@/lib/docs";
import { pageMarkdown } from "@/lib/markdown";
import { createSiteTools, type SiteToolDeps } from "./siteTools";

/** The site answered from its own sources: what the routes serve. */
function harness(over: Partial<SiteToolDeps> = {}) {
  const went: { path: string; locale: string }[] = [];
  let theme: "light" | "dark" = "dark";
  const respond = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body, text: async () => String(body) });
  const deps: SiteToolDeps = {
    locale: () => "en",
    path: () => "/docs/sandbox",
    address: () => "/docs/sandbox#props",
    title: () => "The Sandbox",
    navigate: (path, locale) => { went.push({ path, locale }); },
    theme: { get: () => theme, set: (t) => { theme = t; } },
    fetch: async (url, init) => {
      const [, locale, ...rest] = url.split("/");
      const path = rest.join("/");
      if (path === "docs/search-index") return respond({ locale, sections: buildSearchIndex(locale!) });
      if (path === "cookbook/catalog.json") return respond(buildCatalogWire(locale as Parameters<typeof buildCatalogWire>[0]));
      if (init?.method === "HEAD") return respond("", url.startsWith("/cookbook/accessible-tagged-pdf/es/"));
      if (url.endsWith(".md")) {
        const markdown = pageMarkdown(locale!, path.replace(/\.md$/, ""));
        return markdown === null ? respond("", false) : respond(markdown);
      }
      return respond("", false);
    },
    ...over,
  };
  const tools = new Map<string, WebMcpTool>(createSiteTools(deps).map((t) => [t.name, t]));
  const call = (name: string, args: Record<string, unknown> = {}) => runTool(tools.get(name)!, args) as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { call, tools, went, theme: () => theme };
}

describe("the site's WebMCP tools", () => {
  it("are named apart and described", () => {
    const { tools } = harness();
    expect([...tools.keys()]).toEqual([
      "site_get_context", "site_search", "site_read_page", "site_open_page",
      "site_list_recipes", "site_open_recipe_in_sandbox", "site_lookup_term", "site_set_preferences",
    ]);
    for (const tool of tools.values()) {
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("say where the reader is and what the site holds", async () => {
    const { call } = harness();
    const context = await call("site_get_context");
    expect(context.page).toEqual({ path: "/docs/sandbox", title: "The Sandbox" });
    expect(context.languages).toHaveLength(8);
    expect(context.docs.map((d: { path: string }) => d.path)).toContain("/docs/configuration");
  });

  it("search the docs and the Cookbook as the palette does", async () => {
    const { call } = harness();
    const found = await call("site_search", { query: "baseline grid" });
    expect(found.docs.length).toBeGreaterThan(0);
    expect(found.docs[0].path).toMatch(/^\/docs\//);
    expect(found.docs[0].excerpt.length).toBeGreaterThan(10);
    expect(found.recipes.every((r: { path: string }) => r.path.startsWith("/cookbook"))).toBe(true);
    expect((await call("site_search", { query: "zzzqqqxxx" })).note).toMatch(/Nothing matched/);
    expect((await call("site_search", { query: "grid", language: "xx" })).error).toMatch(/Invalid arguments: language must be one of "en"/);
  });

  it("read a page as Markdown, in parts", async () => {
    const { call } = harness();
    const page = await call("site_read_page", { path: "/docs/sandbox", length: 600 });
    expect(page.markdown).toHaveLength(600);
    expect(page.nextOffset).toBe(600);
    const rest = await call("site_read_page", { path: "https://postext.dev/en/docs/sandbox.md", offset: page.characters - 50 });
    expect(rest.markdown).toHaveLength(50);
    expect(rest.nextOffset).toBeUndefined();
    expect((await call("site_read_page", { path: "/docs/no-such-page" })).error).toMatch(/No page at \/docs\/no-such-page \(404\)/);
    expect((await call("site_read_page", { path: "/admin" })).error).toMatch(/is not a page of the site/);
  });

  it("go to a page, in a language", async () => {
    const { call, went } = harness();
    expect(await call("site_open_page", { path: "docs/configuration#page", language: "es" })).toEqual({ ok: true, opened: "/docs/configuration#page", language: "es" });
    await call("site_open_page", { path: "/es/cookbook?q=tablas" });
    expect(went).toEqual([{ path: "/docs/configuration#page", locale: "es" }, { path: "/cookbook?q=tablas", locale: "en" }]);
  });

  it("list the recipes, and open one in the Sandbox", async () => {
    const { call, went } = harness();
    const all = await call("site_list_recipes", { limit: 5 });
    expect(all.total).toBeGreaterThan(100);
    expect(all.recipes).toHaveLength(5);
    expect(all.more).toBe(all.total - 5);
    const pdf = await call("site_list_recipes", { query: "tagged pdf" });
    expect(pdf.recipes.map((r: { slug: string }) => r.slug)).toContain("accessible-tagged-pdf");
    expect((await call("site_list_recipes", { chapter: "nope" })).error).toMatch(/No chapter "nope"/);
    // The recipe's book in the reader's language, or in one every recipe has.
    const opened = await call("site_open_recipe_in_sandbox", { slug: "accessible-tagged-pdf" });
    expect(opened.opened).toBe("/sandbox#recipe=accessible-tagged-pdf&lang=es");
    expect(went).toEqual([{ path: "/sandbox#recipe=accessible-tagged-pdf&lang=es", locale: "en" }]);
    expect((await call("site_open_recipe_in_sandbox", { slug: "no-such-recipe" })).error).toMatch(/has no book to open in the Sandbox/);
    expect((await call("site_open_recipe_in_sandbox", { slug: "../x" })).error).toMatch(/lowercase letters/);
  });

  it("look a term up", async () => {
    const { call } = harness();
    const found = await call("site_lookup_term", { term: "widow" });
    expect(found.terms[0].term.toLowerCase()).toContain("widow");
    expect(found.terms[0].path).toMatch(/^\/glossary#/);
    expect((await call("site_lookup_term", { term: "zzzqqq" })).note).toMatch(/Not in the glossary/);
  });

  it("switch language and theme", async () => {
    const { call, went, theme } = harness();
    expect(await call("site_set_preferences", { theme: "light" })).toEqual({ ok: true, language: "en", theme: "light" });
    expect(theme()).toBe("light");
    await call("site_set_preferences", { language: "ja" });
    expect(went).toEqual([{ path: "/docs/sandbox#props", locale: "ja" }]);
    expect((await call("site_set_preferences", {})).error).toMatch(/Give a language, a theme, or both/);
    expect((await call("site_set_preferences", { language: "de" })).error).toMatch(/Invalid arguments/);
  });
});
