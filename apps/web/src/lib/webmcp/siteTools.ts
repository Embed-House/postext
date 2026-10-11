// The site's own WebMCP tools, on every page: find a page, read it as
// Markdown, go to it, browse the Cookbook, open a recipe in the Sandbox,
// look a term up, switch language and theme. The Sandbox adds its own
// (`sandbox_*`, from the postext-sandbox package) while it is on screen.
//
// Everything the tools touch comes in as `deps`, so they run in a test
// without a browser.

import type MiniSearch from "minisearch";
import { ToolError, type WebMcpTool } from "postext-sandbox/webmcp";
import { LOCALE_INFO, isSiteLocale, type SiteLocale } from "@/i18n/locales";
import { cookbookPaletteEntries } from "@/lib/cookbook/search";
import type { Catalog } from "@/lib/cookbook/types";
import { unpackCatalog, type PackedCatalog } from "@/lib/cookbook/wire";
import type { SearchSection } from "@/lib/docs";
import { foldQuery, phraseTier, rankByPhrase } from "@/lib/searchPhrase";
import { cookbookIndex, docsIndex } from "@/lib/siteSearch";

export interface SiteToolDeps {
  /** The route language (`en`, `es`…). */
  locale: () => string;
  /** The page on screen, without its language: `/docs/sandbox`. */
  path: () => string;
  /** The same with what follows it in the address: `/cookbook?q=tables#top`. */
  address: () => string;
  title: () => string;
  /** Go to a page of the site (`/cookbook/drop-caps#how`), in a language. */
  navigate: (path: string, locale: string) => void;
  theme: { get: () => "light" | "dark"; set: (theme: "light" | "dark") => void };
  fetch: (url: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
}

/** The sections of the site a path may start with. */
const SECTIONS = ["docs", "cookbook", "glossary", "sandbox", "license", "privacy-policy", "cookie-policy", "accessibility"] as const;

const LANGUAGE_PARAM = {
  type: "string",
  enum: Object.keys(LOCALE_INFO),
  description: "The language (the one on screen when left out).",
} as const;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** The part of `body` around the first word of the query found in it. */
function excerpt(body: string, query: string, length = 220): string {
  const text = body.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const at = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 60);
  return `${start > 0 ? "…" : ""}${clip(text.slice(start), length)}`;
}

