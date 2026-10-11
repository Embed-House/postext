import { describe, expect, it } from "vitest";
import { defaultResourceTypes, effectiveResourceTypes } from "postext";
import { bundleGroup, bundleLocale, configKeyOf, extraWarnings, readBundleBack, startLossNotes, startOf } from "../../../scripts/cookbook/lib/probe.js";

// The Sandbox bundle of a capture whose `capture.doc` lists several builds:
// chained with `continuation` they make a book, one chapter per build
// (#540), of the builds that share one configuration (#690).

const config = { page: { dpi: 150 } };
const build = (markdown: string, resources: { id: string }[], continuation?: object, own: object = config) => ({
  kind: "document", config: own, content: { markdown, resources, ...(continuation ? { continuation } : {}) },
});

describe("bundleGroup: builds chained into a book (#540)", () => {
  it("makes a chapter of each chained build, with every build's resources", () => {
    const group = bundleGroup([
      build("# First article\n\nText.", [{ id: "a" }, { id: "shared" }]),
      build("# Second *article*\n\nText.", [{ id: "shared" }, { id: "b" }], { pageIndexOffset: 3, headings: { h1: 0 } }),
    ], "Bulletin");
    expect(group!.builds).toEqual([0, 1]);
    expect(group!.left).toEqual([]);
    expect(group!.chain!.chapters.map((c) => c.title)).toEqual(["First article", "Second article"]);
    expect(group!.chain!.chapters[1].markdown).toBe("# Second *article*\n\nText.");
    expect(group!.chain!.resources.map((r) => r.id)).toEqual(["a", "shared", "b"]);
    expect(group!.notes).toEqual(["build 2: continuation.headings not carried (the Sandbox chains the chapters itself)"]);
    expect(group!.warns).toEqual([]);
  });

  it("leaves builds that do not chain (two editions) to the first build", () => {
    const group = bundleGroup([build("# En", []), build("# Es", [])]);
    expect(group).toMatchObject({ builds: [0], left: [1], chain: null, notes: [], warns: [] });
    expect(bundleGroup([build("# One", [])])).toBeNull();
    expect(bundleGroup(undefined)).toBeNull();
  });
});

describe("bundleGroup: one configuration per bundle (#690)", () => {
  const original = build("# 原作", [{ id: "art" }, { id: "ja" }], { pageIndexOffset: 1 }, { locale: "ja" });
  const lettered = build("# Lettering", [{ id: "art" }, { id: "en" }], { pageIndexOffset: 2 }, { locale: "en-us" });

  it("keeps the first build's group and warns of the builds left out when the recipe did not choose", () => {
    const group = bundleGroup([original, lettered]);
    expect(group).toMatchObject({ builds: [0], left: [1], chain: null, notes: [] });
    expect(group!.warns).toEqual([
      "build 2 (Lettering) left out of the bundle: its configuration differs from the first build's, and a bundle carries one. "
        + "It holds build 1; name the build to keep in capture.sandbox",
    ]);
  });

  it("keeps the group of the build capture.sandbox names, and only notes the others", () => {
    const group = bundleGroup([original, lettered], "", { keep: 1, explicit: true });
    expect(group).toMatchObject({ builds: [1], left: [0], chain: null, warns: [] });
    expect(group!.notes).toEqual(["capture.sandbox keeps build 2 of 2; build 1 (原作) left out (another configuration)"]);
  });

  it("makes a book of the builds that share the kept configuration", () => {
    const apa = { citations: { style: "apa" } };
    const ieee = { citations: { style: "ieee" } };
    const group = bundleGroup([
      build("# One", [{ id: "a" }], undefined, apa),
      build("# Two", [{ id: "b" }], { pageIndexOffset: 1 }, ieee),
      build("# Three", [{ id: "c" }], { pageIndexOffset: 2, pageNumbering: { startAt: 9 } }, apa),
      build("# Four", [{ id: "d" }], { pageIndexOffset: 3 }, ieee),
    ], "", { keep: 3, explicit: true });
    expect(group!.builds).toEqual([1, 3]);
    expect(group!.left).toEqual([0, 2]);
    expect(group!.chain!.chapters.map((c) => c.title)).toEqual(["Two", "Four"]);
    expect(group!.chain!.resources.map((r) => r.id)).toEqual(["b", "d"]);
    expect(group!.notes).toEqual(["capture.sandbox keeps builds 2 and 4 of 4; build 1 (One) and build 3 (Three) left out (another configuration)"]);
    const first = bundleGroup([
      build("# One", [], undefined, apa), build("# Two", [], { pageIndexOffset: 1 }, ieee), build("# Three", [], { pageIndexOffset: 2 }, apa),
    ]);
    expect(first!.builds).toEqual([0, 2]);
    expect(first!.warns[0]).toMatch(/^build 2 \(Two\) left out of the bundle: its configuration differs .* It holds builds 1 and 3; name/);
  });

  it("keeps the named build alone when the builds do not chain", () => {
    const group = bundleGroup([build("# En", []), build("# Es", [], undefined, { locale: "es" })], "", { keep: 1, explicit: true });
    expect(group).toMatchObject({ builds: [1], left: [0], chain: null, warns: [] });
    expect(group!.notes).toEqual(["capture.sandbox keeps build 2 of 2: the bundle is that document alone"]);
    expect(bundleGroup([build("# En", []), build("# Es", [])], "", { keep: 2, explicit: true })).toBeNull();
  });
});

