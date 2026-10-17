/**
 * The capture's checks (spec §8.5) and the detected facts of capture.json.
 * lib/probe.js gathers the facts in the page, with the pinned engine; this
 * module judges them. A FAIL blocks the write; WARN and INFO findings go to
 * `diagnostics.findings`.
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */
import zlib from "node:zlib";
import { markdownConstructs, usedApis } from "../../src/lib/cookbook/detect.ts";
import type { CaptureVariant, ComposedPen, Level, Registry, RecipeMeta } from "../../src/lib/cookbook/types.ts";

export type Severity = "fail" | "warn" | "info";

export interface Finding {
  check: string;
  severity: Severity;
  detail: string;
}

// ─── What lib/probe.js returns ──────────────────────────────────────────────

export interface ProbeFace {
  family: string;
  weight: number;
  style: "normal" | "italic";
  where?: string;
}

/** A `ConfigWarning` of the engine (`kind`, where it sits in the config,
 *  the value as written and the one used instead). */
export interface ProbeConfigWarning {
  kind: string;
  path: string;
  value: string;
  used: string;
  suggestion?: string;
  /** `contentInConfig` (#849): the design texts at fault and their letters. */
  count?: number;
  chars?: number;
}

export interface ProbePage {
  /** 1-based from the build's first page. */
  n: number;
  /** The physical page number in the whole book (`continuation.pageIndexOffset` + 1 on the first page). */
  book: number;
  docIndex: number;
  index: number;
  label: string;
  role: "body" | "opener" | "part" | "blank";
  w: number;
  h: number;
  trimOffset: number;
  blank: boolean;
  blocks: number;
  coverage: number;
  h1: boolean;
  heading: string;
  captions: string[];
  legibility?: number;
  /** A page added by a composed page's continuation (#915): `heading` is
   *  the continued page fence's. */
  continued?: boolean;
}

export interface ProbeFacts {
  builds: { kind: "document" | "bundle" | "worker" | "rendered"; shim: string; ms: number; at: number; pages: number }[];
  /** Index of the build that is the result, or -1 when nothing was built. */
  selected: number;
  /** Every build that is the result, when `capture.doc` names several: their
   *  pages are published one build after the other. */
  selectedBuilds?: number[];
  importedAt: number;
  registered: string[];
  state: string | null;
  status: string | null;
  pdfButton: boolean;
  sourceKnown?: boolean;
  userConfig?: Record<string, unknown> | null;
  markdowns?: string[];
  resources?: { id: string; kind: string; typeId: string; note: boolean; fileId: string | null; placement: unknown; styleId: string | null }[];
  known?: { directives: string[]; containers: string[] };
  parseIssues?: { chapter: number; kind: string; line: number; excerpt: string }[];
  badFences?: { chapter: number; line: number; text: string; name: string }[];
  unknownStyles?: { what: string; id: string; at: string }[];
  unknownRefs?: { usage: string; id: string; at: string }[];
  duplicates?: string[];
  directives?: string[];
  inline?: string[];
  unregistered?: { fileId: string; page: number }[];
  faces?: {
    used: ProbeFace[];
    loaded: { family: string; weight: string; style: string }[];
    missing: ProbeFace[];
    /** Characters a CJK or Arabic face set from files not loaded when the layout ran. */
    late?: (ProbeFace & { chars: string })[];
  };
  garbage?: { text: string; where: string }[];
  /** The characters of the pages that no loaded file of their own family
   *  holds, by face (lib/probe.js `systemFontChars`): the browser sets
   *  them in a font of the system (C36). */
  systemFont?: (ProbeFace & { chars: { ch: string; code: string; where: string }[] })[];
  /** Characters outside Fontsource's latin subset. `ownFile`: a loaded
   *  file of the face that sets it holds it (latin-ext, from loadFonts). */
  nonLatin?: { ch: string; code: string; where: string; ownFile?: boolean }[];
  defaultSkin?: {
    body: boolean;
    headingLevels: number[];
    header: boolean | null;
    footer: boolean | null;
    colors: string[];
    callouts: number;
    tables: number;
    lists: number;
    palette: boolean | null;
  };
  warnings?: { kind: string; page: number; overflowPx: number }[];
  /** Warnings `:::index` raised (#172): `doc.contentWarnings` of the index kinds. */
  indexWarnings?: { kind: string; page: number | null; detail: string }[];
  /** Content warnings on how the text is set (`arabicMarksExceedLeading`,
   *  `unbreakableWordOverflow`, `joiningScriptLetterSpacing`), with the
   *  words they name, `lineNumberOverlap` (a line number in the side
   *  column on a side box or float), with the number,
   *  `tabInVerticalText` (a `:tab` set as a word space in vertical text),
   *  `dropCap` (a paragraph whose drop cap could not be set as
   *  configured), with its reason and first line, `codeOverflow` (a
   *  code listing with lines wider than its box), with what was done, and
   *  `floatShrunk` when a picture runs past the text block even at its
   *  smallest scale, with the resource, the scale and the overrun, and
   *  `textWrap` (a picture or a box that did not wrap the text round it
   *  as asked), with the resource or box and the reason. */
  textWarnings?: { kind: string; page: number | null; detail: string }[];
  /** `doc.configWarnings` of the builds, one per value: settings the engine
   *  could not use as written and what it used instead (C31). */
  configWarnings?: ProbeConfigWarning[];
  /** Formulas the maths engine could not set, each painted as a small red
   *  box: the TeX and MathJax's message (C32). */
  mathErrors?: { page: number; tex: string; error: string }[];
  converged?: boolean;
  iterationCount?: number;
  loose?: {
    count: number;
    total: number;
    share: number;
    worst: number;
    threshold: number;
    /** The loosest lines past the threshold, loosest first (at most 5). */
    lines?: { page: number; ratio: number; text: string }[];
  };
  /** Justified lines of the CJK composer (`VDTLine.cjkComposed`), judged by
   *  the space between their characters (`VDTLineSegment.tracking`, in em)
   *  instead of their word spaces: `count` lines past the cap, set short
   *  (`cjkLoose`), `worst` the widest spacing, `threshold` the cap. */
  cjkLoose?: {
    count: number;
    total: number;
    share: number;
    worst: number;
    threshold: number;
    /** The lines set short, in page order (at most 5). */
    lines?: { page: number; tracking: number; text: string }[];
  };
  /** Justified lines set ragged because their word spaces would have
   *  stretched past 3× (the builds' `raggedLine` warnings, #732): how many,
   *  and the five that would have stretched most. Absent on an engine
   *  without the warning. */
  raggedLines?: { count: number; lines: { page: number | null; ratio: number; text: string }[] };
  /** Paragraphs set a line short to take up a runt (`VDTBlock.runtFix`,
   *  #733): `count` of them, `tracked` the ones that needed tracking,
   *  `worst` the most tracking (thousandths of an em), `atCap` when one
   *  sits at `bodyText.maxRuntTracking`, `blocks` the five most tracked
   *  with their first words. Absent when none was fixed. */
  runtFixes?: { count: number; tracked: number; worst: number; atCap?: boolean; blocks: { page: number; tracking: number; text: string }[] };
  /** `"right"` when the document is bound on its right edge (`doc.binding`). */
  binding?: "right";
  /** `"rtl"` when the document's text runs right to left (the resolved
   *  `config.direction`, also when the locale implied it). */
  direction?: "rtl";
  /** The digit system the engine writes numbers in, when the document is
   *  right to left or names one (`config.numerals`, resolved from the locale). */
  numerals?: "latn" | "arab" | "arabext";
  pages?: ProbePage[];
  specimen?: {
    trimMm: [number, number];
    dpi: number;
    layoutType: string;
    gutterMm?: number;
    mirror: boolean;
    body: { family: string; sizePt: number; leadingPt: number };
    families: string[];
    pages: number;
  };
  signals?: { splitTables: boolean; rotated: boolean; sideFloats: boolean; partPalette: boolean; placements: boolean; chapters: number };
  vdt?: string;
  /** The composed pages of the result (lib/probe.js `composedFacts`, #869):
   *  C37, C38 and C40 read them. Absent from a probe before the bench. */
  composed?: ComposedFacts;
}

/** A frame of a composed page as the bench reads it. */
export interface ComposedFrameFact {
  name: string;
  /** The frame's stable id (`cp0:dinero`, a continuation's `cp0:resto~2`). */
  id?: string;
  heightMm: number;
  /** x, y, width, height in mm on the page. */
  box?: [number, number, number, number];
  overflowMm?: number;
  scale?: number;
  imageScale?: number;
  continuesTo?: string;
  continuedFrom?: string;
  filled?: true;
}

/** An entry of a composed page's reflow log (`VDTComposedPage.log`). */
export interface ComposedEventFact {
  frame: string;
  kind: string;
  fromMm?: number;
  toMm?: number;
  axis?: "x" | "y";
  scale?: number;
  cause?: string;
  /** `describeReflowEvent`, when the engine has it. */
  text?: string;
}

