import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as engine from "postext";
import type { PostextConfig } from "postext";
import { PAGE8_CONFIG, PAGE8_RESOURCES } from "../../../../../packages/postext/src/__tests__/composed/fixtures/page8";
import { stressFactor, UsageError } from "../../../scripts/cookbook/args.ts";
import {
  changesAgainstBase, compareFindings, composedFindings, configSizeFindings, roundTripFindings, runChecks, stressFindings, usefulProposal,
} from "../../../scripts/cookbook/checks.ts";
import type { CheckInput, ComposedFacts, ProbeFacts } from "../../../scripts/cookbook/checks.ts";
import { COMPOSED_FENCE as PROBE_FENCE, composedFacts, composedRoundTrip } from "../../../scripts/cookbook/lib/probe.js";
import { COMPOSED_FENCE, declaresComposedPages, stretchedEdition, stretchMarkdown } from "./bench.ts";
import { composePen, variantFor } from "./compose.ts";
import { malformedResourceEmbeds, markdownConstructs } from "./detect.ts";
import { readKit } from "./sources.ts";
import type { RecipeMeta, RecipeSources } from "./types.ts";

// The composed-page bench (#869): its checks judged in Node, and its
// fixture recipe laid out by the workspace engine with a measurement stub
// (the capture lays it out in Chrome: `pnpm cookbook bench`).