describe("configKeyOf (#690)", () => {
  it("reads two configurations alike whatever the order of their keys, and drops functions", () => {
    const a = { locale: "en", page: { dpi: 150, mirror: true }, onPass: () => {} };
    const b = { page: { mirror: true, dpi: 150 }, locale: "en" };
    expect(configKeyOf(a)).toBe(configKeyOf(b));
    expect(configKeyOf({ ...b, locale: "ja" })).not.toBe(configKeyOf(b));
  });

  it("compares them as the bundle stores them: without the values that restate a default", () => {
    const engine = {
      stripConfigDefaults: (c: { page?: { dpi?: number } }) => {
        const out = { ...c, page: { ...c.page } };
        if (out.page.dpi === 300) delete out.page.dpi;
        return out;
      },
    };
    expect(configKeyOf({ locale: "en", page: { dpi: 300 } }, engine)).toBe(configKeyOf({ locale: "en", page: {} }, engine));
    expect(configKeyOf({ locale: "en", page: { dpi: 300 } })).not.toBe(configKeyOf({ locale: "en", page: {} }));
    const broken = { stripConfigDefaults: () => { throw new Error("no"); } };
    expect(configKeyOf({ locale: "en" }, broken)).toBe(configKeyOf({ locale: "en" }));
  });
});

// ─── What the bundle takes from the pen's build ──────────────────────────────

describe("startOf: the build's continuation as the bundle's start (#695)", () => {
  it("carries the continuation as plain data, without the book's page count", () => {
    const continuation = { pageIndexOffset: 57, pageNumbering: { startAt: 58 }, headings: { h1: 3 }, bookPageCount: 320 };
    expect(startOf(continuation)).toEqual({ pageIndexOffset: 57, pageNumbering: { startAt: 58 }, headings: { h1: 3 } });
    expect(startOf(continuation)).not.toBe(continuation);
  });

  it("is nothing for a build with no continuation, or with one that says nothing", () => {
    for (const none of [undefined, null, "x", {}, { bookPageCount: 9 }]) expect(startOf(none)).toBeNull();
  });

  it("says what a bundle written by an engine without `start` loses", () => {
    expect(startLossNotes({ pageIndexOffset: 57, pageNumbering: { startAt: 58 }, headings: { h1: 3 }, part: { number: "II", title: "T" } })).toEqual([
      "continuation.pageIndexOffset 57: page 1 is a verso in the recipe, a recto in the Sandbox",
      'continuation.headings {"h1":3} dropped (chapter numbers restart)',
      "continuation.part dropped",
    ]);
    expect(startLossNotes({ pageIndexOffset: 8, pageNumbering: { startAt: 9 } })).toEqual(["continuation.pageIndexOffset 8 dropped (even: same page sides)"]);
    expect(startLossNotes({ pageNumbering: { startAt: 41 } })).toEqual([]);
  });
});