/** A proposal of a `frameOverflow` warning (#858): `{ kind, path, value }`
 *  and the engine's words for it. */
export interface ComposedProposalFact {
  kind: string;
  path?: string;
  value: unknown;
  text?: string;
}

export interface ComposedFacts {
  /** A Markdown of the build has a `::::page{template=…}` fence. */
  declared: boolean;
  /** `doc`: the build's index when the capture lays out several. */
  pages: { n: number; doc?: number; template: string; fenceIndex: number; frames: ComposedFrameFact[]; events: ComposedEventFact[] }[];
  /** `frameOverflow`, `templateUnknown`, `slotUnknown`, `slotEmpty`, `pageFenceLength`. */
  warnings: {
    kind: string;
    page: number | null;
    template?: string;
    frame?: string;
    slot?: string;
    overflowMm?: number;
    locale?: string;
    steps?: string[];
    proposals?: ComposedProposalFact[];
    /** `formatWarning`, when the engine has it. */
    text?: string;
  }[];
  tocSplits: { page: number | null; title: string; columns: number }[];
  /** The source-map round trip (#857); null on an engine without `sourceAt`. */
  roundTrip: { levels: Record<string, { checked: number; missed: number }>; misses: { page: number; level: string; id: string; text: string }[] } | null;
}

// ─── Detected facts (capture.json `detected`) ───────────────────────────────

type Detected = CaptureVariant["detected"];

function isLeafObject(value: Record<string, unknown>): boolean {
  return ("hex" in value && "model" in value) || ("value" in value && "unit" in value);
}

/** The user config's shape: dotted key paths (≤ 3 segments, arrays as
 *  `[]`), top-level sections, leaf count (a colour or a dimension is one
 *  leaf) and design elements (items of every `elements` array). */
export function configStats(config: Record<string, unknown> | null | undefined): {
  keys: string[];
  sections: string[];
  leaves: number;
  designElements: number;
  paths: string[];
} {
  const keys = new Set<string>();
  const paths = new Set<string>();
  let leaves = 0;
  let designElements = 0;
  const walk = (value: unknown, segs: string[]) => {
    // An array item repeats its array's key: record paths on entering the array.
    if (segs.length && !segs[segs.length - 1].endsWith("[]")) {
      if (segs.length <= 3) keys.add(segs.join("."));
      paths.add(segs.join(".").replace(/\[\]/g, ""));
    }
    if (value === null || typeof value !== "object" || isLeafObject(value as Record<string, unknown>)) {
      leaves++;
      return;
    }
    if (Array.isArray(value)) {
      const last = segs[segs.length - 1] ?? "";
      if (last.replace(/\[\]/g, "") === "elements") {
        designElements += value.filter((item) => item && typeof item === "object").length;
      }
      if (value.every((item) => item === null || typeof item !== "object")) {
        leaves++;
        return;
      }
      const itemSegs = [...segs.slice(0, -1), `${last}[]`];
      for (const item of value) walk(item, itemSegs);
      return;
    }
    for (const [key, item] of Object.entries(value)) walk(item, [...segs, key]);
  };
  if (config) walk(config, []);
  return {
    keys: [...keys].sort(),
    sections: Object.keys(config ?? {}).sort(),
    leaves,
    designElements,
    paths: [...paths],
  };
}

/** Registry features whose `detect` rule fires on this capture. */
export function detectFeatures(
  registry: Registry | null,
  input: { paths: string[]; markdown: string; apis: string[] },
): { detected: string[]; rules: Set<string> } {
  const detected: string[] = [];
  const rules = new Set<string>();
  if (!registry) return { detected, rules };
  const test = (source: string): boolean => {
    try {
      return new RegExp(source, "m").test(input.markdown);
    } catch {
      return input.markdown.includes(source);
    }
  };
  for (const [id, feature] of Object.entries(registry.features ?? {})) {
    const rule = feature.detect;
    if (!rule) continue;
    rules.add(id);
    const hit =
      (rule.config ?? []).some((key) => {
        const want = key.replace(/\[\]/g, "");
        return input.paths.some((p) => p === want || p.startsWith(`${want}.`));
      }) ||
      (rule.markdown ?? []).some(test) ||
      (rule.api ?? []).some((name) => input.apis.includes(name));
    if (hit) detected.push(id);
  }
  return { detected: detected.sort(), rules };
}

const NAMED_STYLES = ["headingStyles", "calloutStyles", "paragraphStyles", "chipStyles", "tableStyles"];

/** Spec §2.3, from what the capture saw. */
export function suggestLevel(
  meta: RecipeMeta,
  facts: ProbeFacts,
  stats: { leaves: number; designElements: number },
  apis: string[],
): Level {
  const kinds = new Set(facts.builds.map((b) => b.kind));
  const s = facts.signals;
  const advanced =
    kinds.has("bundle") || kinds.has("worker") || !!s?.partPalette || !!s?.rotated || !!s?.splitTables ||
    !!s?.sideFloats || !!meta.engine.math || !!meta.engine.worker || meta.outputs.includes("live") ||
    stats.leaves > 200 || stats.designElements > 12;
  if (advanced) return 3;
  const config = facts.userConfig ?? {};
  const named = NAMED_STYLES.some((key) => Array.isArray(config[key]) && (config[key] as unknown[]).length > 0);
  const intermediate =
    stats.designElements > 0 || !!s?.placements || named || meta.outputs.includes("pdf") || meta.outputs.includes("epub") || stats.leaves >= 60 ||
    (facts.resources?.length ?? 0) > 1 || apis.length > 4;
  return intermediate ? 2 : 1;
}

/** The detected facts of capture.json. APIs, directives and inline
 *  constructs come from lib/cookbook/detect.ts, like the static detection
 *  the site falls back to before a capture, so both speak the same names;
 *  the config facts come from the config the engine actually received. */
export function detect(meta: RecipeMeta, facts: ProbeFacts, pen: ComposedPen, registry: Registry | null): Detected & { paths: string[] } {
  const apis = usedApis(pen.js);
  const stats = configStats(facts.userConfig);
  const resources = { svg: 0, bitmap: 0, table: 0 };
  for (const r of facts.resources ?? []) if (r.kind in resources) resources[r.kind as keyof typeof resources]++;
  const fonts = (facts.faces?.used ?? []).map(({ family, weight, style }) => ({ family, weight, style }));
  // Vertical and right-to-left text bind a book on the right without
  // saying page.binding, and an Arabic locale sets the text right to left
  // without saying direction or numerals: the document's binding, direction
  // and digits count as the keys.
  const paths = [...stats.paths];
  if (facts.binding === "right" && !paths.includes("page.binding")) paths.push("page.binding");
  if (facts.direction === "rtl" && !paths.includes("direction")) paths.push("direction");
  if (facts.numerals && !paths.includes("numerals")) paths.push("numerals");
  const { detected } = detectFeatures(registry, { paths, markdown: (facts.markdowns ?? []).join("\n"), apis });
  const directives = new Set<string>();
  const inline = new Set<string>();
  for (const markdown of facts.markdowns ?? []) {
    const found = markdownConstructs(markdown);
    found.directives.forEach((d) => directives.add(d));
    found.inline.forEach((d) => inline.add(d));
  }
  return {
    apis,
    configKeys: stats.keys,
    configSections: stats.sections,
    configLeaves: stats.leaves,
    designElements: stats.designElements,
    directives: [...directives],
    inline: [...inline],
    resources,
    fonts,
    features: detected,
    suggestedLevel: suggestLevel(meta, facts, stats, apis),
    paths: stats.paths,
  };
}

// ─── PDF ────────────────────────────────────────────────────────────────────

const PAGE_OBJECT = /\/Type\s*\/Page(?![A-Za-z])/g;

/** Page objects in a PDF, including those packed in (Flate) object streams. */
export function pdfPageCount(bytes: Buffer): number {
  const text = bytes.toString("latin1");
  let count = (text.match(PAGE_OBJECT) ?? []).length;
  const stream = /(?<!end)stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = stream.exec(text))) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    // The stream's dictionary: from its `obj` keyword to `stream`.
    const head = text.slice(Math.max(0, text.lastIndexOf(" obj", match.index)), match.index);
    if (/\/Type\s*\/ObjStm/.test(head) && /\/FlateDecode/.test(head)) {
      try {
        count += (zlib.inflateSync(bytes.subarray(start, end)).toString("latin1").match(PAGE_OBJECT) ?? []).length;
      } catch {
        // A stream we cannot inflate holds no page objects we can count.
      }
    }
    stream.lastIndex = end;
  }
  return count;
}

// ─── The checks ─────────────────────────────────────────────────────────────

/** An EPUB the pen wrote, as the postext-epub shim recorded it and read it
 *  back with readEpub (check C30). */
export interface EpubRecord {
  layout: string | null;
  bytes: number;
  ms: number;
  /** Spine items, page-list entries and top-level contents entries readEpub found. */
  documents: number;
  pages: number;
  toc: number;
  /** The layout readEpub read from the package document. */
  readLayout: string | null;
  /** onWarning reports: `missingFont: Literata`, `missingImage: map.svg`. */
  warnings: string[];
  error: string | null;
}