export function createSiteTools(deps: SiteToolDeps): WebMcpTool[] {
  // What a language's search reads, fetched once per language.
  const loaded = new Map<string, Promise<{ sections: SearchSection[]; catalog: Catalog | null }>>();
  const indexes = new Map<string, { docs: MiniSearch<SearchSection> | null; cookbook: MiniSearch<SearchSection> | null; byId: Map<string, SearchSection> }>();

  const localeOf = (language: unknown): SiteLocale => {
    const wanted = (language as string | undefined) ?? deps.locale();
    if (!isSiteLocale(wanted)) throw new ToolError(`The site is not in "${wanted}". Its languages: ${Object.keys(LOCALE_INFO).join(", ")}.`);
    return wanted;
  };

  const load = (locale: string) => {
    let pending = loaded.get(locale);
    if (!pending) {
      pending = (async () => {
        const [docs, packed] = await Promise.all([
          deps.fetch(`/${locale}/docs/search-index`).then((r) => (r.ok ? (r.json() as Promise<{ sections?: SearchSection[] }>) : null)).catch(() => null),
          deps.fetch(`/${locale}/cookbook/catalog.json`).then((r) => (r.ok ? (r.json() as Promise<Catalog | PackedCatalog>) : null)).catch(() => null),
        ]);
        return { sections: docs?.sections ?? [], catalog: packed ? unpackCatalog(packed) : null };
      })();
      loaded.set(locale, pending);
      // A failed load is tried again on the next call.
      pending.then((data) => { if (data.sections.length === 0 && !data.catalog) loaded.delete(locale); }, () => loaded.delete(locale));
    }
    return pending;
  };

  const catalogOf = async (locale: string): Promise<Catalog> => {
    const { catalog } = await load(locale);
    if (!catalog) throw new ToolError("The Cookbook's catalogue could not be loaded; try again.");
    return catalog;
  };

  /** A path of the site, checked: `/docs/sandbox`, `/` for the home page. */
  const pathOf = (value: unknown): string => {
    let path = String(value ?? "").trim();
    // A full address of this site, or a path with its language, is taken too.
    path = path.replace(/^https?:\/\/[^/]+/, "").replace(/\.md(?=$|[?#])/, "");
    const first = path.split(/[/?#]/)[1] ?? "";
    if (isSiteLocale(first)) path = path.slice(first.length + 1) || "/";
    if (!path.startsWith("/")) path = `/${path}`;
    const section = path.split(/[/?#]/)[1] ?? "";
    if (section !== "" && !(SECTIONS as readonly string[]).includes(section)) {
      throw new ToolError(`"${path}" is not a page of the site. Paths start with / (the home page) or one of: ${SECTIONS.map((s) => `/${s}`).join(", ")}.`);
    }
    return path;
  };

  const getContext: WebMcpTool = {
    name: "site_get_context",
    title: "Postext site: where you are",
    description: "The page of postext.dev on screen, its language and theme, the languages the site is in, its main sections and every page of the documentation. postext.dev documents Postext, an open-source layout engine that sets Markdown as books, magazines and textbooks in the browser; its Sandbox (/sandbox) is the editor, and offers its own tools (sandbox_*) while it is the page on screen.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const locale = deps.locale();
      const { sections } = await load(locale);
      const docs = new Map<string, string>();
      for (const s of sections) if (s.kind === "doc" && !docs.has(s.slug)) docs.set(s.slug, s.docTitle);
      return {
        page: { path: deps.path(), title: deps.title() },
        language: locale,
        languages: Object.entries(LOCALE_INFO).map(([code, info]) => ({ code, name: info.name })),
        theme: deps.theme.get(),
        sections: [
          { path: "/", about: "What Postext is, with samples and the install line" },
          { path: "/docs", about: "The documentation" },
          { path: "/cookbook", about: "Recipes: one layout problem each, with the Markdown, the settings and the pages they give" },
          { path: "/sandbox", about: "The editor: write, design, preview and export a book in the browser" },
          { path: "/glossary", about: "Typographic and typesetting terms" },
        ],
        docs: [...docs].map(([slug, title]) => ({ path: `/docs/${slug}`, title })),
      };
    },
  };

  const search: WebMcpTool = {
    name: "site_search",
    title: "Postext site: search",
    description: "Search the documentation and the Cookbook of postext.dev in the language on screen: sections of the docs and recipes that match the words, each with its path (to read with site_read_page or open with site_open_page) and the passage that matched. Setting names (bodyText.avoidOrphans), Markdown directives (::resource) and plain questions all work as queries.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for." },
        language: LANGUAGE_PARAM,
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Most results of each kind (default 8)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args) => {
      const locale = localeOf(args.language);
      const query = String(args.query).trim();
      if (!query) throw new ToolError("Give some words to search for.");
      let index = indexes.get(locale);
      if (!index) {
        const { sections, catalog } = await load(locale);
        if (sections.length === 0 && !catalog) throw new ToolError("The search index could not be loaded; try again.");
        const recipes = catalog ? cookbookPaletteEntries(catalog, { cookbook: "Cookbook" }) : [];
        index = {
          docs: sections.length ? docsIndex(sections, locale) : null,
          cookbook: recipes.length ? cookbookIndex(recipes, locale) : null,
          byId: new Map([...sections, ...recipes].map((s) => [s.id, s])),
        };
        indexes.set(locale, index);
      }
      const { byId } = index;
      const phrase = foldQuery(query);
      const limit = (args.limit as number | undefined) ?? 8;
      const run = (ms: MiniSearch<SearchSection> | null) => {
        if (!ms) return [];
        const hits = [];
        for (const r of ms.search(query)) {
          const section = byId.get(String(r.id));
          if (section) hits.push({ section, score: r.score, tier: phraseTier(section, phrase) });
        }
        return rankByPhrase(hits).slice(0, limit).map(({ section }) => ({
          title: section.sectionTitle || section.docTitle,
          in: section.breadcrumb || section.docTitle,
          path: section.href,
          excerpt: excerpt(section.body, query),
        }));
      };
      const docs = run(index.docs);
      const recipes = run(index.cookbook);
      return { language: locale, docs, recipes, ...(docs.length + recipes.length === 0 ? { note: "Nothing matched. Try fewer or other words." } : {}) };
    },
  };

  const readPage: WebMcpTool = {
    name: "site_read_page",
    title: "Postext site: read a page",
    description: "The text of a page of postext.dev as Markdown — a documentation page (/docs/configuration-text, /docs/document-format), a recipe (/cookbook/<slug>), the glossary, the home page (/) — without leaving the page on screen. Long pages come in parts: pass the offset the answer gives to read on.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's path, e.g. /docs/sandbox." },
        language: LANGUAGE_PARAM,
        offset: { type: "integer", minimum: 0, description: "Character to start from, to read a long page on." },
        length: { type: "integer", minimum: 500, maximum: 200000, description: "Most characters to give (default 40000)." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args) => {
      const locale = localeOf(args.language);
      const path = pathOf(args.path).split(/[?#]/)[0]!.replace(/\/$/, "");
      const res = await deps.fetch(`/${locale}${path}.md`);
      if (!res.ok) throw new ToolError(`No page at ${path || "/"} (${res.status}). site_get_context lists the documentation's pages; site_search finds one from a few words.`);
      const text = await res.text();
      const offset = Math.min((args.offset as number | undefined) ?? 0, text.length);
      const length = (args.length as number | undefined) ?? 40000;
      const end = Math.min(text.length, offset + length);
      return {
        path: path || "/",
        language: locale,
        characters: text.length,
        markdown: text.slice(offset, end),
        ...(end < text.length ? { nextOffset: end } : {}),
      };
    },
  };

  const openPage: WebMcpTool = {
    name: "site_open_page",
    title: "Postext site: go to a page",
    description: "Show a page of postext.dev to the reader: the home page (/), a documentation page (/docs/<page>, with #heading to land on a section), the Cookbook (/cookbook, or /cookbook?q=words to show it filtered), a recipe (/cookbook/<slug>), the glossary (/glossary#<term>), the Sandbox (/sandbox). The tools on offer follow the page: the Sandbox's appear once it is on screen.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's path." },
        language: LANGUAGE_PARAM,
      },
      required: ["path"],
      additionalProperties: false,
    },
    execute: (args) => {
      const locale = localeOf(args.language);
      const path = pathOf(args.path);
      deps.navigate(path, locale);
      return { opened: path, language: locale };
    },
  };

  const listRecipes: WebMcpTool = {
    name: "site_list_recipes",
    title: "Postext site: the Cookbook's recipes",
    description: "The recipes of the Postext Cookbook: each solves one layout problem (a drop cap, a table that breaks across pages, a bilingual page, a comic strip) and comes with its Markdown, its settings and the pages they produce. Lists them by chapter, or only those of one chapter or matching some words, with the question each one answers and its path.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words the recipe's title, question or summary must contain." },
        chapter: { type: "string", description: "Only the recipes of this chapter (its id or number, as the answer's chapters give them)." },
        language: LANGUAGE_PARAM,
        limit: { type: "integer", minimum: 1, maximum: 300, description: "Most recipes to list (default 60)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args) => {
      const locale = localeOf(args.language);
      const catalog = await catalogOf(locale);
      const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const chapter = args.chapter === undefined ? null : catalog.facets.chapters.find((c) => c.id === args.chapter || String(c.number) === String(args.chapter));
      if (args.chapter !== undefined && !chapter) {
        throw new ToolError(`No chapter ${JSON.stringify(args.chapter)}. The chapters: ${catalog.facets.chapters.map((c) => `${c.number} ${c.id}`).join(", ")}.`);
      }
      const found = catalog.recipes.filter((r) => {
        if (chapter && r.chapter !== chapter.id) return false;
        const text = `${r.title} ${r.question} ${r.summary} ${r.slug}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      const limit = (args.limit as number | undefined) ?? 60;
      return {
        language: locale,
        chapters: catalog.facets.chapters.map((c) => ({ id: c.id, number: c.number, title: c.title, recipes: c.count })),
        total: found.length,
        recipes: found.slice(0, limit).map((r) => ({
          slug: r.slug,
          title: r.title,
          ...(r.question ? { answers: r.question } : {}),
          summary: clip(r.summary, 200),
          chapter: r.chapter,
          level: r.level,
          path: r.href,
        })),
        ...(found.length > limit ? { more: found.length - limit } : {}),
      };
    },
  };

  const openRecipe: WebMcpTool = {
    name: "site_open_recipe_in_sandbox",
    title: "Postext site: open a recipe in the Sandbox",
    description: "Open a Cookbook recipe in the Sandbox as a book the reader can edit — its Markdown, settings, resources and fonts — so its technique can be tried and changed. The recipe is imported as a project the first time; later the reader's copy opens, edits included.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The recipe's slug, as site_list_recipes gives it." },
        language: LANGUAGE_PARAM,
      },
      required: ["slug"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const locale = localeOf(args.language);
      const slug = String(args.slug).trim();
      if (!/^[a-z0-9-]+$/.test(slug)) throw new ToolError("A recipe's slug is lowercase letters, digits and hyphens.");
      // The recipe's book in this language, or in the ones every recipe has.
      const candidates = [...new Set([locale, ...(locale === "ca" ? ["es"] : []), "en", "es"])];
      let variant: string | null = null;
      for (const lang of candidates) {
        const res = await deps.fetch(`/cookbook/${slug}/${lang}/${slug}.postext`, { method: "HEAD" }).catch(() => null);
        if (res?.ok) {
          variant = lang;
          break;
        }
      }
      if (!variant) throw new ToolError(`The recipe "${slug}" has no book to open in the Sandbox (or there is no such recipe). site_list_recipes lists the recipes; its page (/cookbook/${slug}) can still be read.`);
      deps.navigate(`/sandbox#recipe=${slug}&lang=${variant}`, locale);
      return { opened: `/sandbox#recipe=${slug}&lang=${variant}`, recipe: slug, bookLanguage: variant, note: "The Sandbox's tools (sandbox_*) are on offer once it is on screen." };
    },
  };

  const lookupTerm: WebMcpTool = {
    name: "site_lookup_term",
    title: "Postext site: look a term up",
    description: "What a typographic or typesetting term means, from the site's glossary: widow, orphan, runt, leading, kerning, baseline grid, kinsoku, tate-chu-yoko, kashida, and the abbreviations the documentation uses. Matches the term, part of it, or its form in another of the site's languages.",
    inputSchema: {
      type: "object",
      properties: { term: { type: "string", description: "The term, or part of it." }, language: LANGUAGE_PARAM },
      required: ["term"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args) => {
      const locale = localeOf(args.language);
      const wanted = String(args.term).trim().toLowerCase();
      if (!wanted) throw new ToolError("Give the term to look up.");
      // The glossary in every language is a large module: loaded on first use.
      const [{ GLOSSARY_TERMS }, { ABBREVIATIONS }] = await Promise.all([import("@/lib/glossary/terms"), import("@/lib/glossary/abbreviations")]);
      const terms = GLOSSARY_TERMS.filter((t) => t.id.includes(wanted) || Object.values(t.text).some(([term]) => term.toLowerCase().includes(wanted)) || t.native?.toLowerCase().includes(wanted))
        // An exact name before the terms that merely contain the word.
        .sort((a, b) => Number(b.text[locale][0].toLowerCase() === wanted) - Number(a.text[locale][0].toLowerCase() === wanted))
        .slice(0, 8)
        .map((t) => ({ term: t.text[locale][0], definition: t.text[locale][1], ...(t.native ? { native: t.native } : {}), path: `/glossary#${t.id}` }));
      const abbreviations = ABBREVIATIONS.filter((a) => a.abbr.toLowerCase() === wanted || Object.values(a.forms ?? {}).flat().some((f) => f.toLowerCase() === wanted))
        .map((a) => ({ abbreviation: a.abbr, expansion: a.expansion[locale], path: `/glossary#abbr-${a.id}` }));
      return { language: locale, terms, abbreviations, ...(terms.length + abbreviations.length === 0 ? { note: "Not in the glossary. site_search looks through the documentation." } : {}) };
    },
  };

  const setPreferences: WebMcpTool = {
    name: "site_set_preferences",
    title: "Postext site: language and theme",
    description: "Switch the site (the Sandbox's interface included) to another of its languages, staying on the same page, or between the light and the dark theme. The choice is remembered by the reader's browser.",
    inputSchema: {
      type: "object",
      properties: {
        language: { ...LANGUAGE_PARAM, description: "The language to switch the site to." },
        theme: { type: "string", enum: ["light", "dark"] },
      },
      additionalProperties: false,
    },
    execute: (args) => {
      if (args.language === undefined && args.theme === undefined) throw new ToolError("Give a language, a theme, or both.");
      if (args.theme !== undefined) deps.theme.set(args.theme as "light" | "dark");
      const locale = localeOf(args.language);
      if (args.language !== undefined && locale !== deps.locale()) deps.navigate(deps.address(), locale);
      return { language: locale, theme: (args.theme as "light" | "dark" | undefined) ?? deps.theme.get() };
    },
  };

  return [getContext, search, readPage, openPage, listRecipes, openRecipe, lookupTerm, setPreferences];
}