describe("bundleLocale: the locale that gives the pen's resource types", () => {
  const engine = { defaultResourceTypes, effectiveResourceTypes };
  const figure = [{ id: "plan", typeId: "figure", kind: "svg" }];

  it("keeps the edition's language when it names the types as the document does", () => {
    expect(bundleLocale(engine, { locale: "es" }, figure, "es")).toEqual({ locale: "es" });
    expect(bundleLocale(engine, { locale: "en" }, figure, "en")).toEqual({ locale: "en" });
    // A document that names no language reads in English, as its edition.
    expect(bundleLocale(engine, {}, figure, "en")).toEqual({ locale: "en" });
  });

  it("takes the document's language when the edition would rename them", () => {
    // maghreb-edition-european-digits: an Arabic document on the English and Spanish pages.
    const arabic = { locale: "ar-MA" };
    for (const edition of ["en", "es"]) {
      const named = bundleLocale(engine, arabic, figure, edition);
      expect(named.locale).toBe("ar-MA");
      expect(named.resourceTypes).toBeUndefined();
      expect(named.note).toContain("ar-MA");
    }
    expect(defaultResourceTypes("ar-MA")[0]!.captionPrefix).not.toBe(defaultResourceTypes("en")[0]!.captionPrefix);
    // The hyphenation locale names the language when `locale` does not.
    expect(bundleLocale(engine, { bodyText: { hyphenation: { locale: "es" } } }, figure, "en").locale).toBe("es");
  });

  it("keeps the edition's language for a document that names none", () => {
    // The read-back (C33) tells when a type name prints otherwise.
    expect(bundleLocale(engine, {}, figure, "es")).toEqual({ locale: "es" });
    expect(bundleLocale(engine, { bodyText: { hyphenation: { locale: " " } } }, figure, "es")).toEqual({ locale: "es" });
  });

  it("leaves the edition's language where no type name can print", () => {
    expect(bundleLocale(engine, { locale: "ar-MA" }, [], "en")).toEqual({ locale: "en" });
    const own = { locale: "ar-MA", resourceTypes: defaultResourceTypes("es") };
    expect(bundleLocale(engine, own, figure, "en")).toEqual({ locale: "en" });
    // An engine that cannot say: as before.
    expect(bundleLocale({}, { locale: "ar-MA" }, figure, "en")).toEqual({ locale: "en" });
  });

  it("writes the pen's types into the configuration when no locale gives them", () => {
    const odd = { defaultResourceTypes, effectiveResourceTypes: () => [{ ...defaultResourceTypes("en")[0]!, captionPrefix: "Plate" }] };
    const named = bundleLocale(odd, { locale: "en-GB" }, figure, "en");
    expect(named.locale).toBe("en");
    expect(named.resourceTypes).toEqual([{ ...defaultResourceTypes("en")[0]!, captionPrefix: "Plate" }]);
  });
});

// ─── C33: the bundle read back ───────────────────────────────────────────────

const line = (text: string, x = 10) => ({ text, bbox: { x, y: 20, width: 100, height: 12 } });
const doc = (pages: { label: string; lines: string[] }[], extra: object = {}) => ({
  pageIndexOffset: 0,
  pages: pages.map((p, index) => ({
    index, width: 500, height: 700, pageLabel: p.label, role: "body",
    columns: [{ blocks: [{ type: "paragraph", bbox: { x: 10, y: 20, width: 100, height: 12 * p.lines.length }, lines: p.lines.map((t) => line(t)) }] }],
  })),
  ...extra,
});
const engineFor = (docs: object[]) => ({ openBundle: async (bytes: Uint8Array) => ({ bytes }), buildBundle: () => docs });