/** A Sandbox bundle opened again by the pen's engine and laid out as the
 *  Sandbox lays a book out, beside the documents the pen built from the
 *  same source (lib/probe.js `readBundleBack`, check C33). */
export interface BundleReadBack {
  /** Why the engine could not read the bundle back (no `openBundle`). */
  skipped?: string;
  /** The bundle did not open, or its layout threw. */
  error?: string;
  /** One entry per chapter of the bundle or document of the pen: pages,
   *  layout hash and lines hash on each side (null where a side has none),
   *  and where the two layouts part. */
  chapters: {
    chapter: number;
    pen: { pages: number; hash: string; lines?: string } | null;
    bundle: { pages: number; hash: string; lines?: string } | null;
    difference: string | null;
    /** What gives the pen's pages back when the chapter is laid out again
     *  with it: the build's own `continuation` (its keys), which a bundle
     *  does not carry, or the configuration as the pen wrote it (the
     *  top-level keys that each do so alone, or only `together`). */
    cause?: { continuation?: string[]; configuration?: string[]; together?: boolean } | null;
  }[];
  /** Warnings the bundle's layout raises beyond the pen's (kind and what
   *  it names, positions aside). */
  extraWarnings: string[];
  /** How each side divides its words (the patterns of its resolved
   *  configuration and whether they run) and the language the bundle's
   *  configuration names, null when it names none (#660). Null or missing
   *  when a side has no resolved configuration to read. */
  language?: {
    pen: { locale: string; enabled: boolean };
    bundle: { locale: string; enabled: boolean };
    named: string | null;
  } | null;
}

/**
 * C33: the bundle against the pen (#690, check 1 of #660). The Sandbox
 * opens `<slug>.postext` and lays it out with the one configuration it
 * carries; the capture does the same with the pen's engine and fails when
 * a chapter comes out with another page count or another layout than the
 * pen's document, or raises a warning the pen's builds did not. It fails
 * as well when the bundle divides its words in another language than the
 * pen, or names no language at all (#660): the pen's engine sets such a
 * document in English, so its layout compares equal, while the Sandbox
 * reads it in the interface language and breaks its lines otherwise.
 */
export function readBackFindings(readBack: BundleReadBack | null | undefined): Finding[] {
  if (!readBack) return [];
  const out: Finding[] = [];
  const add = (severity: Severity, detail: string) => out.push({ check: "C33", severity, detail });
  if (readBack.skipped) {
    add("info", `the bundle was not read back: ${readBack.skipped}`);
    return out;
  }
  if (readBack.error) {
    add("fail", `the bundle does not open and lay out again: ${firstLines(readBack.error, 1)}`);
    return out;
  }
  const one = readBack.chapters.length === 1;
  const s = (n: number) => `${n} page${n === 1 ? "" : "s"}`;
  const keys = (list: string[], prefix = "") => list.map((key) => `${prefix}${key}`).join(", ");
  for (const c of readBack.chapters) {
    const chapter = one ? "the bundle" : `chapter ${c.chapter} of the bundle`;
    const built = one ? "the pen's document" : `the pen's document ${c.chapter}`;
    // Why, when laying the chapter out again found it.
    const why: string[] = [];
    if (c.cause?.configuration) {
      const named = c.cause.configuration.length ? ` in ${keys(c.cause.configuration)}${c.cause.together ? " (together)" : ""}` : "";
      why.push(`the configuration the bundle stores is not the pen's${named}`);
    }
    if (c.cause?.continuation?.length) why.push(`a bundle does not carry ${keys(c.cause.continuation, "continuation.")}`);
    const cause = why.length ? `. Cause: ${why.join(", and ")}` : "";
    if (!c.pen && c.bundle) add("fail", `${chapter} (${s(c.bundle.pages)}) has no document of the pen to compare with`);
    else if (c.pen && !c.bundle) add("fail", `${built} (${s(c.pen.pages)}) is no chapter of the bundle`);
    else if (c.pen && c.bundle && c.pen.pages !== c.bundle.pages) {
      add("fail", `${chapter} lays out to ${s(c.bundle.pages)}, ${built} to ${s(c.pen.pages)}${c.difference ? ` (${c.difference})` : ""}${cause}`);
    } else if (c.pen && c.bundle && c.pen.hash !== c.bundle.hash) {
      add("fail", `${chapter} is not laid out as ${built} (layout ${c.bundle.hash}, the pen's ${c.pen.hash})${c.difference ? `: ${c.difference}` : ""}${cause}`);
    }
  }
  for (const warning of readBack.extraWarnings) add("fail", `the bundle raises ${warning}, which the pen's builds do not`);
  const language = readBack.language;
  if (language) {
    const sets = (h: { locale: string; enabled: boolean }) => (h.enabled ? `hyphenates in ${h.locale}` : `sets its text without hyphenation (${h.locale})`);
    if (language.pen.locale !== language.bundle.locale || language.pen.enabled !== language.bundle.enabled) {
      add("fail", `the bundle ${sets(language.bundle)}, the pen ${sets(language.pen)}`);
    } else if (!language.named) {
      add("fail", `the bundle's configuration names no language, and the pen ${sets(language.pen)}: `
        + "the Sandbox reads such a document in the interface language and breaks its lines otherwise");
    }
  }
  return dedupe(out);
}

export interface CheckInput {
  meta: RecipeMeta;
  facts: ProbeFacts | null;
  done: "ok" | "error" | "timeout";
  err: string | null;
  loaderErrors: string[];
  console: { type: string; text: string }[];
  pageErrors: string[];
  net: { severity: "fail" | "warn"; detail: string }[];
  failedRequests: string[];
  settleTimedOut: boolean;
  /** The kit's state before the PDF was built. */
  kit: { state: string | null; status: string | null } | null;
  tainted: number[];
  /** Captured without request interception (a worker recipe). */
  passive: boolean;
  /** postext versions the layout worker imported; the pinned one. */
  workerEngines: string[];
  engine: string;
  timeoutMs: number;
  totalMs: number;
  pdf: { button: boolean; timedOut: boolean; error: string | null; fontFailures: string[]; bytes: number; pages: number | null } | null;
  /** The EPUBs the pen wrote with postext-epub (C30). */
  epubs?: EpubRecord[];
  published: number[];
  publishError: string | null;
  cardErrors: string[];
  renderError: { message: string; taint: boolean } | null;
  magnification: number | null;
  /** Bytes of the edition's images (PDF excluded). */
  bytes: number;
  /** Bytes of card.webp, card.480.webp and og.jpg. */
  cardBytes: { card: number; card480: number; og: number } | null;
  assets: string[];
  detected: Detected & { paths: string[] };
  registry: Registry | null;
  previous: { chrome?: string; vdtHash?: string; sourceHash?: string } | null;
  chrome: string;
  vdtHash: string;
  sourceHash: string;
}