// Glyphs half an em wide, from the size in `ctx.font`: a page close
// enough to a real one that boxes grow and overflow as text gets longer.
class StubCtx {
  font = "";
  measureText(s: string): { width: number } {
    const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 40);
    return { width: s.length * px * 0.5 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const FIXTURE = path.join(__dirname, "fixtures", "recipes", "composed-bench");
const LOCALES = ["es", "en", "ca"] as const;
const content = (lang: string) => fs.readFileSync(path.join(FIXTURE, `content.${lang}.md`), "utf-8");
const fixtureMeta = () => JSON.parse(fs.readFileSync(path.join(FIXTURE, "recipe.json"), "utf-8")) as RecipeMeta;

type Engine = typeof engine;

function layOut(markdown: string, lang: string, config: PostextConfig = PAGE8_CONFIG, eng: Engine = engine) {
  const doc = eng.buildDocument({ markdown, resources: PAGE8_RESOURCES }, { ...config, locale: lang } as PostextConfig, eng.createMeasurementCache());
  return { doc, composed: composedFacts(eng, [doc], { markdowns: [markdown] }) as ComposedFacts };
}

function facts(composed: ComposedFacts, extra: Partial<ProbeFacts> = {}): ProbeFacts {
  return {
    builds: [{ kind: "document", shim: "postext", ms: 50, at: 400, pages: 1 }], selected: 0, importedAt: 300,
    registered: [], state: "ready", status: "1 page", pdfButton: false,
    pages: [{ n: 1, book: 1, docIndex: 0, index: 0, label: "1", role: "body", w: 1358, h: 1701, trimOffset: 0, blank: false, blocks: 20, coverage: 0.9, h1: true, heading: "", captions: [] }],
    composed, userConfig: { page: {} }, ...extra,
  };
}

const none: ComposedFacts = { declared: false, pages: [], warnings: [], tocSplits: [], roundTrip: null };
const declared: ComposedFacts = { ...none, declared: true };
const meta = (expectWarnings: string[] = []) => ({ capture: { hero: 1, card: "page" as const, expect: { warnings: expectWarnings } } });

/** Every check of a capture on `f`, as an edition that ran cleanly. */
function allChecks(f: ProbeFacts) {
  const input: CheckInput = {
    meta: { ...fixtureMeta(), capture: { hero: 1, card: "page" } }, facts: f, done: "ok", err: null, loaderErrors: [], console: [],
    pageErrors: [], net: [], failedRequests: [], settleTimedOut: false, kit: { state: "ready", status: "" }, tainted: [], passive: false,
    workerEngines: [], engine: "1.35.0", timeoutMs: 60_000, totalMs: 2000, pdf: null, epubs: [], published: [1], publishError: null,
    cardErrors: [], renderError: null, magnification: null, bytes: 100_000, cardBytes: null, assets: [],
    detected: {
      apis: [], configKeys: [], configSections: [], configLeaves: 0, designElements: 0, directives: [], inline: [],
      resources: { svg: 0, bitmap: 0, table: 0 }, fonts: [], features: [], suggestedLevel: 3, paths: [],
    },
    registry: null, previous: null, chrome: "155", vdtHash: "x", sourceHash: "y",
  };
  return runChecks(input);
}

// ─── The longer text ────────────────────────────────────────────────────────

describe("stretchMarkdown: the stress test's longer text", () => {
  const sample = [
    "::::page{template=\"tema-cajas\" tema=\"Retos del planeta\"}",
    "# La hucha de la clase {style=\"tema\"}",
    "",
    "Cada familia necesita :chip[alimentos]{style=\"clave\"}, ropa y una casa en [la ciudad](https://example.org/a).",
    "Pagan con **efectivo**, con $x^2$ y con `código` [^nota] [@cita].",
    "",
    "- **Fijo:** se repite cada mes, como el alquiler.",
    "",
    ":::frame{slot=\"dinero\" label=\"Para qué sirve el dinero\"}",
    "El dinero nos deja cambiar nuestro trabajo por cosas.",
    ":::",
    "",
    "::resource{id=\"foto-dinero\" slot=\"dinero-fotos\"}",
    "| tabla | intacta |",
    "```js",
    "const keep = 'the code stays';",
    "```",
    "::::",
  ].join("\n");

  it("makes each paragraph about 30 % longer with its own words, next to themselves", () => {
    const r = stretchMarkdown(sample, 1.3);
    expect(r.after / r.before).toBeGreaterThanOrEqual(1.3);
    expect(r.after / r.before).toBeLessThan(1.45);
    const lines = r.markdown.split("\n");
    expect(lines[9]).toMatch(/^El( El)? dinero/);
    // Every word of the stretched paragraph is a word of the paragraph.
    const own = new Set(sample.split("\n")[9]!.match(/\p{L}+/gu));
    for (const word of lines[9]!.match(/\p{L}+/gu)!) expect(own.has(word)).toBe(true);
  });

  it("leaves fences, attributes, directives, links, references, code, maths and tables as written", () => {
    const out = stretchMarkdown(sample, 1.5).markdown;
    for (const kept of [
      "::::page{template=\"tema-cajas\" tema=\"Retos del planeta\"}", "{style=\"tema\"}", ":chip[alimentos]{style=\"clave\"}",
      "[la ciudad](https://example.org/a)", "$x^2$", "`código`", "[^nota]", "[@cita]",
      ":::frame{slot=\"dinero\" label=\"Para qué sirve el dinero\"}", "::resource{id=\"foto-dinero\" slot=\"dinero-fotos\"}",
      "| tabla | intacta |", "const keep = 'the code stays';",
    ]) expect(out).toContain(kept);
    // Markup lines keep their place: the stretched text has as many lines.
    expect(out.split("\n")).toHaveLength(sample.split("\n").length);
    expect(out.split("\n")[0]).toBe(sample.split("\n")[0]);
    expect(out.split("\n").slice(-6)).toEqual(sample.split("\n").slice(-6));
    // A list item keeps its marker, an emphasis its asterisks.
    expect(out.split("\n")[6]).toMatch(/^- \*\*Fijo( Fijo)*:\*\* /);
  });

  it("is deterministic, and a factor of 1 or less changes nothing", () => {
    expect(stretchMarkdown(sample, 1.3).markdown).toBe(stretchMarkdown(sample, 1.3).markdown);
    expect(stretchMarkdown(sample, 1).markdown).toBe(sample);
  });

  it("repeats Chinese and Japanese words without a space, and skips front matter and a comic's raw body", () => {
    const zh = stretchMarkdown("这是一个例子，我们用它来测试。", 1.3).markdown;
    expect(zh).toMatch(/^(这是一个例子){2,}，/);
    const comic = "---\ntitle: Front matter stays\n---\n\n:::page\n[1] Panel text stays\n:::\n\nA paragraph that grows here.";
    const out = stretchMarkdown(comic, 1.3).markdown;
    expect(out).toContain("title: Front matter stays\n");
    expect(out).toContain(":::page\n[1] Panel text stays\n:::");
    expect(out.split("\n").at(-1)!.length).toBeGreaterThan("A paragraph that grows here.".length);
  });

  it("counts an edition's own files, else the fallback edition's, and reads the factor of --stress", () => {
    const files = { es: "Una frase de prueba larga.", en: "A long test sentence here.", "box.es": "Texto de la caja." };
    const es = stretchedEdition(files, "es", "es", 1.3);
    expect(es.before).toBe(files.es.length + files["box.es"].length);
    expect(stretchedEdition(files, "en", "es", 1.3).before).toBe(files.en.length + files["box.es"].length);
    expect(stressFactor("1.3", "capture")).toBe(1.3);
    expect(stressFactor(undefined, "capture")).toBeUndefined();
    for (const bad of ["1", "0.9", "4", "x", "1.3x"]) expect(() => stressFactor(bad, "capture")).toThrow(UsageError);
  });
});

// ─── What declares composed pages ───────────────────────────────────────────

describe("composed pages in the source", () => {
  it("knows a four-colon page fence with a template, as lib/probe.js does", () => {
    expect(COMPOSED_FENCE.source).toBe(PROBE_FENCE.source);
    expect(declaresComposedPages({ es: content("es") })).toBe(true);
    expect(declaresComposedPages({ en: ":::page\n[1] A comic page\n:::" })).toBe(false);
  });

  it("lints a slot embed and the page fences as Postext (detect.ts)", () => {
    expect(malformedResourceEmbeds(content("en"))).toEqual([]);
    expect(malformedResourceEmbeds("::resource{id=\"a\" slot=\"b\" extra=\"c\"}")).toHaveLength(1);
    const found = markdownConstructs(content("ca"));
    expect(found.unknown).toEqual([]);
    expect(found.directives).toEqual(expect.arrayContaining(["::::page", ":::frame", "::resource"]));
  });
});

// ─── The fixture recipe, in every sample language ───────────────────────────

describe("the bench's fixture recipe (es, en, ca)", () => {
  it("has three sample editions, each composed from its own content file", () => {
    const meta = fixtureMeta();
    expect(meta.sample.locales).toEqual([...LOCALES]);
    const sources: RecipeSources = {
      slug: "composed-bench", script: fs.readFileSync(path.join(FIXTURE, "script.js"), "utf-8"), html: "", css: "",
      pen: { css_external: [], js_external: [] } as unknown as RecipeSources["pen"],
      content: Object.fromEntries(LOCALES.map((l) => [l, content(l)])), assets: [],
    };
    for (const lang of LOCALES) {
      const pen = composePen(sources, meta, lang, { kit: readKit() });
      expect(pen.js).toContain(`const LANG = '${lang}';`);
      expect(pen.js).toContain(content(lang).split("\n")[1]);
    }
    // The site shows each language its own edition, Spanish for Catalan only when there is none.
    expect(variantFor(meta, "ca")).toBe("ca");
    expect(variantFor(meta, "fr")).toBe("en");
    expect(variantFor(meta, "zh")).toBe("es");
  });

  it("sets the page-8 stand-in template of the engine's tests, frame for frame", () => {
    const script = fs.readFileSync(path.join(FIXTURE, "script.js"), "utf-8");
    const names = [...script.matchAll(/\{ name: '([a-z-]+)', (?!kind)/g)].map((m) => m[1]);
    const template = PAGE8_CONFIG.pageTemplates![0]!;
    expect(names).toEqual(template.frames!.map((f) => f.name));
  });

  for (const lang of LOCALES) {
    it(`${lang}: passes C37 and C40 as written (no frameOverflow, no composed-page warning)`, () => {
      const { composed } = layOut(content(lang), lang);
      expect(composed.declared).toBe(true);
      expect(composed.pages.map((p) => p.template)).toEqual(["tema-cajas"]);
      expect(composed.warnings).toEqual([]);
      const f = facts(composed);
      expect(composedFindings(meta(), f)).toEqual([]);
      const trip = roundTripFindings(f);
      if (typeof (engine as Record<string, unknown>).sourceAt === "function") expect(trip.filter((x) => x.severity === "fail")).toEqual([]);
      else expect(trip).toEqual([{ check: "C40", severity: "info", detail: expect.stringContaining("no source map") }]);
    });

    it(`${lang}: the stress test reports each page, and warns of an overflow only with its proposals`, () => {
      const stretched = stretchMarkdown(content(lang), 1.3);
      const base = layOut(content(lang), lang);
      const run = layOut(stretched.markdown, lang);
      const findings = stressFindings({
        meta: meta(), factor: 1.3, stretch: stretched, done: "ok", facts: facts(run.composed), base: facts(base.composed),
      });
      expect(findings.filter((f) => f.severity === "fail")).toEqual([]);
      expect(findings.find((f) => f.detail.startsWith("p. 1 (tema-cajas)"))?.detail).toMatch(/rearranged|goes on|does not fit/);
      for (const w of findings.filter((f) => f.severity === "warn")) expect(w.detail).toMatch(/frameOverflow: .*; to fit: /);
      expect(findings[0]!.detail).toMatch(/^the text made 3\d\.\d % longer/);
    });
  }

  it("fails C37 when the copy does not fit as written, and names what would fit it", () => {
    const longer = stretchMarkdown(content("es"), 1.6).markdown;
    const { composed } = layOut(longer, "es");
    const c37 = composedFindings(meta(), facts(composed));
    expect(c37.length).toBeGreaterThan(0);
    expect(c37.every((f) => f.check === "C37" && f.severity === "fail")).toBe(true);
    expect(c37[0]!.detail).toMatch(/^frameOverflow: frame "ahorro" of template "tema-cajas" on page 1 is [\d.]+ mm short of its content after .*; to fit: /);
  });
});

// ─── The checks on their own ────────────────────────────────────────────────

describe("C37: warnings no recipe with composed pages may raise", () => {
  const overflow = { kind: "frameOverflow", page: 1, template: "t", frame: "box", overflowMm: 4.2, steps: ["free"], proposals: [{ kind: "raiseMax", path: "/pageTemplates/0/frames/2/maxHeight", value: { value: 60, unit: "mm" }, text: "raise maxHeight to 60 mm" }] };

  it("fails tocGroupSplit, contentInConfig and template warnings on a composed recipe, and keeps them off C31", () => {
    const f = facts({ ...declared, tocSplits: [{ page: 2, title: "Part one", columns: 2 }] }, {
      configWarnings: [
        { kind: "contentInConfig", path: "headingStyles[0].elements[1].content", value: "The whole first paragraph", used: "", count: 1, chars: 120 },
        { kind: "frameStyleUnknown", path: "/pageTemplates/0/frames/1/style", value: "nope", used: "" },
      ],
    });
    const out = composedFindings(meta(), f);
    expect(out.map((x) => [x.severity, x.detail.split(":")[0]])).toEqual([
      ["fail", "tocGroupSplit"], ["fail", "contentInConfig"], ["fail", "frameStyleUnknown"],
    ]);
    const all = allChecks(f);
    expect(all.filter((x) => x.check === "C31")).toEqual([]);
    expect(all.filter((x) => x.check === "C37")).toHaveLength(3);
  });

  it("cannot be excused by expect.warnings on a composed recipe; elsewhere a tocGroupSplit warns", () => {
    const out = composedFindings(meta(["frameOverflow"]), facts({ ...declared, warnings: [overflow] }));
    expect(out.map((x) => x.severity)).toEqual(["fail", "fail"]);
    expect(out[0]!.detail).toBe("frameOverflow: frame \"box\" of template \"t\" on page 1 is 4.2 mm short of its content after free; to fit: raise maxHeight to 60 mm");
    expect(out[1]!.detail).toMatch(/expect.warnings lists frameOverflow: a recipe with composed pages cannot accept it/);
    const plain = composedFindings(meta(), facts({ ...none, tocSplits: [{ page: 3, title: "Index", columns: 2 }] }));
    expect(plain).toEqual([{ check: "C37", severity: "warn", detail: "tocGroupSplit: the contents block \"Index\" is cut into 2 columns on page 3" }]);
    expect(composedFindings(meta(["tocGroupSplit"]), facts({ ...none, tocSplits: [{ page: 3, title: "Index", columns: 2 }] }))).toEqual([]);
  });

  it("leaves a recipe without composed pages as C31 judged it", () => {
    const f = facts(none, { configWarnings: [{ kind: "contentInConfig", path: "header.elements[0].content", value: "x", used: "" }] });
    expect(composedFindings(meta(), f)).toEqual([]);
    const all = allChecks(f);
    expect(all.filter((x) => x.check === "C31").map((x) => x.severity)).toEqual(["warn"]);
  });
});

describe("C38: the stress test", () => {
  const base = { meta: meta(), factor: 1.3, stretch: { before: 100, after: 131, unchanged: 0 }, done: "ok" as const, base: null };
  const page = { n: 1, template: "t", fenceIndex: 0, frames: [{ name: "box", heightMm: 40 }], events: [{ frame: "box", kind: "grew", fromMm: 30, toMm: 40, text: "box grew 10 mm" }] };

  it("fails a frameOverflow under stress that carries no proposal with a value", () => {
    const bare = { kind: "frameOverflow", page: 1, template: "t", frame: "box", overflowMm: 3, steps: [], proposals: [{ kind: "shortenText", value: 0 }] };
    const out = stressFindings({ ...base, facts: facts({ ...declared, pages: [page], warnings: [bare] }) });
    expect(out.map((f) => f.severity)).toEqual(["info", "info", "fail"]);
    expect(out[1]!.detail).toBe("p. 1 (t) rearranged: box grew 10 mm");
    expect(out[2]!.detail).toMatch(/a warning under stress must carry a proposal with a value$/);
    expect(usefulProposal({ kind: "continueNextPage", path: "/pageTemplates/0/frames/0/overflow/continueIn", value: "next-page" })).toBe(true);
    expect(usefulProposal({ kind: "allowShrink", value: 0.8 })).toBe(true);
    expect(usefulProposal({ kind: "shortenText", value: 0 })).toBe(false);
  });

  it("fails any other warning the longer text raises, a stretched run that throws, and one that builds nothing", () => {
    const out = stressFindings({ ...base, facts: facts(declared, { textWarnings: [{ kind: "unbreakableWordOverflow", page: 1, detail: "word" }], warnings: [{ kind: "overflow", page: 1, overflowPx: 12 }] }) });
    expect(out.filter((f) => f.severity === "fail").map((f) => f.detail)).toEqual(["overflow on page 1 (12 px over)", "unbreakableWordOverflow \"word\" on page 1"]);
    expect(stressFindings({ ...base, done: "error", err: "boom", facts: null }).at(-1)).toEqual({ check: "C38", severity: "fail", detail: "the stretched edition threw: boom" });
    expect(stressFindings({ ...base, facts: { ...facts(declared), selected: -1 } }).at(-1)!.detail).toBe("the stretched edition built nothing");
  });

  it("says when the page goes on, and when the page count changed", () => {
    const going = { ...page, events: [], frames: [{ name: "a", heightMm: 30, continuesTo: "cp0:b" }] };
    const out = stressFindings({ ...base, base: facts(declared), facts: facts({ ...declared, pages: [going] }, { pages: [...facts(declared).pages!, { ...facts(declared).pages![0]!, n: 2 }] }) });
    expect(out.map((f) => f.detail)).toContain("p. 1 (t) goes on: continues a → cp0:b");
    expect(out.at(-1)!.detail).toBe("2 pages, 1 as written");
  });

  it("says what moved against the text as written when the log is silent (#925)", () => {
    // A standfirst whose height follows its text (no minHeight) declares no
    // height: it grows and the columns anchored below it move, and the
    // reflow log says nothing.
    const frames = (standfirst: number) => [
      { name: "entradilla", heightMm: standfirst, box: [10, 10, 190, standfirst] as [number, number, number, number] },
      { name: "col-1", heightMm: 200 - standfirst, box: [10, 17 + standfirst, 92, 200 - standfirst] as [number, number, number, number] },
      { name: "titulo", heightMm: 20, box: [10, 250, 150, 20] as [number, number, number, number] },
    ];
    const asWritten = { n: 1, template: "apertura", fenceIndex: 0, frames: frames(24), events: [] };
    const stretched = { ...asWritten, frames: frames(30.2) };
    const out = stressFindings({ ...base, base: facts({ ...declared, pages: [asWritten] }), facts: facts({ ...declared, pages: [stretched] }) });
    expect(out[1]!.detail).toBe("p. 1 (apertura) rearranged: entradilla 6.2 mm taller than as written; col-1 6.2 mm shorter than as written; col-1 moved down 6.2 mm from where it was as written");
    // Without the run as written, as before.
    expect(stressFindings({ ...base, facts: facts({ ...declared, pages: [stretched] }) })[1]!.detail).toBe("p. 1 (apertura) fits as it was");
    // What the log says already is not said twice.
    const logged = { ...stretched, events: [{ frame: "entradilla", kind: "grew", fromMm: 24, toMm: 30.2, text: "entradilla grew 6.2 mm" }] };
    expect(changesAgainstBase(logged, asWritten)).toEqual(["col-1 6.2 mm shorter than as written", "col-1 moved down 6.2 mm from where it was as written"]);
  });

  it("names the frame a story goes on in by its name, template and page (#925)", () => {
    const going = { ...page, events: [], frames: [{ name: "col-2", id: "cp0:col-2", heightMm: 30, continuesTo: "cp0:col-1~2" }] };
    const after = { n: 2, template: "seguido-par", fenceIndex: 0, frames: [{ name: "col-1", id: "cp0:col-1~2", heightMm: 200, continuedFrom: "cp0:col-2" }], events: [] };
    const out = stressFindings({ ...base, facts: facts({ ...declared, pages: [going, after] }) });
    expect(out.map((f) => f.detail)).toContain("p. 1 (t) goes on: continues col-2 → col-1 of seguido-par on p. 2 (cp0:col-1~2)");
  });
});

describe("C39: the pages against the approved capture", () => {
  const run = { vdtHash: "aaaaaaaa11", engine: "1.35.0" };
  it("notes a recipe with no approved capture of these sources", () => {
    expect(compareFindings({ approved: null, run, changes: null, pages: 1, maxDiff: 12, pixels: true })[0]!.severity).toBe("info");
  });

  it("fails a moved layout or a changed page on the approved engine, and warns on another", () => {
    const changes = [{ n: 2, detail: "worst cell 36.2 of 255, 14 cells over the threshold" }];
    const same = compareFindings({ approved: { vdtHash: "bbbbbbbb22", engine: "1.35.0" }, run, changes, pages: 3, maxDiff: 12, pixels: true });
    expect(same.map((f) => [f.severity, f.detail])).toEqual([
      ["fail", "the layout is not the approved one (layout hash aaaaaaaa, approved bbbbbbbb) on postext 1.35.0, the engine it was approved on"],
      ["fail", "p. 2 is not the approved page: worst cell 36.2 of 255, 14 cells over the threshold (threshold 12) on postext 1.35.0, the engine it was approved on"],
    ]);
    const other = compareFindings({ approved: { vdtHash: "bbbbbbbb22", engine: "1.34.1" }, run, changes, pages: 3, maxDiff: 12, pixels: false });
    expect(other.map((f) => f.severity)).toEqual(["warn"]);
    expect(compareFindings({ approved: { vdtHash: "bbbbbbbb22", engine: "1.34.1" }, run, changes, pages: 3, maxDiff: 12, pixels: false, strict: true })[0]!.severity).toBe("fail");
    expect(compareFindings({ approved: { vdtHash: run.vdtHash, engine: "1.34.1" }, run, changes: [], pages: 3, maxDiff: 12, pixels: true })[0]!.detail)
      .toBe("the layout and 3 pages within 12 of 255 of the approved capture");
  });
});

describe("C40: the source map round trip (#857)", () => {
  it("is a note on an engine without sourceAt, and only on a recipe with composed pages", () => {
    expect(roundTripFindings(facts(declared))).toEqual([{ check: "C40", severity: "info", detail: expect.stringContaining("skipped until the pinned engine has it") }]);
    expect(roundTripFindings(facts(none))).toEqual([]);
  });

  it("fails an element a click inside does not bring back, and names it", () => {
    const { doc } = layOut(content("en"), "en");
    const page = doc.pages.find((p) => p.composed)!;
    const frame = page.composed!.frames.find((f) => f.name === "dinero")!;
    const element = { level: "frame", id: frame.id, source: { kind: "config", path: frame.configPath }, content: { start: frame.sourceStart!, end: frame.sourceEnd! }, rect: frame.rect };
    // A source map that finds the frame and answers every click with nothing.
    const lost = { ...engine, elementsForSource: () => [{ pageIndex: page.index, element }], sourceAt: () => [] };
    const trip = composedRoundTrip(lost, doc, { markdown: content("en") }) as NonNullable<ComposedFacts["roundTrip"]>;
    expect(trip.levels).toEqual({ frame: { checked: 1, missed: 1 } });
    expect(trip.misses[0]).toMatchObject({ page: 1, level: "frame", id: frame.id, text: expect.stringMatching(/^The money in the box/) });
    const found = { ...engine, elementsForSource: () => [{ pageIndex: page.index, element }], sourceAt: () => [{ ...element, level: "frame" }] };
    expect(composedRoundTrip(found, doc)!.misses).toEqual([]);
    const out = roundTripFindings(facts({ ...declared, roundTrip: trip }));
    expect(out).toEqual([{ check: "C40", severity: "fail", detail: expect.stringMatching(/^p\. 1: a click inside frame cp0:dinero “The money in the box/) }]);
  });

  it.runIf(typeof (engine as Record<string, unknown>).sourceAt === "function")("probes a frame whose text was scaled at the rect the source map gives (#921)", () => {
    // `dinero` at a fixed 56 mm with no maximum: one more paragraph makes
    // the ladder scale its text (to 0.9). elementsForSource gives the lines
    // upright on the sheet already; mapping them through frameMatrix again
    // looked a line off at the frame's foot (4 misses here, 139 on Nº 160).
    const tpl = PAGE8_CONFIG.pageTemplates![0]!;
    const frames = tpl.frames!.map((f) => (f.name === "dinero" ? { ...f, height: { value: 56, unit: "mm" as const }, minHeight: undefined, maxHeight: undefined } : f));
    const config = { ...PAGE8_CONFIG, pageTemplates: [{ ...tpl, frames }, ...PAGE8_CONFIG.pageTemplates!.slice(1)] } as PostextConfig;
    const more = "More money 0 ".repeat(24).trim();
    const markdown = content("en").replace(/(:::frame\{slot="dinero"[^\n]*\n)/, `$1${more}\n\n`);
    const { doc, composed } = layOut(markdown, "en", config);
    const dinero = doc.pages.find((p) => p.composed)!.composed!.frames.find((f) => f.name === "dinero")!;
    expect(dinero.scale).toBeLessThan(0.95);
    expect(dinero.overflowPx ?? 0).toBe(0);
    expect(composed.roundTrip?.misses).toEqual([]);
    expect(composed.roundTrip?.levels.line?.checked).toBeGreaterThan(0);
  });

  it.runIf(typeof (engine as Record<string, unknown>).sourceAt === "function")("brings every element of the fixture back on an engine with the source map", () => {
    for (const lang of LOCALES) {
      const { composed } = layOut(content(lang), lang);
      expect(composed.roundTrip?.misses).toEqual([]);
      expect(Object.keys(composed.roundTrip?.levels ?? {})).toEqual(expect.arrayContaining(["frame", "block", "line"]));
      expect(roundTripFindings(facts(composed))).toEqual([
        { check: "C40", severity: "info", detail: expect.stringMatching(/^every element came back to its source: .*\d+ frame.*\d+ line/) },
      ]);
    }
  });

  it.runIf(typeof (engine as Record<string, unknown>).sourceAt === "function")("fails the fixture when the source map answers for the wrong place", () => {
    const real = engine as unknown as { sourceAt: (doc: unknown, page: number, x: number, y: number) => unknown[] };
    // Every click answered as if it had landed in the page's top-left corner.
    const shifted = { ...engine, sourceAt: (doc: unknown, page: number) => real.sourceAt(doc, page, 1, 1) };
    for (const lang of LOCALES) {
      const { doc } = layOut(content(lang), lang);
      const composed = composedFacts(shifted, [doc], { markdowns: [content(lang)] }) as ComposedFacts;
      expect(composed.roundTrip!.misses.length).toBeGreaterThan(5);
      const out = roundTripFindings(facts(composed));
      expect(out.every((f) => f.check === "C40" && f.severity === "fail")).toBe(true);
      expect(out[0]!.detail).toMatch(/^p\. 1: a click inside (frame|block|line|text) /);
      expect(out.at(-1)!.detail).toMatch(/^and \d+ more elements the source map does not find again$/);
    }
  });
});

describe("C41: the configuration under 1 MB", () => {
  it("fails a configuration of more than 1 MB of JSON", () => {
    expect(configSizeFindings(facts(none, { userConfig: { note: "x".repeat(1024) } }))).toEqual([]);
    expect(configSizeFindings(facts(none, { userConfig: { picture: "x".repeat(1024 * 1024) } }))).toEqual([
      { check: "C41", severity: "fail", detail: "the configuration weighs 1.00 MB of JSON (limit 1 MB): move pictures and text out of it" },
    ]);
  });
});