describe("readBundleBack (#690)", () => {
  it("finds the bundle laid out as the pen's documents, wherever the book puts them", async () => {
    const pen = [{ ...doc([{ label: "1", lines: ["One", "two"] }]), pageIndexOffset: 2 }];
    const back = await readBundleBack(engineFor([doc([{ label: "1", lines: ["One", "two"] }])]), new Uint8Array(), pen);
    expect(back.chapters).toHaveLength(1);
    expect(back.chapters[0].pen).toEqual(back.chapters[0].bundle);
    expect(back.chapters[0].pen!.pages).toBe(1);
    expect(back.chapters[0].difference).toBeNull();
    expect(back.extraWarnings).toEqual([]);
  });

  it("says where a chapter's layout parts from the pen's", async () => {
    const pen = [doc([{ label: "1", lines: ["One"] }]), doc([{ label: "2", lines: ["A balloon", "in Comic Neue"] }])];
    const bundle = [doc([{ label: "1", lines: ["One"] }]), doc([{ label: "2", lines: ["A balloon in", "Zen Antique"] }, { label: "3", lines: ["over"] }])];
    const back = await readBundleBack(engineFor(bundle), new Uint8Array(), pen);
    expect(back.chapters[0].difference).toBeNull();
    expect(back.chapters[1].pen!.pages).toBe(1);
    expect(back.chapters[1].bundle!.pages).toBe(2);
    expect(back.chapters[1].pen!.hash).not.toBe(back.chapters[1].bundle!.hash);
    expect(back.chapters[1].difference).toBe("page 1: the pen sets L10,20,100,12|A balloon, the bundle L10,20,100,12|A balloon in");
  });

  it("lists the warnings the bundle raises beyond the pen's", async () => {
    const overflow = { kind: "comicBalloonOverflow", pageIndex: 0, panel: 2, speaker: "rin" };
    const pen = [doc([{ label: "1", lines: ["One"] }], { contentWarnings: [{ kind: "comicUnknownSpeaker", speaker: "voice" }] })];
    const bundle = [doc([{ label: "1", lines: ["One"] }], {
      contentWarnings: [{ kind: "comicUnknownSpeaker", speaker: "voice" }, overflow, { ...overflow, pageIndex: 1 }],
      configWarnings: [{ kind: "unknownConfigKey", path: "comics.letterin", value: "x" }],
    })];
    const back = await readBundleBack(engineFor(bundle), new Uint8Array(), pen);
    expect(back.extraWarnings).toEqual([
      "comicBalloonOverflow panel 3 rin", "comicBalloonOverflow panel 3 rin", "unknownConfigKey comics.letterin",
    ]);
    expect(extraWarnings(["a", "a", "b"], ["a", "a", "a", "c"])).toEqual(["a", "c"]);
  });

  // A toy engine: the chapter number comes from the continuation's heading
  // counter, the second line from two configuration keys.
  type Toy = { headings?: string; headingStyles?: string; resourceTypes?: string };
  type ToyContent = { markdown: string; continuation?: { headings?: { h1: number }; pageIndexOffset?: number } };
  const lay = (content: ToyContent, config: Toy) => doc([{
    label: "1",
    lines: [`${(content.continuation?.headings?.h1 ?? 0) + 1} ${content.markdown}`, `${config.headings ?? "plain"}/${config.headingStyles ?? "plain"}/${config.resourceTypes ?? "own"}`],
  }]);
  const toy = (stored: Toy) => ({
    openBundle: async () => ({ chapters: [{ markdown: "Title" }], resources: [], config: stored }),
    buildBundle: (b: { chapters: ToyContent[]; config: Toy }) => b.chapters.map((c) => lay(c, b.config)),
    buildDocument: lay,
  });
  const penBuild = (config: Toy, continuation?: ToyContent["continuation"]) => {
    const content = { markdown: "Title", ...(continuation ? { continuation } : {}) };
    return { kind: "document", config, content, docs: [lay(content, config)] };
  };
  const causeFor = async (stored: Toy, build: ReturnType<typeof penBuild>) =>
    (await readBundleBack(toy(stored), new Uint8Array(), build.docs, [build])).chapters[0].cause;

  it("names the continuation a bundle does not carry, by the keys the pages need", async () => {
    const build = penBuild({ headings: "bold" }, { headings: { h1: 3 }, pageIndexOffset: 40 });
    expect(await causeFor({ headings: "bold" }, build)).toEqual({ continuation: ["headings"] });
  });

  it("names the configuration key the bundle stores otherwise, or sets and the pen does not", async () => {
    const build = penBuild({ headings: "bold", headingStyles: "cover" });
    expect(await causeFor({ headings: "bold" }, build)).toEqual({ configuration: ["headingStyles"] });
    expect(await causeFor({ headings: "bold", headingStyles: "cover", resourceTypes: "en" }, build)).toEqual({ configuration: ["resourceTypes"] });
  });

  it("names the keys that only give the pen's pages back together, and both causes at once", async () => {
    expect(await causeFor({}, penBuild({ headings: "bold", headingStyles: "cover" })))
      .toEqual({ configuration: ["headings", "headingStyles"], together: true });
    expect(await causeFor({ headings: "bold" }, penBuild({ headings: "bold", headingStyles: "cover" }, { headings: { h1: 2 } })))
      .toEqual({ configuration: ["headingStyles"], continuation: ["headings"] });
  });

  it("leaves a difference it cannot explain without a cause, and an equal chapter without one", async () => {
    const build = penBuild({ headings: "bold" });
    const other = { ...build, docs: [doc([{ label: "1", lines: ["Another text"] }])] };
    expect(await causeFor({ headings: "bold" }, other)).toBeNull();
    expect(await causeFor({ headings: "bold" }, build)).toBeNull();
    expect((await readBundleBack(toy({ headings: "bold" }), new Uint8Array(), build.docs, [build])).chapters[0].difference).toBeNull();
  });

  it("reports a chapter with no document, a bundle that does not open, and an engine that cannot read one", async () => {
    const one = doc([{ label: "1", lines: ["One"] }]);
    const more = await readBundleBack(engineFor([one, one]), new Uint8Array(), [one]);
    expect(more.chapters[1]).toMatchObject({ chapter: 2, pen: null, bundle: { pages: 1 } });
    const broken = { openBundle: async () => { throw new Error("Invalid bundle manifest (preset.json)"); }, buildBundle: () => [] };
    expect(await readBundleBack(broken, new Uint8Array(), [one])).toMatchObject({ error: "Invalid bundle manifest (preset.json)", chapters: [] });
    expect(await readBundleBack({}, new Uint8Array(), [one])).toMatchObject({ skipped: "the engine has no openBundle / buildBundle" });
  });
});