const MB = 1024 * 1024;
const ATTRIBUTION = new Set(["CC-BY", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-4.0"]);
const IMAGE_ASSET = /\.(svg|png|jpe?g|webp|gif|avif|pdf)$/i;

const firstLines = (text: string, n = 3) => text.split("\n").slice(0, n).join(" ⏎ ").slice(0, 400);
const pct = (share: number) => `${(share * 100).toFixed(1)} %`;
const stem = (file: string) => file.replace(/^.*\//, "").replace(/\.[^.]+$/, "").toLowerCase();

/** How C31 judges each `ConfigWarning` kind of the engine. */
const CONFIG_WARNING_SEVERITY: Record<string, Severity> = {
  cjkGridClamped: "fail",
  sideColumnPercentClamped: "fail",
  columnCountClamped: "fail",
  unknownNumberFormat: "fail",
  unknownNumerals: "fail",
  unknownConfigValue: "fail",
  unknownConfigKey: "fail",
  lineNumbersUnsupported: "fail",
  fontFamilyStack: "warn",
  // Text kept in a design (#849): the pages are as asked, the source is not.
  contentInConfig: "warn",
};

/** A config warning as C31 prints it: the kind, where, and what the engine did. */
export function configWarningText(w: ProbeConfigWarning): string {
  const value = JSON.stringify(w.value);
  switch (w.kind) {
    case "cjkGridClamped":
      return `cjkGridClamped: ${w.path} asks for ${w.value}, the margins leave room for ${w.used}; the grid sets ${w.used}`;
    case "sideColumnPercentClamped":
      return `sideColumnPercentClamped: ${w.path} ${value} leaves a column with no width; the columns are cut at ${w.used} %`;
    case "columnCountClamped":
      return `columnCountClamped: ${w.path} ${value} is not a column count from 3 to 8; the page is cut into ${w.used} columns`;
    case "unknownNumberFormat":
      return `unknownNumberFormat: ${w.path} ${value} is no format the engine knows; it numbers in ${w.used}`;
    case "unknownNumerals":
      return `unknownNumerals: ${w.path} ${value} names no digit system; the digits are ${w.used}`;
    case "unknownConfigValue":
      return `unknownConfigValue: ${w.path} ${value} is not one of its choices${w.suggestion ? ` (${w.suggestion}?)` : ""}; the engine used ${w.used}`;
    case "unknownConfigKey":
      return `unknownConfigKey: ${w.path} is no key of that setting${w.suggestion ? ` (${w.suggestion}?)` : ""}; the engine ignores it`;
    case "lineNumbersUnsupported":
      return `lineNumbersUnsupported: ${w.path}: vertical documents get no line numbers`;
    case "contentInConfig":
      return `contentInConfig: ${w.path} keeps ${w.count ?? 1} design text${w.count === 1 ? "" : "s"} of content (${w.chars ?? 0} letters, ${value}); move the text into the Markdown or list the phrase in checks.contentInConfig.allow`;
    case "fontFamilyStack":
      return `fontFamilyStack: ${w.path} ${value} is a font stack; the text is set in ${w.used} alone`;
    default:
      return `${w.kind}: ${w.path} ${value}${w.used ? `; the engine used ${w.used}` : ""}`;
  }
}

/** Folds identical findings into one, counted. */
function dedupe(findings: Finding[]): Finding[] {
  const counts = new Map<string, { finding: Finding; n: number }>();
  for (const f of findings) {
    const key = `${f.check}\0${f.severity}\0${f.detail}`;
    const seen = counts.get(key);
    if (seen) seen.n++;
    else counts.set(key, { finding: f, n: 1 });
  }
  return [...counts.values()].map(({ finding, n }) => (n > 1 ? { ...finding, detail: `${finding.detail} (×${n})` } : finding));
}

/** Whether a code point is in Fontsource's latin-ext file and not in its
 *  latin file (the cjk kit block's cjkLatinExtOnly). */
function latinExtOnly(cp: number): boolean {
  if (!((cp >= 0x100 && cp <= 0x2ff) || (cp >= 0x1e00 && cp <= 0x1eff))) return false;
  return ![0x131, 0x152, 0x153, 0x2bb, 0x2bc, 0x2c6, 0x2da, 0x2dc].includes(cp);
}

export function runChecks(input: CheckInput): Finding[] {
  return dedupe(collect(input));
}

function collect(input: CheckInput): Finding[] {
  const { meta, facts } = input;
  const out: Finding[] = [];
  const add = (check: string, severity: Severity, detail: string) => out.push({ check, severity, detail });
  const expect = meta.capture.expect ?? {};

  // C1: the script failed or never finished.
  if (input.done === "timeout") add("C1", "fail", `timed out after ${Math.round(input.timeoutMs / 1000)} s waiting for the pen to finish`);
  if (input.done === "error") add("C1", "fail", `the script threw: ${firstLines(input.err ?? "unknown error")}`);
  const errors = new Set([...input.pageErrors, ...input.loaderErrors].map((e) => firstLines(e, 2)));
  for (const error of [...errors].slice(0, 5)) add("C1", "fail", `uncaught: ${error}`);
  if (input.kit?.state === "error") add("C1", "fail", `the kit reported an error: ${input.kit.status ?? ""}`.trim());

  // C2: console errors (resource failures are C3's).
  const accepted = expect.console ?? [];
  const consoleErrors = input.console
    .filter((m) => m.type === "error" && !/Failed to load resource/i.test(m.text))
    .filter((m) => !accepted.some((s) => m.text.includes(s)));
  for (const m of consoleErrors.slice(0, 5)) add("C2", "fail", `console.error: ${firstLines(m.text, 2)}`);

  // C3: the network.
  for (const issue of input.net) add("C3", issue.severity, issue.detail);
  for (const failure of input.failedRequests.slice(0, 8)) add("C3", "fail", failure);

  // C13 (the kit had to load faces FONTS does not list) went with kit fonts
  // v2: since postext 1.25 the engine loads the faces a config names, and
  // reports one it could not load as a `fontFallback` warning (C5, C12).

  if (input.settleTimedOut) add("H10", "warn", "builds kept arriving: no 500 ms quiet window within 10 s");
  if (input.passive) add("C3", "info", "a worker recipe: captured without request interception (hosts checked, network not cached)");
  const others = input.workerEngines.filter((v) => v !== input.engine);
  if (others.length) add("H6", "info", `the layout worker ran postext ${others.join(", ")} (workers ignore the import map; pages painted with ${input.engine})`);

  // C4: nothing built.
  if (!facts || facts.selected < 0) {
    if (input.done === "ok") add("C4", "fail", "nothing built: no buildDocument / buildBundle call reached the engine");
    return out;
  }
  const pages = facts.pages ?? [];
  if (!pages.length) {
    add("C4", "fail", "the document has no pages");
    return out;
  }
  if (facts.sourceKnown === false) {
    add("C7", "info", "the result was painted without a recorded build (a worker?): C7–C10 skipped");
  }

  // C5: layout warnings the recipe does not demonstrate on purpose.
  const expected = new Set(expect.warnings ?? []);
  for (const w of facts.warnings ?? []) {
    if (!expected.has(w.kind)) add("C5", "fail", `${w.kind} on page ${w.page} (${w.overflowPx} px over)`);
  }
  for (const w of [...(facts.indexWarnings ?? []), ...(facts.textWarnings ?? [])]) {
    if (!expected.has(w.kind)) add("C5", "fail", `${w.kind}${w.detail ? ` "${w.detail}"` : ""}${w.page ? ` on page ${w.page}` : ""}`);
  }
  for (const kind of expected) {
    const seen = [...(facts.warnings ?? []), ...(facts.indexWarnings ?? []), ...(facts.textWarnings ?? []), ...(facts.configWarnings ?? [])];
    if (!seen.some((w) => w.kind === kind)) add("C5", "info", `expect.warnings lists ${kind}, which did not occur`);
  }

  // C31: config values the engine replaced. A clamped grid or side column,
  // a numbering format or digit system it does not know, a value outside a
  // setting's choices and a key no setting has all give a page other than
  // the one the recipe's config claims, and a reader copies that config: they
  // fail; so do line numbers asked of a vertical document, which prints none.
  // A font stack is set in its first family, the face the recipe loads, so
  // the page is the one shown: a warning. A kind this list does not know
  // yet (a newer engine) warns until it is judged here.
  const composed = usesComposedPages(facts);
  for (const w of facts.configWarnings ?? []) {
    if (expected.has(w.kind)) continue;
    // On a recipe with composed pages these are C37's, and fail.
    if (composed && C37_CONFIG_KINDS.has(w.kind)) continue;
    add("C31", CONFIG_WARNING_SEVERITY[w.kind] ?? "warn", configWarningText(w));
  }

  // C37, C40, C41: composed pages, the source map, the configuration's size.
  out.push(...composedFindings(meta, facts), ...roundTripFindings(facts), ...configSizeFindings(facts));

  // C6: convergence.
  if (facts.converged === false) add("C6", "fail", `the layout did not converge (${facts.iterationCount} iterations)`);

  // C7–C11: the source against the engine and the config.
  for (const issue of facts.parseIssues ?? []) {
    add("C7", "fail", `${issue.kind} at chapter ${issue.chapter + 1}, line ${issue.line}: ${issue.excerpt}`);
  }
  for (const fence of facts.badFences ?? []) {
    add("C8", "fail", `chapter ${fence.chapter + 1}, line ${fence.line}: "${fence.text}" is not a known directive (printed as text)`);
  }
  for (const s of facts.unknownStyles ?? []) add("C9", "fail", `unknown ${s.what} "${s.id}" (${s.at})`);
  for (const r of facts.unknownRefs ?? []) add("C10", "fail", `unknown resource "${r.id}" in ${r.usage} (${r.at}): printed "?"`);
  for (const id of facts.duplicates ?? []) add("C10", "fail", `resource id "${id}" is declared more than once`);
  for (const u of facts.unregistered ?? []) {
    add("C11", "fail", `image "${u.fileId}" (page ${u.page}) is placed but never registered: a grey placeholder`);
  }

  // C32: formulas the maths engine could not set (#683). Each prints as a
  // small red box and takes the room of one, so the pages after it are not
  // the recipe's. One line per message: when the engine's MathJax is broken
  // (not a formula's TeX), every formula of the document fails alike.
  const mathErrors = new Map<string, { page: number; tex: string }[]>();
  for (const m of facts.mathErrors ?? []) mathErrors.set(m.error, [...(mathErrors.get(m.error) ?? []), m]);
  for (const [error, list] of mathErrors) {
    const first = list[0];
    const source = first.tex.replace(/\s+/g, " ").trim();
    const tex = source.length > 60 ? `${source.slice(0, 59)}…` : source;
    const more = list.length > 1 ? ` (and ${list.length - 1} more with the same message)` : "";
    add("C32", "fail", `the formula $${tex}$ on page ${first.page} is set as a red box: ${firstLines(error, 1)}${more}`);
  }

  // C12: faces the pages use that no FontFace covers, and characters a CJK
  // or Arabic face set from files that loaded after the layout (measured in
  // another face).
  const faceName = (face: ProbeFace) => `${face.family} ${face.weight}${face.style === "italic" ? " italic" : ""}`;
  for (const face of facts.faces?.missing ?? []) {
    add("C12", "fail", `${faceName(face)} is used (${face.where}) but not loaded`);
  }
  for (const face of facts.faces?.late ?? []) {
    add("C12", "fail", `${faceName(face)} sets ${[...face.chars].join(" ")} (${face.where}) from files not loaded when the layout ran: ` +
      (/\p{Script=Arabic}/u.test(face.chars)
        ? "list the weight in FONTS and load it with loadArabicFonts(FONTS, markdown) before the build"
        : "give loadCjkFonts the text this face sets, and list the weight in FONTS"));
  }

  // C36: characters set in a font of the system (#746). No loaded file of
  // the family holds them, so the browser takes another font for each: one
  // of the reader's machine, with other widths on every system, and the
  // lines a reader gets are then not the published ones. A recipe gives
  // such a character a face or writes another; the one it may accept
  // (`capture.expect.systemFont`) is a mark the engine sets by itself and
  // no text face holds, the task box ☐, which its write-up then names.
  const acceptedMarks = new Set(expect.systemFont ?? "");
  const systemMarks = new Set<string>();
  for (const face of facts.systemFont ?? []) {
    for (const c of face.chars) systemMarks.add(c.ch);
    const chars = face.chars.filter((c) => !acceptedMarks.has(c.ch));
    if (!chars.length) continue;
    const shown = chars.slice(0, 12).map((c) => `${c.ch} ${c.code}`).join(", ");
    const more = chars.length > 12 ? ` and ${chars.length - 12} more` : "";
    add("C36", "fail", `${faceName(face)} sets ${shown}${more} (${chars[0]!.where}) in no file the page loaded: ` +
      "the browser takes a font of the system for them, another on every machine. Load the file of the family that holds them, " +
      "set them in a family that does, or write another character");
  }
  const taken = [...acceptedMarks].filter((ch) => systemMarks.has(ch));
  if (taken.length) add("C36", "info", `${taken.join(" ")} set in a font of the system, as capture.expect.systemFont accepts: the shape is the reader's machine's`);
  for (const ch of acceptedMarks) {
    if (facts.systemFont && !systemMarks.has(ch)) add("C36", "info", `capture.expect.systemFont lists ${ch}, which a face of the pages holds now`);
  }

  // C14: the PDF.
  if (meta.downloads?.pdf) {
    const pdf = input.pdf;
    if (!pdf || !pdf.button) add("C14", "fail", "downloads.pdf is set but the page has no [data-postext-pdf] button (offerPdf)");
    else {
      if (pdf.timedOut) add("C14", "fail", "the PDF did not finish in time");
      if (pdf.error) add("C14", "fail", `renderToPdf threw: ${firstLines(pdf.error, 1)}`);
      for (const f of pdf.fontFailures) add("C14", "fail", `font provider failed: ${f}`);
      if (!pdf.error && !pdf.timedOut && !pdf.bytes) add("C14", "fail", "no PDF bytes were produced");
      if (pdf.bytes && pdf.pages !== null) {
        if (pdf.pages === 0) add("C14", "warn", "could not count the PDF's pages");
        else {
          // Of a capture of several builds, the PDF is one of them, or all
          // of them chained into one publication (#540): their pages summed.
          const counts = (facts.selectedBuilds ?? []).map((i) => facts.builds[i]?.pages ?? 0);
          if (counts.length > 1) {
            const sum = counts.reduce((a, b) => a + b, 0);
            if (!counts.includes(pdf.pages) && pdf.pages !== sum) {
              add("C14", "fail", `the PDF has ${pdf.pages} pages, the documents ${counts.join(" and ")} (${sum} together)`);
            }
          } else if (pdf.pages !== pages.length) add("C14", "fail", `the PDF has ${pdf.pages} pages, the document ${pages.length}`);
        }
      }
      if (pdf.bytes > 2 * MB) add("C20", "fail", `the PDF weighs ${(pdf.bytes / MB).toFixed(2)} MB (limit 2 MB)`);
    }
  }

  // C30: the EPUBs. A recipe with an "epub" output writes at least one
  // while its module runs, and every file reads back in its own layout.
  const epubs = input.epubs ?? [];
  if (meta.outputs.includes("epub") && !epubs.length) {
    add("C30", "fail", "outputs include \"epub\" but the pen wrote no EPUB before it settled (call renderToEpub at top level)");
  }
  for (const epub of epubs) {
    const name = `the ${epub.layout ?? "?"} EPUB`;
    if (epub.error) add("C30", "fail", `${name}: ${firstLines(epub.error, 1)}`);
    else if (!epub.bytes || !epub.documents) add("C30", "fail", `${name} has no content documents`);
    else if (epub.readLayout !== epub.layout) add("C30", "fail", `${name} reads back as ${epub.readLayout ?? "no layout"}`);
    for (const warning of epub.warnings) add("C30", "warn", `${name}: ${warning}`);
    if (epub.bytes > 2 * MB) add("C20", "warn", `${name} weighs ${(epub.bytes / MB).toFixed(2)} MB`);
  }

  // C15 and the pictures.
  if (input.tainted.length) {
    add("C15", "fail", `page ${input.tainted.join(", ")} taints the canvas (a cross-origin image without CORS): no PNG export`);
  }
  if (input.renderError && !(input.renderError.taint && input.tainted.length)) {
    add(input.renderError.taint ? "C15" : "render", "fail",
      input.renderError.taint ? `canvas tainted (cross-origin image): ${input.renderError.message}` : input.renderError.message);
  }
  for (const problem of input.cardErrors) add("card", "fail", problem);
  if (input.publishError) add("C20", "fail", input.publishError);
  if (input.magnification !== null && (input.magnification < 1.5 || input.magnification > 4)) {
    add("card", "info", `the loupe magnifies ${input.magnification}×: aim for 2–3× (narrow or widen capture.focus)`);
  }

  // C16: printed garbage.
  for (const g of facts.garbage ?? []) add("C16", "fail", `"${g.text}" (${g.where})`);

  // C17: the default skin.
  const skin = facts.defaultSkin;
  if (skin) {
    const allowed = new Set(expect.defaultSkin ?? []);
    const hits: string[] = [];
    if (skin.body) hits.push("body text is the default EB Garamond 8 pt");
    if (skin.headingLevels.length && !allowed.has("headings")) {
      hits.push(`heading level ${skin.headingLevels.join(", ")} in the default Open Sans #295AA3`);
    }
    if (skin.header) hits.push("no header in the config (the default running heads)");
    if (skin.footer) hits.push("no footer in the config (the default folio)");
    if (skin.colors.length) hits.push(`${skin.colors.join(", ")} left at the default #295AA3`);
    if (skin.callouts && !allowed.has("callouts")) hits.push(`${skin.callouts} callout(s) in the default #f4f4f4 box without a stripe`);
    if (skin.tables && !allowed.has("tables")) hits.push(`${skin.tables} table(s) with the default grid and #f0f0f0 header`);
    if (skin.lists && !allowed.has("lists")) hits.push(`${skin.lists} list item(s) with the default #295AA3 bullets`);
    if (skin.palette) hits.push("no colorPalette");
    for (const hit of hits) add("C17", "fail", `default skin: ${hit}`);
  }

  // C18: empty pages that should not be.
  for (const p of pages) {
    if (!p.blank && (p.role === "body" || p.role === "opener") && p.blocks === 0) {
      add("C18", "fail", `page ${p.n} (${p.role}) is empty and is not a parity blank`);
    }
  }

  // C19: credits.
  const images = meta.credits?.images ?? [];
  for (const asset of input.assets.filter((a) => IMAGE_ASSET.test(a))) {
    const file = asset.replace(/^assets\//, "");
    if (!images.some((c) => c.file === file || c.file === asset)) add("C19", "fail", `${asset} has no credits.images entry`);
  }
  for (const credit of images.filter((c) => c.file && ATTRIBUTION.has(c.license))) {
    for (const r of (facts.resources ?? []).filter((x) => x.fileId && stem(x.fileId) === stem(credit.file ?? ""))) {
      if (!r.note) add("C19", "fail", `resource "${r.id}" shows ${credit.file} (${credit.license}) without a note crediting it`);
    }
  }

  // C20: budget. The warning grows with the pages published (0.1 MB each,
  // 0.9 MB at least): a dense text page weighs about 100 KB whatever it shows.
  const warnMb = Math.max(0.9, 0.1 * input.published.length);
  if (input.bytes > 1.4 * MB) add("C20", "fail", `the edition's images weigh ${(input.bytes / MB).toFixed(2)} MB (limit 1.4 MB)`);
  else if (input.bytes > warnMb * MB) add("C20", "warn", `the edition's images weigh ${(input.bytes / MB).toFixed(2)} MB (warning at ${warnMb.toFixed(1)} MB for ${input.published.length} pages)`);

  const cardLimits = { card: 90, card480: 35, og: 90 } as const;
  const cardNames = { card: "card.webp", card480: "card.480.webp", og: "og.jpg" } as const;
  for (const key of ["card", "card480", "og"] as const) {
    const size = input.cardBytes?.[key] ?? 0;
    if (size > cardLimits[key] * 1024) add("C20", "warn", `${cardNames[key]} weighs ${Math.round(size / 1024)} KB (aim for ≤ ${cardLimits[key]} KB)`);
  }

  // C21: performance, of each build that is the result.
  for (const i of facts.selectedBuilds ?? [facts.selected]) {
    const build = facts.builds[i];
    if (!build) continue;
    if (build.ms > 4000) add("C21", "fail", `the build took ${Math.round(build.ms)} ms (limit 4 s)`);
    else if (build.ms > 1500) add("C21", "warn", `the build took ${Math.round(build.ms)} ms (warning at 1.5 s)`);
  }
  if (input.totalMs > 30_000) add("C21", "warn", `the pen took ${(input.totalMs / 1000).toFixed(1)} s to finish (warning at 30 s)`);

  // C22: blank cascades.
  let run = 0;
  let longest = 0;
  for (const p of pages) {
    run = p.blank ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const blanks = pages.filter((p) => p.blank).length;
  const chapters = facts.signals?.chapters ?? 1;
  if (longest > 2) add("C22", "warn", `${longest} blank pages in a row`);
  else if (blanks > chapters) add("C22", "warn", `${blanks} blank pages for ${chapters} chapter(s)`);

  // C23: near-empty pages.
  const sparse = new Set(expect.nearEmptyPages ?? []);
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    const chapterEnd = !next || next.docIndex !== p.docIndex || next.h1 || next.blank || next.role !== "body";
    if (p.role !== "body" || p.blank || chapterEnd || sparse.has(p.n)) return;
    if (p.coverage < 0.25) add("C23", "warn", `page ${p.n} is only ${pct(p.coverage)} filled (not a chapter's last page)`);
  });

  // C24: loose lines. Latin lines by their word spaces; Chinese, Japanese
  // and Korean lines by the space between their characters, which is how
  // they are justified: only a line past the cap, set short, is loose.
  const clipText = (text: string) => (text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text);
  // A ratio to two decimals, whatever the probe recorded (#924: an older
  // probe left 2.8000000000000003).
  const times = (v: number) => `${Math.round(v * 100) / 100}×`;
  const loose = facts.loose;
  if (loose && loose.total && loose.share > 0.02) {
    const where = (loose.lines ?? []).slice(0, 3).map((l) => `p. ${l.page} ${times(l.ratio)} “${clipText(l.text)}”`);
    add("C24", "warn", `${loose.count} of ${loose.total} justified lines (${pct(loose.share)}) stretch past ${times(loose.threshold)} (worst ${times(loose.worst)})${where.length ? `; loosest: ${where.join(", ")}` : ""}`);
  }
  // C34: a justified line set ragged (its word spaces would have stretched
  // past 3×) is a line left short in the middle of a paragraph. A recipe
  // fits its copy, or accepts a count (`capture.expect.raggedLines`).
  const raggedLines = facts.raggedLines;
  if (raggedLines) {
    const accepted = meta.capture.expect?.raggedLines ?? 0;
    const s = (n: number) => `${n} justified line${n === 1 ? "" : "s"}`;
    if (raggedLines.count > accepted) {
      const where = raggedLines.lines.slice(0, 5).map((l) => `${l.page === null ? "" : `p. ${l.page} `}${times(l.ratio)} “${clipText(l.text)}”`);
      add("C34", "fail", `${s(raggedLines.count)} set ragged (word spaces past 3×)${accepted ? `, and the recipe accepts ${accepted}` : ""}: ${where.join(", ")}. Reword the copy, give the line a break it can take, or accept the count with capture.expect.raggedLines`);
    } else if (accepted > raggedLines.count) {
      add("C34", "info", `capture.expect.raggedLines accepts ${accepted}, and the edition has ${raggedLines.count}`);
    }
  }
  // C35: paragraphs set a line short to take up a runt, the ones that
  // needed tracking: a paragraph at the cap reads tight beside its
  // neighbours, and a few words less would have set it without.
  const runtFixes = facts.runtFixes;
  if (runtFixes && runtFixes.tracked > 0) {
    const where = runtFixes.blocks.map((b) => `p. ${b.page} −${b.tracking}‰ “${b.text}${b.text.length >= 48 ? "…" : ""}”`);
    add("C35", "info", `${runtFixes.tracked} paragraph${runtFixes.tracked === 1 ? "" : "s"} set a line short with tracking (worst −${runtFixes.worst}‰${runtFixes.atCap ? ", the cap" : ""}): ${where.join(", ")}`);
  }
  const cjkLoose = facts.cjkLoose;
  if (cjkLoose && cjkLoose.count > 0) {
    const where = (cjkLoose.lines ?? []).slice(0, 3).map((l) => `p. ${l.page} “${clipText(l.text)}”`);
    add("C24", "warn", `${cjkLoose.count} of ${cjkLoose.total} justified Chinese, Japanese or Korean lines needed more than ${cjkLoose.threshold} em between characters and end short (cjkLooseLine)${where.length ? `; ${where.join(", ")}` : ""}`);
  }

  // C25: characters a PDF recipe's fonts cannot set: those outside
  // Fontsource's latin subset that no loaded face covers (a CJK face the
  // cjk block loads by slices covers its own, an Arabic face the arabic
  // block completes covers the Arabic letters), and what postext-pdf drew
  // with no glyph (its missingGlyph warning, printed to the console). The
  // kit's providers also embed a face's latin-ext file (#466) and, in the
  // pdf block, its greek file (#541), so a letter of those files that the
  // face holds on screen is in the PDF.
  const pdfRecipe = meta.outputs.includes("pdf") || !!meta.downloads?.pdf;
  const embedded = (cp: number) => latinExtOnly(cp) || (!meta.kit.includes("cjk") && cp >= 0x370 && cp <= 0x3ff);
  const outside = (facts.nonLatin ?? []).filter((c) => !(c.ownFile && embedded(c.ch.codePointAt(0) ?? 0)));
  if (pdfRecipe && outside.length) {
    add("C25", "warn", `outside the latin subset: ${outside.map((c) => `${c.ch} ${c.code}`).join(", ")}`);
  }
  if (pdfRecipe) {
    const MISSING = /^postext-pdf: "(.+?)" (\d+(?: italic)?) has no glyph for [^(]*\((.+?)\); the PDF draws them/;
    for (const m of input.console) {
      const hit = MISSING.exec(m.text);
      if (hit) add("C25", "warn", `the PDF has no glyph for "${hit[1]}" ${hit[2]}: ${hit[3]}`);
    }
    // HarfBuzz not loaded: the PDF still builds, its Arabic shaped by
    // fontkit with every mark misplaced, which no page count shows.
    // postext-pdf says so on the console (its complexShapingUnavailable
    // warning; the shim prints it even when the pen passes onWarning).
    const noShaper = input.console.find((m) => /^postext-pdf: HarfBuzz did not load/.test(m.text));
    if (noShaper) add("C14", "fail", `the PDF's right-to-left text was shaped without HarfBuzz: ${firstLines(noShaper.text, 1)}`);
  }

  // C26: hero legibility.
  const hero = pages.filter((p) => p.legibility !== undefined);
  if (hero.length) {
    const share = hero.reduce((sum, p) => sum + (p.legibility ?? 0), 0) / hero.length;
    if (share < 0.25) add("C26", "warn", `the hero is ${pct(share)} colour, pictures or display type (aim for 25 %+)`);
  }

  // C27: declared features whose detect rule did not fire.
  if (input.registry) {
    const fired = new Set(input.detected.features);
    for (const id of meta.features?.primary ?? []) {
      if (input.registry.features?.[id]?.detect && !fired.has(id)) add("C27", "warn", `features.primary lists ${id}, but its detect rule did not fire`);
    }
  }

  // C28: level sanity.
  if (Math.abs(meta.level - input.detected.suggestedLevel) >= 2) {
    add("C28", "warn", `declared level ${meta.level}, the capture suggests ${input.detected.suggestedLevel}`);
  }

  // C29: page-count drift.
  if (expect.pages && (pages.length < expect.pages[0] || pages.length > expect.pages[1])) {
    add("C29", "warn", `${pages.length} pages, outside expect.pages ${expect.pages[0]}–${expect.pages[1]}`);
  }

  // Against the committed capture.
  const prev = input.previous;
  if (prev?.chrome && prev.chrome !== input.chrome) {
    add("chrome", "warn", `Chrome ${input.chrome}, the committed capture used ${prev.chrome}: pixels may differ`);
  }
  if (prev?.vdtHash && prev.vdtHash !== input.vdtHash) {
    add("vdt", prev.sourceHash === input.sourceHash ? "warn" : "info",
      prev.sourceHash === input.sourceHash
        ? "the layout changed with the same sources (engine or font regression?)"
        : "the layout changed since the committed capture");
  }
  return out;
}

// ─── The composed-page bench (#869) ─────────────────────────────────────────

/** Configuration warnings of page templates (#853), as `ConfigWarning`
 *  kinds: on a recipe with composed pages, C37 failures. */
export const PAGE_TEMPLATE_WARNING_KINDS = [
  "templateDuplicate", "templateExtendsCycle", "templateExtendsUnknown", "frameDuplicate", "frameStyleUnknown",
  "frameAnchorUnknown", "frameMinMax", "groupFrameUnknown", "groupFrameTwice", "frameChainLoop",
  "overflowTargetUnknown", "labelStyleUnknown",
] as const;
const C37_CONFIG_KINDS: ReadonlySet<string> = new Set(["contentInConfig", ...PAGE_TEMPLATE_WARNING_KINDS]);

/** The largest configuration a recipe may hand the engine (C41): what the
 *  Sandbox loads and a reader copies. */
export const CONFIG_LIMIT_BYTES = 1024 * 1024;

/** Whether the result has composed pages, or its Markdown declares them
 *  (a `::::page{template=…}` whose template is missing still does). */
export function usesComposedPages(facts: ProbeFacts | null | undefined): boolean {
  const c = facts?.composed;
  return !!c && (c.declared || c.pages.length > 0 || c.warnings.length > 0);
}

const pageOf = (page: number | null | undefined) => (page ? ` on page ${page}` : "");

/** A `frameOverflow` in a line: what did not fit and what would fit it. */
function overflowText(w: ComposedFacts["warnings"][number]): string {
  const where = `frame "${w.frame}" of template "${w.template}"${pageOf(w.page)}`;
  const fixes = (w.proposals ?? []).map((p) => p.text ?? `${p.kind} ${p.path ?? ""} ${JSON.stringify(p.value)}`.replace(/\s+/g, " ").trim());
  const steps = w.steps?.length ? ` after ${w.steps.join(", ")}` : "";
  return `frameOverflow: ${where} is ${w.overflowMm ?? "?"} mm short of its content${steps}${fixes.length ? `; to fit: ${fixes.join("; or ")}` : "; no proposal"}`;
}

/** A proposal says what to change and to what (#858): a kind and a value. */
export function usefulProposal(p: ComposedProposalFact): boolean {
  if (!p || typeof p.kind !== "string" || !p.kind) return false;
  const v = p.value;
  if (v === undefined || v === null || v === "") return false;
  if (typeof v === "number") return Number.isFinite(v) && v > 0;
  return true;
}

/**
 * C37: the warnings no recipe with composed pages may raise, on every
 * edition: `frameOverflow` (content cut at a frame's foot), `tocGroupSplit`
 * (a contents block cut between columns), `contentInConfig` (the book's
 * text kept in a design), the composed pages' source warnings
 * (`templateUnknown`, `slotUnknown`, `slotEmpty`, `pageFenceLength`) and the
 * page templates' configuration warnings. Failures on a recipe that uses
 * composed pages, whatever `expect.warnings` says; on any other recipe a
 * `tocGroupSplit` is a warning (`contentInConfig` stays C31's).
 */
export function composedFindings(meta: Pick<RecipeMeta, "capture">, facts: ProbeFacts | null | undefined): Finding[] {
  const out: Finding[] = [];
  if (!facts) return out;
  const c = facts.composed;
  const uses = usesComposedPages(facts);
  const add = (severity: Severity, detail: string) => out.push({ check: "C37", severity, detail });
  const expected = new Set(meta.capture.expect?.warnings ?? []);
  for (const w of c?.warnings ?? []) {
    if (w.kind === "frameOverflow") add("fail", overflowText(w));
    else add("fail", w.text ? `${w.kind}${pageOf(w.page)}: ${w.text}` : `${w.kind}${pageOf(w.page)}${w.slot ? ` (slot "${w.slot}")` : ""}${w.frame ? ` (frame "${w.frame}")` : ""}`);
  }
  for (const t of c?.tocSplits ?? []) {
    if (!uses && expected.has("tocGroupSplit")) continue;
    add(uses ? "fail" : "warn", `tocGroupSplit: the contents block "${t.title}" is cut into ${t.columns} columns${pageOf(t.page)}`);
  }
  if (uses) {
    for (const w of facts.configWarnings ?? []) {
      if (C37_CONFIG_KINDS.has(w.kind)) add("fail", configWarningText(w));
    }
    const excused = [...expected].filter((kind) => kind === "frameOverflow" || kind === "tocGroupSplit" || C37_CONFIG_KINDS.has(kind));
    if (excused.length) add("fail", `expect.warnings lists ${excused.join(", ")}: a recipe with composed pages cannot accept ${excused.length === 1 ? "it" : "them"}`);
  }
  return out;
}

/**
 * C40: the source-map round trip (#857). Every element a composed page's
 * fence laid out is clicked inside, and `sourceAt` must give back the same
 * element, or one of its level whose Markdown range holds its text. Each
 * one not found fails (at most five are named). On an engine without the
 * source map, a note: the check runs once the pinned engine has it.
 */
export function roundTripFindings(facts: ProbeFacts | null | undefined): Finding[] {
  const out: Finding[] = [];
  if (!facts || !usesComposedPages(facts)) return out;
  const trip = facts.composed!.roundTrip;
  const add = (severity: Severity, detail: string) => out.push({ check: "C40", severity, detail });
  if (trip === null) {
    add("info", "the engine has no source map (sourceAt, #857): the round trip is skipped until the pinned engine has it");
    return out;
  }
  const levels = Object.entries(trip.levels).sort(([a], [b]) => a.localeCompare(b));
  for (const miss of trip.misses.slice(0, 5)) {
    add("fail", `p. ${miss.page}: a click inside ${miss.level} ${miss.id}${miss.text ? ` “${miss.text}”` : ""} does not come back to it through sourceAt`);
  }
  if (trip.misses.length > 5) add("fail", `and ${trip.misses.length - 5} more elements the source map does not find again`);
  if (!trip.misses.length && levels.length) {
    add("info", `every element came back to its source: ${levels.map(([level, s]) => `${s.checked} ${level}`).join(", ")}`);
  }
  return out;
}

/** C41: the configuration the engine received is under 1 MB of JSON. */
export function configSizeFindings(facts: ProbeFacts | null | undefined): Finding[] {
  if (!facts?.userConfig) return [];
  const bytes = Buffer.byteLength(JSON.stringify(facts.userConfig), "utf8");
  if (bytes <= CONFIG_LIMIT_BYTES) return [];
  return [{ check: "C41", severity: "fail", detail: `the configuration weighs ${(bytes / CONFIG_LIMIT_BYTES).toFixed(2)} MB of JSON (limit 1 MB): move pictures and text out of it` }];
}

type ComposedPageFact = ComposedFacts["pages"][number];

/** Smallest change of a frame's box against the text as written, in mm. */
const MOVE_MM = 0.5;
const mmText = (v: number) => String(Math.round(v * 10) / 10);

/**
 * What the frames of a stretched page did against the same page on the
 * text as written, for the changes its reflow log does not say (#925): a
 * frame whose height follows its content and has no `minHeight` declares
 * no height, so the log reads nothing when it grows, nor when the frames
 * anchored to it move. «entradilla 6.2 mm taller than as written»,
 * «col-1 moved down 6.2 mm from where it was as written».
 */
export function changesAgainstBase(page: ComposedPageFact, base: ComposedPageFact | undefined): string[] {
  if (!base) return [];
  const logged = new Set(page.events.filter((e) => e.kind === "grew" || e.kind === "moved" || e.kind === "resized").map((e) => `${e.frame} ${e.kind}`));
  const before = new Map(base.frames.map((f) => [f.name, f]));
  const out: string[] = [];
  for (const f of page.frames) {
    const b = before.get(f.name);
    if (!f.box || !b?.box) continue;
    const [x, y, w, h] = f.box;
    const [bx, by, bw, bh] = b.box;
    if (Math.abs(h - bh) >= MOVE_MM && !logged.has(`${f.name} grew`) && !logged.has(`${f.name} resized`)) {
      out.push(`${f.name} ${mmText(Math.abs(h - bh))} mm ${h > bh ? "taller" : "shorter"} than as written`);
    } else if (Math.abs(w - bw) >= MOVE_MM && !logged.has(`${f.name} grew`) && !logged.has(`${f.name} resized`)) {
      out.push(`${f.name} ${mmText(Math.abs(w - bw))} mm ${w > bw ? "wider" : "narrower"} than as written`);
    }
    if (logged.has(`${f.name} moved`)) continue;
    if (Math.abs(y - by) >= MOVE_MM) out.push(`${f.name} moved ${y > by ? "down" : "up"} ${mmText(Math.abs(y - by))} mm from where it was as written`);
    else if (Math.abs(x - bx) >= MOVE_MM) out.push(`${f.name} moved ${x > bx ? "right" : "left"} ${mmText(Math.abs(x - bx))} mm from where it was as written`);
  }
  return out;
}

/** The base run's page for each stretched page: the same page fence and
 *  template, the k-th of them (a fence's added pages share its index). */
function basePages(pages: readonly ComposedPageFact[], base: readonly ComposedPageFact[] | undefined): (ComposedPageFact | undefined)[] {
  const key = (p: ComposedPageFact) => `${p.doc ?? 0}\u0000${p.fenceIndex}\u0000${p.template}`;
  const pool = new Map<string, ComposedPageFact[]>();
  for (const p of base ?? []) (pool.get(key(p)) ?? pool.set(key(p), []).get(key(p))!).push(p);
  const seen = new Map<string, number>();
  return pages.map((p) => {
    const k = seen.get(key(p)) ?? 0;
    seen.set(key(p), k + 1);
    return pool.get(key(p))?.[k];
  });
}

/** A continuation's receiving frame by its name, template and page (#925):
 *  «col-1 of seguido-par on p. 48», the id kept after it. */
function receiver(id: string, pages: readonly ComposedPageFact[]): string {
  for (const p of pages) {
    const f = p.frames.find((fr) => fr.id === id);
    if (f) return `${f.name} of ${p.template} on p. ${p.n} (${id})`;
  }
  return id;
}

/** A composed page of the stretched run in a line: what its frames did,
 *  from its reflow log and, where the log is silent, against `base` (the
 *  same page on the text as written). */
function pageStory(page: ComposedPageFact, base?: ComposedPageFact, pages: readonly ComposedPageFact[] = []): string {
  const events = page.events.filter((e) => e.kind !== "overflow");
  const continued = page.frames.filter((f) => f.continuesTo).map((f) => `${f.name} → ${receiver(f.continuesTo!, pages)}`);
  const said = events.map((e) => e.text ?? `${e.frame} ${e.kind}${e.fromMm !== undefined && e.toMm !== undefined ? ` ${e.fromMm}→${e.toMm} mm` : ""}${e.scale !== undefined ? ` ${Math.round(e.scale * 1000) / 10} %` : ""}`);
  const against = changesAgainstBase(page, base);
  const short = page.frames.filter((f) => (f.overflowMm ?? 0) > 0).map((f) => `${f.name} ${f.overflowMm} mm short`);
  const how = short.length ? "does not fit" : continued.length ? "goes on" : events.length || against.length ? "rearranged" : "fits as it was";
  const parts = [...said, ...against, ...continued.map((c) => `continues ${c}`), ...short];
  return `p. ${page.n} (${page.template}) ${how}${parts.length ? `: ${parts.slice(0, 6).join("; ")}${parts.length > 6 ? `; and ${parts.length - 6} more` : ""}` : ""}`;
}

export interface StressInput {
  meta: Pick<RecipeMeta, "capture">;
  factor: number;
  /** Characters of the edition's text before and after the stretch. */
  stretch: { before: number; after: number; unchanged: number };
  /** The stretched run: how it ended and what it found. */
  done: "ok" | "error" | "timeout";
  err?: string | null;
  pageErrors?: string[];
  facts: ProbeFacts | null;
  /** The run on the text as written: the page count, and each composed
   *  page's frames to compare with (#925). */
  base: ProbeFacts | null;
}

/**
 * C38: the stress test (`--stress 1.3`). The edition laid out again with
 * every text `factor` times as long (lib/cookbook/bench.ts
 * `stretchMarkdown`). Each composed page must rearrange (frames grow,
 * move, scale their text) or go on elsewhere: a note per page says which.
 * A warning the text as written does not raise fails, except a
 * `frameOverflow` that carries proposals with values, which is a warning
 * naming them (the copy-fitter's next move); one without a useful proposal
 * fails. So does a stretched run that throws, does not converge or builds
 * nothing.
 */
export function stressFindings(input: StressInput): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Severity, detail: string) => out.push({ check: "C38", severity, detail });
  const pctOf = (n: number) => `${(n * 100).toFixed(1)} %`;
  const { stretch, facts } = input;
  const grown = stretch.before ? stretch.after / stretch.before - 1 : 0;
  add("info", `the text made ${pctOf(grown)} longer (${stretch.before} → ${stretch.after} characters, asked ${pctOf(input.factor - 1)})${stretch.unchanged ? `; ${stretch.unchanged} paragraph${stretch.unchanged === 1 ? "" : "s"} with no plain word kept as written` : ""}`);
  if (input.done !== "ok") {
    add("fail", input.done === "timeout" ? "the stretched edition did not finish" : `the stretched edition threw: ${firstLines(input.err ?? "unknown error")}`);
    return out;
  }
  for (const e of [...new Set(input.pageErrors ?? [])].slice(0, 3)) add("fail", `the stretched edition: uncaught ${firstLines(e, 2)}`);
  if (!facts || facts.selected < 0 || !(facts.pages ?? []).length) {
    add("fail", "the stretched edition built nothing");
    return out;
  }
  if (facts.converged === false) add("fail", `the stretched edition did not converge (${facts.iterationCount} iterations)`);
  const expected = new Set(input.meta.capture.expect?.warnings ?? []);
  const c = facts.composed;
  const stretchedPages = c?.pages ?? [];
  const bases = basePages(stretchedPages, input.base?.composed?.pages);
  stretchedPages.forEach((page, i) => add("info", pageStory(page, bases[i], stretchedPages)));
  for (const w of c?.warnings ?? []) {
    if (w.kind !== "frameOverflow") {
      add("fail", `${w.kind}${pageOf(w.page)}${w.text ? `: ${w.text}` : ""}`);
      continue;
    }
    const useful = (w.proposals ?? []).filter(usefulProposal);
    add(useful.length ? "warn" : "fail", useful.length ? overflowText({ ...w, proposals: useful }) : `${overflowText(w)}: a warning under stress must carry a proposal with a value`);
  }
  for (const t of c?.tocSplits ?? []) add("fail", `tocGroupSplit: the contents block "${t.title}" is cut into ${t.columns} columns${pageOf(t.page)}`);
  for (const w of facts.warnings ?? []) {
    if (!expected.has(w.kind)) add("fail", `${w.kind} on page ${w.page} (${w.overflowPx} px over)`);
  }
  for (const w of facts.textWarnings ?? []) {
    if (!expected.has(w.kind)) add("fail", `${w.kind}${w.detail ? ` "${w.detail}"` : ""}${pageOf(w.page)}`);
  }
  const before = input.base?.pages?.length;
  const after = facts.pages?.length ?? 0;
  if (before !== undefined && before !== after) add("info", `${after} pages, ${before} as written`);
  return out;
}

/**
 * C39: the pages against the approved capture (`--compare`): the committed
 * capture of the same sources. Its layout hash against the run's (every
 * block, line and running head with its place), and, unless `--no-pixels`,
 * each published page decoded beside its committed image and compared in
 * cells of 8 × 8 px (lib/probe.js `pageDifference`): a page with a cell
 * whose mean difference in a channel is over the threshold (`--max-diff`,
 * 12 of 255 by default: another Chrome's glyph edges stay under it, a
 * word moved by a pixel does not) differs. A difference fails on the
 * engine the capture records, or with `--strict`; on another engine (the
 * working tree, a newer release) it warns, since a change of layout on
 * purpose is captured again after its release (`capture --verify` lists
 * it). With no capture of these sources, a note.
 */
export function compareFindings(input: {
  approved: { vdtHash?: string; engine?: string } | null;
  run: { vdtHash: string; engine: string };
  changes: { n: number; detail: string }[] | null | undefined;
  pages: number;
  maxDiff: number;
  pixels: boolean;
  strict?: boolean;
}): Finding[] {
  const add = (severity: Severity, detail: string): Finding => ({ check: "C39", severity, detail });
  const approved = input.approved;
  if (!approved) return [add("info", "no approved capture of these sources to compare with: capture the recipe, then compare")];
  const same = approved.engine === input.run.engine;
  const severity: Severity = same || input.strict ? "fail" : "warn";
  const on = same ? `on postext ${input.run.engine}, the engine it was approved on` : `on postext ${input.run.engine}; approved on ${approved.engine ?? "?"}`;
  const out: Finding[] = [];
  if (approved.vdtHash && input.run.vdtHash && approved.vdtHash !== input.run.vdtHash) {
    out.push(add(severity, `the layout is not the approved one (layout hash ${input.run.vdtHash.slice(0, 8)}, approved ${approved.vdtHash.slice(0, 8)}) ${on}`));
  }
  if (input.pixels) {
    if (!input.changes) out.push(add("info", "the pages were not compared with their images"));
    else for (const ch of input.changes) out.push(add(severity, `p. ${ch.n} is not the approved page: ${ch.detail} (threshold ${input.maxDiff}) ${on}`));
  }
  if (!out.length) {
    out.push(add("info", input.pixels
      ? `the layout and ${input.pages} page${input.pages === 1 ? "" : "s"} within ${input.maxDiff} of 255 of the approved capture`
      : "the layout is the approved one (pixels not compared)"));
  }
  return out;
}
