/**
 * `pnpm cookbook capture [slug…]`: runs every recipe edition in headless
 * Chrome against the released engine, verifies it (checks.ts) and writes
 * the generated media (spec §8.2–8.5):
 *
 *   apps/web/public/cookbook/<slug>/
 *     capture.json                      the manifest (types.ts CaptureManifest)
 *     <variant>/pNN.webp, pNN.s.webp    pages at 1000 and 240 px wide
 *     <variant>/card.webp, card.480.webp, og.jpg
 *     <variant>/<slug>.pdf              when downloads.pdf
 *     <variant>/<slug>.postext          the document, for the Sandbox
 *
 * A recipe writes only when every edition passes, and atomically (a temp
 * folder renamed over the old one). With the same sources, each kind of
 * file is judged on its own, whatever engine the run used (#734, unless
 * --force): the pages, card and OG image stay when the layout hash and the
 * file names are the same and every page is within rendering noise of its
 * committed image; the PDF stays when its bytes are the same (the capture
 * dates it the day the recipe was written); the bundle stays when its
 * bytes are the same or, written by another engine, it reads back as the
 * pen's documents on this one. `engine`, `chrome` and `capturedAt` name the
 * run that wrote files: a recipe with nothing to write keeps its folder
 * byte for byte, and a run on a newer release records that in `verified`
 * (#735; --verify writes only those records). On the recorded engine the
 * rest of the manifest (detection, diagnostics, alt text, spreads) still
 * follows the tooling, and capture.json alone is rewritten when only that
 * changed. --check verifies and writes nothing. --sandbox-only writes the `.postext` files
 * alone, with the engine each capture.json records (runSandboxOnly). A
 * bundle is read back against the pen's documents before it is kept (C33).
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { styleText } from "node:util";
import matter from "gray-matter";
import { folioConfigOf, folioHash } from "../../src/lib/cookbook/folio.ts";
import { declaresComposedPages, stretchedEdition, stretchMarkdown } from "../../src/lib/cookbook/bench.ts";
import { hash8, sourceHash } from "../../src/lib/cookbook/hash.ts";
import { captureDir, recipeDir, WEB_DIR } from "../../src/lib/cookbook/paths.ts";
import { loadRegistry } from "../../src/lib/cookbook/registry.ts";
import { compareSemVer } from "../../src/lib/cookbook/validate.ts";
import { listRecipeSlugs, readRecipeMeta, readRecipeSources } from "../../src/lib/cookbook/sources.ts";
import type { CaptureManifest, CaptureVariant, SampleLocale, RecipeMeta, Registry, SemVer } from "../../src/lib/cookbook/types.ts";
import { SAMPLE_LOCALES } from "../../src/lib/cookbook/types.ts";
import { altText, sidesOf, spreadsOf } from "./cards.ts";
import { compareFindings, detect, pdfPageCount, readBackFindings, runChecks, stressFindings } from "./checks.ts";
import type { Finding } from "./checks.ts";
import type { HarnessBrowser, PageChange, SandboxBundle, SandboxMeta, VariantRun } from "./harness.ts";
import { launchBrowser, runVariant } from "./harness.ts";
import { writeSheet } from "./sheet.ts";
import type { SheetEntry } from "./sheet.ts";
import { forcedConfig, resolveEngine } from "./shim.ts";
import type { EngineSpec } from "./shim.ts";
import { harnessDetail, protocolTimeoutFor } from "./steps.ts";

export interface CaptureOptions {
  slugs: string[];
  all?: boolean;
  langs?: SampleLocale[];
  check?: boolean;
  force?: boolean;
  sheet?: string;
  report?: string;
  headed?: boolean;
  concurrency?: number;
  refreshNet?: boolean;
  /** "npm" (default: the released version) or "npm@x.y.z". */
  engine?: string;
  /** Also write PNG copies of every page, card and OG image here, for reviewers. */
  previewDir?: string;
  /** Write only the Sandbox bundles, with the engine capture.json records. */
  sandboxOnly?: boolean;
  /** Write only `verified` records (#735): a recipe whose files would
   *  change is listed as needing a recapture, and fails the run. */
  verify?: boolean;
  /** The stress test (#869, C38): each edition is laid out again with its
   *  text this many times as long. Writes nothing. */
  stress?: number;
  /** With `stress`: write every page of the stretched edition, its
   *  stretched Markdown and its C38 findings to `<dir>/<slug>/<lang>/`
   *  (`--stress-out`, #915). */
  stressOut?: string;
  /** Compare every published page with the approved capture (C39). */
  compare?: boolean;
  /** C39's threshold: the largest mean difference of a cell, of 255. */
  maxDiff?: number;
  /** C39 compares the layout hash only (`--no-pixels`): pages painted on
   *  another system than the approved ones differ at every glyph edge. */
  pixels?: boolean;
  /** C39 warns, not fails, on a layout hash that differs (`--hash-warn`):
   *  a run on another system than the capture's. */
  hashWarn?: boolean;
  /** C39 fails on any engine, not only the one the capture records. */
  strict?: boolean;
  /** With no slugs: every recipe whose Markdown declares composed pages
   *  (the bench), stale or not. */
  composed?: boolean;
}

export interface CaptureResult {
  slug: string;
  variant: SampleLocale;
  ok: boolean;
  fails: { check: string; detail: string }[];
  warns: { check: string; severity: "warn" | "info"; detail: string }[];
  pages: number;
  totalMs: number;
  written: boolean;
  outDir: string;
  /** Pinned engine version the edition ran on. */
  engine?: string;
  /** Time of the build that is the result. */
  buildMs?: number;
  /** Bytes of the edition's images (PDF excluded). */
  bytes?: number;
  /** "unchanged", "check only", "not written: …". */
  note?: string;
}

interface Prepared {
  slug: string;
  meta: RecipeMeta;
  sourceHash: string;
  previous: CaptureManifest | null;
  variants: SampleLocale[];
  assets: string[];
}

/** One edition's outputs, in memory until the recipe is written. */
export interface Output {
  /** Null when the edition failed (its previews and sheet row still exist). */
  variant: CaptureVariant | null;
  files: Map<string, Buffer>;
  previews: Map<string, Buffer>;
  sheet: SheetEntry;
  /** The published pages that are not their committed images beyond
   *  rendering noise (#734); null when the run did not compare them. */
  pageChanges?: PageChange[] | null;
  /** The committed bundle, of other bytes than the run's, reads back as
   *  the pen's documents on the run's engine (#734). */
  committedBundleOk?: boolean;
}

const dim = (text: string) => styleText("dim", text, { stream: process.stderr });

/** A path the user typed, relative to where they ran pnpm. */
function userPath(file: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
}

export function readManifest(slug: string): CaptureManifest | null {
  const file = path.join(captureDir(slug), "capture.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CaptureManifest;
  } catch {
    return null;
  }
}

function prepare(slug: string, langs: readonly SampleLocale[]): Prepared {
  const meta = readRecipeMeta(slug);
  const locales = (meta.sample?.locales ?? []).filter((l) => SAMPLE_LOCALES.includes(l));
  return {
    slug,
    meta,
    sourceHash: sourceHash(slug, meta),
    previous: readManifest(slug),
    variants: locales.filter((l) => langs.includes(l)),
    assets: readRecipeSources(slug).assets,
  };
}

/** The recipes to capture: the named ones, --all, or the stale ones. A
 *  recipe that needs a newer postext than the engine the run pins (a draft
 *  previewing the next release) is reported instead of run. */
function selectRecipes(opts: CaptureOptions, langs: readonly SampleLocale[], engine: EngineSpec): { prepared: Prepared[]; broken: CaptureResult[] } {
  const known = listRecipeSlugs();
  for (const slug of opts.slugs) {
    if (!known.includes(slug)) throw new Error(`no recipe "${slug}" in cookbook/`);
  }
  const named = opts.slugs.length > 0;
  const prepared: Prepared[] = [];
  const broken: CaptureResult[] = [];
  for (const slug of named ? opts.slugs : known) {
    let task: Prepared;
    try {
      task = prepare(slug, langs);
    } catch (error) {
      broken.push(failed(slug, "en", "recipe", (error as Error).message));
      continue;
    }
    if (!named && task.meta.status === "retired") continue;
    if (!named && opts.composed) {
      if (!declaresComposedPages(readRecipeSources(slug).content)) continue;
    } else if (!named && !opts.all) {
      const prev = task.previous;
      const stale = !prev || prev.sourceHash !== task.sourceHash || task.variants.some((v) => !prev.variants?.[v]);
      if (!stale) continue;
    }
    if (engine.source === "npm" && compareSemVer(task.meta.engine.postext, engine.postext) > 0) {
      const why = `needs postext ${task.meta.engine.postext}; this run pins ${engine.postext}: preview it with --engine local until the release`;
      if (named) broken.push(failed(slug, task.variants[0] ?? "en", "engine", why));
      else process.stderr.write(dim(`  skipping ${slug}: ${why}\n`));
      continue;
    }
    if (task.variants.length) prepared.push(task);
  }
  return { prepared, broken };
}

function failed(slug: string, variant: SampleLocale, check: string, detail: string): CaptureResult {
  return {
    slug, variant, ok: false, fails: [{ check, detail }], warns: [], pages: 0, totalMs: 0, written: false,
    outDir: path.join(captureDir(slug), variant),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The bundle's file name inside an edition's folder. */
export const sandboxFile = (slug: string) => `${slug}.postext`;

/** The bundle's id and name: `recipe-<slug>` and the write-up's title in the
 *  edition's language (its summary as the description). */
function sandboxMeta(slug: string, variant: SampleLocale, meta: RecipeMeta): SandboxMeta {
  const file = path.join(recipeDir(slug), `${variant}.mdx`);
  const data = fs.existsSync(file) ? (matter(fs.readFileSync(file, "utf-8"), {}).data as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const folio = folioConfigOf(meta.folio);
  return {
    id: `recipe-${slug}`, name: text(data.title) || slug,
    ...(text(data.summary) ? { description: text(data.summary) } : {}),
    ...(folio ? { folio } : {}),
  };
}
/** capture.json's `sandbox` entry: the bundle, the folio it carries, and,
 *  when it holds only some of the published builds, which one the recipe
 *  kept (`capture.sandbox`) and how many pages it lays out to; then what
 *  `pnpm cookbook sandbox` compares the Sandbox's own layout with (#736):
 *  each chapter's pages, layout hash and lines hash as the bundle reads
 *  back, and the warnings of the pen's builds it holds. */
export function sandboxEntry(slug: string, bundle: Pick<SandboxBundle, "pages" | "allPages" | "readBack" | "penWarnings"> & { bytes: Buffer }, meta: Pick<RecipeMeta, "folio" | "capture">) {
  const folio = folioHash(meta.folio);
  const keep = meta.capture.sandbox;
  const back = bundle.readBack && !bundle.readBack.error && !bundle.readBack.skipped ? bundle.readBack : null;
  const chapters = (back?.chapters ?? []).map((c) => c.bundle).filter((c): c is { pages: number; hash: string; lines?: string } => !!c);
  return {
    file: sandboxFile(slug), bytes: bundle.bytes.length, ...(folio ? { folio } : {}),
    ...(keep !== undefined ? { keep } : {}),
    ...(bundle.pages && bundle.pages !== bundle.allPages ? { pages: bundle.pages } : {}),
    ...(chapters.length ? { chapters: chapters.map(({ pages, hash, lines }) => ({ pages, hash, ...(lines ? { lines } : {}) })) } : {}),
    ...(bundle.penWarnings.length ? { warnings: bundle.penWarnings } : {}),
  };
}

/** What a bundle's run reports: C33 and a missing bundle as failures, the
 *  builds left out unasked as a warning, what it cannot carry as notes. */
function sandboxFindings(sandbox: SandboxBundle | null | undefined): Finding[] {
  if (!sandbox) return [];
  const say = (severity: Finding["severity"]) => (detail: string): Finding => ({ check: "sandbox", severity, detail });
  return [
    ...(sandbox.error || !sandbox.bytes ? [say("fail")(`no .postext bundle: ${sandbox.error ?? "not written"}`)] : []),
    ...readBackFindings(sandbox.readBack),
    ...sandbox.warns.map(say("warn")),
    ...[...sandbox.notes, ...sandbox.warnings].map(say("info")),
  ];
}

/** The findings that are not failures, as capture.json keeps them. */
const kept = (findings: Finding[]) => findings
  .filter((f): f is Finding & { severity: "warn" | "info" } => f.severity !== "fail")
  .map(({ check, severity, detail }) => ({ check, severity, detail }));
const sha1 = (text: string) => crypto.createHash("sha1").update(text).digest("hex");

/** Turns a run into its checks and, when it passed, its outputs. */
function evaluate(
  task: Prepared,
  run: VariantRun,
  hb: HarnessBrowser,
  engine: EngineSpec,
  registry: Registry | null,
): { result: CaptureResult; output: Output | null } {
  const { meta, slug } = task;
  const facts = run.facts;
  const variant = run.variant;
  const files = new Map<string, Buffer>();
  const previews = new Map<string, Buffer>();
  const byN = new Map((facts?.pages ?? []).map((p) => [p.n, p]));
  for (const p of run.pages) {
    files.set(`p${pad(p.n)}.webp`, p.full);
    files.set(`p${pad(p.n)}.s.webp`, p.strip);
    if (p.png) previews.set(`p${pad(p.n)}.png`, p.png);
  }
  if (run.card) {
    files.set("card.webp", run.card.card);
    files.set("card.480.webp", run.card.card480);
    files.set("og.jpg", run.card.og);
    if (run.card.png) previews.set("card.png", run.card.png);
    if (run.card.ogPng) previews.set("og.png", run.card.ogPng);
  }
  const bytes = [...files.values()].reduce((sum, b) => sum + b.length, 0);
  const pdfBytes = run.pdf?.bytes ?? null;
  const pdfPages = pdfBytes ? pdfPageCount(pdfBytes) : null;
  if (pdfBytes) files.set(`${slug}.pdf`, pdfBytes);
  // The preview gets the PDF too: a local-engine run writes nothing else to look at.
  if (pdfBytes) previews.set(`${slug}.pdf`, pdfBytes);
  const bundle = run.sandbox?.bytes ?? null;
  if (bundle) files.set(sandboxFile(slug), bundle);
  const vdtHash = facts?.vdt ? sha1(facts.vdt) : "";
  const detected = facts && facts.selected >= 0 ? detect(meta, facts, run.pen, registry) : null;
  const previous = task.previous;
  const findings: Finding[] = runChecks({
    meta,
    facts,
    done: run.done,
    err: run.err,
    loaderErrors: run.loaderErrors,
    console: run.console,
    pageErrors: run.pageErrors,
    net: run.net,
    failedRequests: run.failedRequests,
    settleTimedOut: !!run.settle?.timedOut,
    kit: run.kit,
    tainted: run.tainted,
    passive: run.passive,
    workerEngines: run.workerEngines,
    engine: engine.postext,
    timeoutMs: meta.capture.timeoutMs ?? 60_000,
    totalMs: run.timings.runMs,
    pdf: run.pdf ? { ...run.pdf, bytes: pdfBytes?.length ?? 0, pages: pdfPages } : null,
    epubs: run.epubs,
    published: run.published,
    publishError: run.publishError,
    cardErrors: run.cardErrors,
    renderError: run.renderError,
    magnification: run.card?.magnification ?? null,
    bytes,
    cardBytes: run.card ? { card: run.card.card.length, card480: run.card.card480.length, og: run.card.og.length } : null,
    assets: task.assets,
    detected: detected ?? {
      apis: [], configKeys: [], configSections: [], configLeaves: 0, designElements: 0, directives: [], inline: [],
      resources: { svg: 0, bitmap: 0, table: 0 }, fonts: [], features: [], suggestedLevel: meta.level, paths: [],
    },
    registry,
    previous: previous
      ? { chrome: previous.chrome, vdtHash: previous.variants?.[variant]?.vdtHash, sourceHash: previous.sourceHash }
      : null,
    chrome: hb.chrome,
    vdtHash,
    sourceHash: task.sourceHash,
  });
  // The bundle: read back against the pen (C33), and what it leaves out.
  const bundled = sandboxFindings(run.sandbox);
  const fails = [...findings, ...bundled].filter((f) => f.severity === "fail").map(({ check, detail }) => ({ check, detail }));
  const warns = kept(findings);
  const selected = facts && facts.selected >= 0 ? facts.builds[facts.selected] : null;
  const result: CaptureResult = {
    slug,
    variant,
    ok: fails.length === 0,
    fails,
    warns,
    pages: facts?.pages?.length ?? 0,
    totalMs: run.timings.totalMs,
    written: false,
    outDir: path.join(captureDir(slug), variant),
    engine: engine.postext,
    buildMs: selected?.ms,
    bytes,
  };
  // Versos and rectos by book page number, which starts again with each
  // build of a capture that takes several (`capture.doc` as a list).
  const spreads = spreadsOf(run.published, new Map((facts?.pages ?? []).map((p) => [p.n, p.book])));
  const strips = run.pages.map((p) => p.strip);
  const pick = sidesOf(spreads.find(([a, b]) => a !== null && b !== null) ?? spreads[0] ?? [null, null], facts?.binding);
  const sheet: SheetEntry = {
    slug, variant, ok: result.ok, card: run.card?.card480 ?? null,
    spread: [pick[0] === null ? null : strips[pick[0]], pick[1] === null ? null : strips[pick[1]]],
  };
  // What the run found against the committed files (#734).
  const committedBack = run.sandbox?.committedReadBack ?? null;
  const compared = {
    pageChanges: run.pageChanges,
    committedBundleOk: !!committedBack && !committedBack.error && !committedBack.skipped
      && readBackFindings(committedBack).every((f) => f.severity !== "fail"),
  };
  if (!facts || !detected || !selected || !run.card || !result.ok) {
    return { result, output: { variant: null, files, previews, sheet, ...compared } };
  }
  const first = facts.builds[0];
  const specimen = facts.specimen!;
  const capture: CaptureVariant = {
    hash8: hash8(Buffer.concat([...files.values()])),
    vdtHash,
    timings: {
      importMs: Math.round(facts.importedAt),
      fontsMs: Math.round(Math.max(0, (first?.at ?? facts.importedAt) - facts.importedAt)),
      buildMs: Math.round(selected.ms),
      totalMs: run.timings.runMs,
      builds: facts.builds.length,
    },
    specimen: { ...specimen, ownLines: run.pen.ownLines },
    pages: run.pages.map((p) => {
      const info = byN.get(p.n);
      return {
        n: p.n,
        label: info?.label ?? String(p.n),
        role: info?.role ?? "body",
        w: p.w,
        h: p.h,
        file: `p${pad(p.n)}.webp`,
        strip: `p${pad(p.n)}.s.webp`,
        bytes: p.full.length,
        alt: info ? altText(info, variant) : "",
      };
    }),
    spreads,
    ...(facts.binding === "right" ? { binding: "right" as const } : {}),
    card: { file: "card.webp", file480: "card.480.webp", w: 960, h: 720, mode: meta.capture.card },
    og: { file: "og.jpg", w: 580, h: 622 },
    ...(pdfBytes ? { pdf: { file: `${slug}.pdf`, bytes: pdfBytes.length, pages: pdfPages ?? 0 } } : {}),
    ...(bundle ? { sandbox: sandboxEntry(slug, { ...run.sandbox!, bytes: bundle }, meta) } : {}),
    detected: {
      apis: detected.apis,
      configKeys: detected.configKeys,
      configSections: detected.configSections,
      configLeaves: detected.configLeaves,
      designElements: detected.designElements,
      directives: detected.directives,
      inline: detected.inline,
      resources: detected.resources,
      fonts: detected.fonts,
      features: detected.features,
      suggestedLevel: detected.suggestedLevel,
    },
    diagnostics: {
      converged: facts.converged !== false,
      iterationCount: facts.iterationCount ?? 0,
      looseLines: {
        count: facts.loose?.count ?? 0,
        share: Math.round((facts.loose?.share ?? 0) * 10000) / 10000,
        worst: facts.loose?.worst ?? 0,
      },
      ...(facts.cjkLoose?.total
        ? {
            cjkLooseLines: {
              count: facts.cjkLoose.count,
              share: Math.round(facts.cjkLoose.share * 10000) / 10000,
              worst: facts.cjkLoose.worst,
            },
          }
        : {}),
      ...(facts.raggedLines ? { raggedLines: { count: facts.raggedLines.count } } : {}),
      ...(facts.runtFixes?.count ? { runtFixes: { count: facts.runtFixes.count, tracked: facts.runtFixes.tracked, worst: facts.runtFixes.worst } } : {}),
      findings: warns,
    },
  };
  // What the bundle leaves out or cannot carry, after the checks' findings.
  result.warns.push(...kept(bundled));
  return { result, output: { variant: capture, files, previews, sheet, ...compared } };
}

function variantFilesExist(dir: string, v: CaptureVariant): boolean {
  const names = [
    ...v.pages.flatMap((p) => [p.file, p.strip]), v.card.file, v.card.file480, v.og.file,
    ...(v.pdf ? [v.pdf.file] : []), ...(v.sandbox ? [v.sandbox.file] : []),
  ];
  return names.every((name) => fs.existsSync(path.join(dir, name)));
}

/** True when a new run names the same files as the kept edition. */
function sameFiles(old: CaptureVariant, next: CaptureVariant): boolean {
  return old.pages.length === next.pages.length
    && old.pages.every((p, i) => p.n === next.pages[i].n && p.file === next.pages[i].file && p.strip === next.pages[i].strip)
    && !!old.pdf === !!next.pdf;
}

/** Writes `bytes` to `file` through a temporary file, unless they are there already. */
function writeIfChanged(file: string, bytes: Buffer): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return false;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  return true;
}

/** The manifest minus what a rewrite always changes. */
const manifestKey = (m: CaptureManifest | null) => (m ? JSON.stringify({ ...m, capturedAt: "" }) : "");

// ─── What a run writes (#734, #735) ─────────────────────────────────────────

/** The kinds of file an edition holds, each judged on its own. */
export type FileKind = "images" | "pdf" | "bundle";

/** What one captured edition needs written, and why. */
export interface EditionPlan {
  locale: SampleLocale;
  /** The kinds whose files the run writes. */
  write: Set<FileKind>;
  /** Why, in the words `--verify` prints: "layout hash", "pixels (p03:
   *  worst cell 36.2 of 255, …)", "PDF", "bundle", "sources", "new edition". */
  reasons: string[];
  /** Nothing committed to keep: the edition's folder is written anew. */
  fresh: boolean;
  /** The committed bundle stays although its bytes are not the run's: it
   *  reads back as the pen's documents on the run's engine. */
  bundleRead: boolean;
}

const KINDS: readonly FileKind[] = ["images", "pdf", "bundle"];

/** The files of one kind in an edition's outputs. */
function kindOf(slug: string, name: string): FileKind {
  if (name === sandboxFile(slug)) return "bundle";
  return name === `${slug}.pdf` ? "pdf" : "images";
}

/**
 * What a passed edition writes. With other sources, no committed edition,
 * a missing file or --force: everything. With another layout hash or other
 * file names: everything too (the PDF and the bundle are of that layout).
 * Otherwise each kind on its own: the images when a page differs from its
 * committed image beyond rendering noise, the PDF when its bytes differ,
 * the bundle when its bytes differ and, the run being on another engine
 * than the recorded one, the committed bundle does not read back as the
 * pen's documents (on the recorded engine a bundle of other bytes follows
 * the tooling, as it always did).
 */
export function planEdition(
  slug: string,
  locale: SampleLocale,
  output: Output,
  dir: string,
  prev: CaptureManifest | null,
  context: { sourceHash: string; engine: string; force: boolean },
): EditionPlan {
  const next = output.variant!;
  const all = (reason: string): EditionPlan => ({
    locale, reasons: [reason], fresh: true, bundleRead: false,
    write: new Set(KINDS.filter((kind) => [...output.files.keys()].some((name) => kindOf(slug, name) === kind))),
  });
  const old = prev?.variants?.[locale];
  if (context.force) return all("--force");
  if (!prev) return all("no capture");
  if (prev.sourceHash !== context.sourceHash) return all("sources");
  if (!old) return all("new edition");
  if (!variantFilesExist(dir, old)) return all("a committed file is missing");
  if (old.vdtHash !== next.vdtHash) return all("layout hash");
  if (!sameFiles(old, next)) return all("pages published");

  const write = new Set<FileKind>();
  const reasons: string[] = [];
  const onDisk = (name: string) => fs.readFileSync(path.join(dir, name));
  // Pages, card and OG image: they follow the pages they are made from.
  const changes = output.pageChanges
    ?? next.pages.filter((p) => !onDisk(p.file).equals(output.files.get(p.file)!)).map((p) => ({ n: p.n, detail: "other bytes, not compared" }));
  if (changes.length) {
    write.add("images");
    const first = changes[0]!;
    reasons.push(`pixels (p${pad(first.n)}: ${first.detail}${changes.length > 1 ? `, and ${changes.length - 1} more page${changes.length > 2 ? "s" : ""}` : ""})`);
  }
  const pdf = output.files.get(`${slug}.pdf`);
  if (pdf && !onDisk(`${slug}.pdf`).equals(pdf)) {
    write.add("pdf");
    reasons.push("PDF");
  }
  const bundle = output.files.get(sandboxFile(slug));
  let bundleRead = false;
  if (bundle) {
    const file = path.join(dir, sandboxFile(slug));
    const committed = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!committed?.equals(bundle)) {
      bundleRead = !!committed && prev.engine?.postext !== context.engine && output.committedBundleOk === true;
      if (!bundleRead) {
        write.add("bundle");
        reasons.push("bundle");
      }
    }
  }
  return { locale, write, reasons, fresh: false, bundleRead };
}

/** capture.json's entry of a planned edition. What describes a kept file
 *  (its sizes and bytes) stays the committed entry's; `hash8` and the
 *  timings change only when a file of the edition is written (the timings
 *  vary run to run and would rewrite capture.json every time); the rest
 *  (detection, diagnostics, alt text, spreads) comes from the new run. */
function plannedVariant(slug: string, plan: EditionPlan, output: Output, old: CaptureVariant | undefined, dir: string): CaptureVariant {
  const next = output.variant!;
  if (plan.fresh || !old) return next;
  const images = plan.write.has("images");
  const merged: CaptureVariant = {
    ...next,
    ...(images ? {} : {
      pages: next.pages.map((p, i) => ({ ...p, w: old.pages[i].w, h: old.pages[i].h, bytes: old.pages[i].bytes })),
      card: old.card.mode === next.card.mode ? old.card : next.card,
      og: old.og,
    }),
    ...(old.pdf && !plan.write.has("pdf") ? { pdf: old.pdf } : {}),
    ...(plan.bundleRead && old.sandbox ? { sandbox: old.sandbox } : {}),
  };
  if (!plan.write.size) return { ...merged, hash8: old.hash8, timings: old.timings };
  // The hash of the files as the folder will hold them.
  const bytes = [...output.files].map(([name, fresh]) => (plan.write.has(kindOf(slug, name)) ? fresh : fs.readFileSync(path.join(dir, name))));
  return { ...merged, hash8: hash8(Buffer.concat(bytes)) };
}

/** `verified` written into capture.json's text, after `capturedAt`: no
 *  other byte of the file changes (#735). */
export function withVerified(text: string, verified: NonNullable<CaptureManifest["verified"]>): string {
  const block = JSON.stringify(verified, null, 2).replace(/\n/g, "\n  ");
  const had = /\n {2}"verified": \{[^}]*\},?(?=\n)/;
  if (had.test(text)) return text.replace(had, `\n  "verified": ${block},`);
  const at = /\n {2}"capturedAt": "[^"\n]*",(?=\n)/.exec(text);
  if (at) return `${text.slice(0, at.index + at[0].length)}\n  "verified": ${block},${text.slice(at.index + at[0].length)}`;
  // A file some other tool formatted: written again whole.
  const { schemaVersion, slug, sourceHash: hash, engine, chrome, capturedAt, variants, ...rest } = JSON.parse(text) as CaptureManifest;
  return `${JSON.stringify({ schemaVersion, slug, sourceHash: hash, engine, chrome, capturedAt, verified, ...rest, variants }, null, 2)}\n`;
}

/** What `writeRecipe` did, or would do under `verifyOnly`. */
export interface WriteOutcome {
  /** The kinds written per edition (an edition absent wrote nothing). */
  written: Map<SampleLocale, Set<FileKind>>;
  dropped: SampleLocale[];
  /** Only capture.json changed: what describes the files, on the engine
   *  that wrote them. */
  manifestOnly: boolean;
  /** `verified` was recorded for this release (#735). */
  verified: string | null;
  /** Under `verifyOnly`: why the recipe needs a recapture, per edition. */
  needs: { locale: SampleLocale; reasons: string[] }[];
}

/**
 * Writes a recipe's captures atomically: the files each edition's plan
 * names ({@link planEdition}), the editions dropped as stale, or
 * capture.json alone. `verifyOnly` (#735) writes nothing but a `verified`
 * record, and reports the plans that would write a file. `root` is the
 * recipe's capture folder (a test's stand-in for it).
 */
export function writeRecipe(
  task: Pick<Prepared, "slug" | "meta" | "sourceHash" | "previous">,
  outputs: Map<SampleLocale, Output>,
  engine: EngineSpec,
  chrome: string,
  { force = false, verifyOnly = false, root = captureDir(task.slug), now = () => new Date() }: { force?: boolean; verifyOnly?: boolean; root?: string; now?: () => Date } = {},
): WriteOutcome {
  const finalDir = root;
  const prev = task.previous;
  const context = { sourceHash: task.sourceHash, engine: engine.postext, force };
  const plans = new Map<SampleLocale, EditionPlan>();
  for (const [locale, output] of outputs) {
    if (output.variant) plans.set(locale, planEdition(task.slug, locale, output, path.join(finalDir, locale), prev, context));
  }
  const writes = [...plans.values()].some((plan) => plan.write.size > 0);
  const sameSources = !!prev && prev.sourceHash === task.sourceHash;
  const sameEngine = sameSources && prev.engine?.postext === engine.postext;

  // Editions not captured this run survive only when their inputs did not
  // change and the manifest goes on naming the engine that pictured them.
  const sampled = new Set(task.meta.sample.locales);
  const uncaptured = SAMPLE_LOCALES.filter((locale) => prev?.variants?.[locale] && !outputs.has(locale));
  const survives = (locale: SampleLocale) => sameSources && (sameEngine || !writes) && sampled.has(locale)
    && variantFilesExist(path.join(finalDir, locale), prev!.variants[locale]!);
  const dropped = uncaptured.filter((locale) => !survives(locale));

  const outcome: WriteOutcome = { written: new Map(), dropped: [], manifestOnly: false, verified: null, needs: [] };
  const needs = [...plans.values()].filter((plan) => plan.write.size > 0).map((plan) => ({ locale: plan.locale, reasons: plan.reasons }));
  if (verifyOnly && (needs.length || dropped.length)) {
    outcome.needs = [...needs, ...dropped.map((locale) => ({ locale, reasons: ["its capture is of other inputs"] }))];
    return outcome;
  }

  const usesPdf = task.meta.outputs.includes("pdf") || !!task.meta.downloads?.pdf || !!task.meta.engine.postextPdf;
  const released = { postext: engine.postext as SemVer, ...(usesPdf ? { postextPdf: engine.postextPdf as SemVer } : {}) };
  const file = path.join(finalDir, "capture.json");

  if (!writes && !dropped.length && prev) {
    // No file of the recipe changed. On another release than the recorded
    // one the folder stays as it is, and a newer release is recorded as
    // the one the recipe was last verified on (#735): a run that did not
    // take every edition of the recipe proves nothing of the others.
    if (!sameEngine) {
      const whole = SAMPLE_LOCALES.every((locale) => !prev.variants[locale] || plans.has(locale));
      const newer = compareSemVer(engine.postext, prev.verified?.postext ?? prev.engine.postext) > 0;
      if (whole && newer && engine.source === "npm") {
        const verified = { ...released, chrome, at: now().toISOString() };
        const tmpFile = `${file}.tmp-${process.pid}`;
        fs.writeFileSync(tmpFile, withVerified(fs.readFileSync(file, "utf-8"), verified));
        fs.renameSync(tmpFile, file);
        outcome.verified = engine.postext;
      }
      return outcome;
    }
    if (verifyOnly) return outcome;
    // On the recorded engine: capture.json alone, when the tooling changed
    // what describes the files (capturedAt and chrome stay: they are the
    // run's that made the images).
    const variants: Partial<Record<SampleLocale, CaptureVariant>> = {};
    for (const locale of SAMPLE_LOCALES) {
      const plan = plans.get(locale);
      if (plan) variants[locale] = plannedVariant(task.slug, plan, outputs.get(locale)!, prev.variants[locale], path.join(finalDir, locale));
      else if (prev.variants[locale]) variants[locale] = prev.variants[locale];
    }
    const manifest: CaptureManifest = {
      schemaVersion: 1, slug: task.slug, sourceHash: task.sourceHash, engine: prev.engine, chrome: prev.chrome, capturedAt: prev.capturedAt,
      ...(prev.verified ? { verified: prev.verified } : {}),
      variants,
    };
    if (manifestKey(manifest) === manifestKey(prev)) return outcome;
    const tmpFile = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmpFile, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(tmpFile, file);
    outcome.manifestOnly = true;
    return outcome;
  }
  if (verifyOnly) {
    // No capture to verify.
    outcome.needs = [...plans.keys()].map((locale) => ({ locale, reasons: ["no capture"] }));
    return outcome;
  }

  // A file is written: the manifest names this run, and `verified` goes
  // (the files say it themselves).
  const variants: Partial<Record<SampleLocale, CaptureVariant>> = {};
  for (const locale of SAMPLE_LOCALES) {
    const plan = plans.get(locale);
    if (plan) variants[locale] = plannedVariant(task.slug, plan, outputs.get(locale)!, prev?.variants?.[locale], path.join(finalDir, locale));
    else if (prev?.variants?.[locale] && !dropped.includes(locale)) variants[locale] = prev.variants[locale];
  }
  const manifest: CaptureManifest = {
    schemaVersion: 1,
    slug: task.slug,
    sourceHash: task.sourceHash,
    engine: { ...released, source: "npm" },
    chrome,
    capturedAt: now().toISOString(),
    variants,
  };

  const tmpRoot = path.join(WEB_DIR, ".cache", "cookbook-tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(tmpRoot, `${task.slug}-`));
  const old = `${finalDir}.old-${process.pid}`;
  try {
    for (const locale of SAMPLE_LOCALES) {
      if (!variants[locale]) continue;
      const plan = plans.get(locale);
      const dir = path.join(tmp, locale);
      // What stays is copied as it is; a fresh edition starts empty, so no
      // page of an earlier, longer capture lingers.
      if (!plan?.fresh) fs.cpSync(path.join(finalDir, locale), dir, { recursive: true, preserveTimestamps: true });
      else fs.mkdirSync(dir, { recursive: true });
      if (!plan) continue;
      for (const [name, bytes] of outputs.get(locale)!.files) {
        if (plan.write.has(kindOf(task.slug, name))) fs.writeFileSync(path.join(dir, name), bytes);
      }
      if (plan.write.size) outcome.written.set(locale, plan.write);
    }
    fs.writeFileSync(path.join(tmp, "capture.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    if (fs.existsSync(finalDir)) fs.renameSync(finalDir, old);
    fs.renameSync(tmp, finalDir);
    fs.rmSync(old, { recursive: true, force: true });
  } catch (error) {
    // Put the published capture back if the swap failed half-way.
    if (!fs.existsSync(finalDir) && fs.existsSync(old)) fs.renameSync(old, finalDir);
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  outcome.dropped = dropped;
  return outcome;
}

/** "PDF written, images and bundle kept". */
function writtenNote(kinds: Set<FileKind>, variant: CaptureVariant | null): string {
  const name: Record<FileKind, string> = { images: "images", pdf: "PDF", bundle: "bundle" };
  const has = KINDS.filter((kind) => kind === "images" || (kind === "pdf" ? !!variant?.pdf : !!variant?.sandbox));
  const kept = has.filter((kind) => !kinds.has(kind));
  return kept.length ? `${[...kinds].map((k) => name[k]).join(" and ")} written, ${kept.map((k) => name[k]).join(" and ")} kept` : "";
}

/** A wait of the harness that ended on its timer (#743), on stderr: the
 *  capture goes on, and whoever reads the run sees which edition it was. */
function sayFallbacks(run: VariantRun): void {
  for (const what of run.fallbacks) process.stderr.write(dim(`  ${run.slug} ${run.variant}: ${what}\n`));
}

/** Runs `jobs` with at most `limit` in flight. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, worker));
  return results;
}

/**
 * A run with a forced configuration (`COOKBOOK_FORCE_CONFIG`, shim.ts)
 * lays the recipes out as no reader's pen does: it checks, and says so on
 * its first line; asked to write a capture or a bundle, it stops.
 */
function announceForcedConfig(writes: boolean): void {
  const force = forcedConfig();
  if (!force) return;
  if (writes) throw new Error("COOKBOOK_FORCE_CONFIG is set: a forced configuration is never captured, run with --check (or unset it)");
  process.stderr.write(styleText("yellow", `  configuration forced on every build (COOKBOOK_FORCE_CONFIG): ${JSON.stringify(force)}\n`, { stream: process.stderr }));
}

export async function runCapture(opts: CaptureOptions): Promise<CaptureResult[]> {
  announceForcedConfig(!opts.check);
  const engine = resolveEngine(opts.engine ?? "npm");
  const langs = opts.langs?.length ? opts.langs : SAMPLE_LOCALES;
  const { prepared, broken } = selectRecipes(opts, langs, engine);
  const results: CaptureResult[] = [...broken];
  if (!prepared.length) {
    if (opts.report) writeReport(opts.report, results, engine, null);
    return results;
  }
  let registry: Registry | null = null;
  try {
    registry = loadRegistry();
  } catch {
    registry = null;   // C27 needs the feature registry; without it the check is skipped
  }

  const hb = await launchBrowser({ headed: opts.headed, protocolTimeout: protocolTimeoutFor(prepared.map((task) => task.meta.capture.timeoutMs)) });
  const sheetEntries: SheetEntry[] = [];
  try {
    const jobs = prepared.flatMap((task) =>
      task.variants.map((variant) => async () => {
        process.stderr.write(dim(`  capturing ${task.slug} ${variant} · postext ${engine.postext}\n`));
        try {
          // The committed edition to compare with, when it is of these sources.
          const committed = !opts.force && task.previous?.sourceHash === task.sourceHash && task.previous.variants?.[variant]
            ? path.join(captureDir(task.slug), variant) : undefined;
          const run = await runVariant({
            hb, slug: task.slug, variant, meta: task.meta, engine: opts.engine, refreshNet: opts.refreshNet, png: !!opts.previewDir,
            sandbox: sandboxMeta(task.slug, variant, task.meta),
            ...(committed ? { committedDir: committed } : {}),
            ...(opts.maxDiff !== undefined ? { maxDiff: opts.maxDiff } : {}),
          });
          sayFallbacks(run);
          const evaluated = evaluate(task, run, hb, engine, registry);
          const bench = [
            ...(opts.compare
              ? compareFindings({
                  approved: committed ? { vdtHash: task.previous?.variants?.[variant]?.vdtHash, engine: task.previous?.engine?.postext } : null,
                  run: { vdtHash: run.facts?.vdt ? sha1(run.facts.vdt) : "", engine: engine.postext },
                  changes: run.pageChanges, pages: run.pages.length, maxDiff: opts.maxDiff ?? PAGE_MAX_DIFF,
                  pixels: opts.pixels !== false, strict: !!opts.strict, hashWarn: !!opts.hashWarn,
                })
              : []),
            ...(opts.stress ? await stressRun(task, variant, run, hb, opts) : []),
          ];
          addFindings(evaluated.result, bench);
          return { task, variant, ...evaluated };
        } catch (error) {
          return { task, variant, result: failed(task.slug, variant, "harness", harnessDetail(error)), output: null };
        }
      }),
    );
    const done = await pool(jobs, opts.concurrency ?? 3);

    for (const task of prepared) {
      const mine = done.filter((d) => d.task === task);
      const outputs = new Map<SampleLocale, Output>();
      for (const d of mine) {
        if (d.output) sheetEntries.push(d.output.sheet);
        // Previews are written even for a failed edition: they show what failed.
        if (opts.previewDir && d.output) {
          const dir = path.join(userPath(opts.previewDir), task.slug, d.variant);
          fs.mkdirSync(dir, { recursive: true });
          // An earlier, longer run's pages would linger among the new ones.
          for (const name of fs.readdirSync(dir)) if (/^(p\d+|card|og)\.png$|\.pdf$/.test(name)) fs.rmSync(path.join(dir, name));
          for (const [name, bytes] of d.output.previews) fs.writeFileSync(path.join(dir, name), bytes);
          // What capture.json would record for the edition (a local-engine
          // preview writes no capture): diagnostics, detection, binding.
          if (d.output.variant) fs.writeFileSync(path.join(dir, "capture.json"), `${JSON.stringify(d.output.variant, null, 2)}\n`);
          else fs.rmSync(path.join(dir, "capture.json"), { force: true });
        }
        if (d.result.ok && d.output?.variant) outputs.set(d.variant, d.output);
      }
      const allOk = mine.every((d) => d.result.ok);
      if (!allOk) {
        for (const d of mine) d.result.note = d.result.ok ? "not written: another edition failed" : "not written";
      } else if (opts.check || engine.source === "local") {
        // A published capture comes from npm: the local engine only previews.
        for (const d of mine) d.result.note = engine.source === "local" ? "local engine: check only" : "check only";
      } else {
        const outcome = writeRecipe(task, outputs, engine, hb.chrome, { force: !!opts.force, verifyOnly: !!opts.verify });
        for (const d of mine) {
          const kinds = outcome.written.get(d.variant);
          d.result.written = !!kinds;
          const needs = outcome.needs.find((n) => n.locale === d.variant);
          if (needs) {
            // --verify: the files would change, and it writes none.
            d.result.ok = false;
            d.result.fails.push({ check: "verify", detail: `needs a recapture: ${needs.reasons.join(", ")}` });
            d.result.note = "not written";
          } else if (outcome.needs.length) d.result.note = "not verified: another edition needs a recapture";
          else if (kinds) d.result.note = writtenNote(kinds, d.output?.variant ?? null) || undefined;
          else if (outcome.verified) d.result.note = `unchanged, verified on ${outcome.verified}`;
          else d.result.note = outcome.manifestOnly ? "images unchanged, capture.json updated" : "unchanged";
        }
        if (outcome.dropped.length) {
          process.stderr.write(styleText("yellow", `  ${task.slug}: removed the earlier ${outcome.dropped.join(", ")} capture, whose inputs changed; capture it again with --lang ${outcome.dropped.join(",")}\n`, { stream: process.stderr }));
        }
      }
      results.push(...mine.map((d) => d.result));
    }

    if (opts.sheet && sheetEntries.length) {
      const sheet = await writeSheet(hb.browser, sheetEntries, userPath(opts.sheet));
      process.stderr.write(dim(`  contact sheet: ${sheet.file} (${Math.round(sheet.bytes / 1024)} KB)\n`));
    }
  } finally {
    await hb.browser.close().catch(() => {});
  }
  if (opts.report) writeReport(opts.report, results, engine, hb.chrome);
  return results;
}

// ─── The composed-page bench (#869) ─────────────────────────────────────────

/** lib/probe.js `PAGE_DIFFERENCE.max`: C39's threshold by default. */
export const PAGE_MAX_DIFF = 12;

/** Findings of the bench added to an edition's result: a failure makes it fail. */
function addFindings(result: CaptureResult, findings: Finding[]): void {
  for (const f of findings) {
    if (f.severity === "fail") result.fails.push({ check: f.check, detail: f.detail });
    else result.warns.push({ check: f.check, severity: f.severity, detail: f.detail });
  }
  result.ok = result.fails.length === 0;
}

/** C38: the edition once more, its text `opts.stress` times as long, facts only. */
async function stressRun(task: Prepared, variant: SampleLocale, base: VariantRun, hb: HarnessBrowser, opts: CaptureOptions): Promise<Finding[]> {
  const factor = opts.stress!;
  const content = readRecipeSources(task.slug).content;
  const stretch = stretchedEdition(content, variant, task.meta.sample.locales[0] ?? variant, factor);
  process.stderr.write(dim(`  stretching ${task.slug} ${variant} · text × ${factor}\n`));
  const stretched = new Map<string, string>();
  try {
    const run = await runVariant({
      hb, slug: task.slug, variant, meta: task.meta, engine: opts.engine, refreshNet: opts.refreshNet,
      ...(opts.stressOut ? { pagesOnly: true } : { factsOnly: true }),
      transformContent: (text, key) => {
        const out = stretchMarkdown(text, factor).markdown;
        stretched.set(key, out);
        return out;
      },
    });
    sayFallbacks(run);
    const findings = stressFindings({
      meta: task.meta, factor, stretch, done: run.done, err: run.err, pageErrors: run.pageErrors, facts: run.facts, base: base.facts,
    });
    if (opts.stressOut) writeStressOut(path.join(userPath(opts.stressOut), task.slug, variant), run, stretched, factor, findings);
    return findings;
  } catch (error) {
    return [{ check: "C38", severity: "fail", detail: `the stretched edition: ${harnessDetail(error)}` }];
  }
}

/** `--stress-out` (#915): the stretched edition's pages (`p01.png`…), the
 *  Markdown it was laid out from (`<key>.stretched.md`) and its C38
 *  findings (`stress.json`), an earlier run's pages removed first. */
function writeStressOut(dir: string, run: VariantRun, stretched: ReadonlyMap<string, string>, factor: number, findings: Finding[]): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) if (/^p\d+\.png$|\.stretched\.md$/.test(name)) fs.rmSync(path.join(dir, name));
  for (const p of run.pages) if (p.png) fs.writeFileSync(path.join(dir, `p${pad(p.n)}.png`), p.png);
  // The edition's own files (`en`, `notes.en`), else every file it was given.
  const own = [...stretched.keys()].filter((key) => key.split(".").pop() === path.basename(dir));
  for (const [key, text] of stretched) {
    if (own.length && !own.includes(key)) continue;
    fs.writeFileSync(path.join(dir, `${key.replace(/[^\w.-]+/g, "_")}.stretched.md`), text);
  }
  const record = { factor, pages: run.pages.length, renderError: run.renderError ?? null, findings };
  fs.writeFileSync(path.join(dir, "stress.json"), `${JSON.stringify(record, null, 2)}\n`);
  process.stderr.write(dim(`  stretched pages: ${dir} (${run.pages.length})\n`));
}

// ─── --sandbox-only ─────────────────────────────────────────────────────────

/**
 * Writes the Sandbox bundles of recipes already captured, without touching
 * their pictures: each edition runs again on the engine its capture.json
 * records, and only `<variant>/<slug>.postext`, the edition's `sandbox`
 * entry in capture.json and the bundle's own findings there (`sandbox`,
 * C33) are written (capturedAt stays). A capture whose
 * sources changed since is refused: capture it again instead. The run's
 * VDT hash is compared with the recorded one, so a bundle of another
 * layout than the published pages shows up as a warning.
 */
export async function runSandboxOnly(opts: CaptureOptions): Promise<CaptureResult[]> {
  announceForcedConfig(true);
  const langs = opts.langs?.length ? opts.langs : SAMPLE_LOCALES;
  const slugs = opts.slugs.length ? opts.slugs : listRecipeSlugs();
  const results: CaptureResult[] = [];
  const tasks: { slug: string; meta: RecipeMeta; manifest: CaptureManifest; variants: SampleLocale[] }[] = [];
  for (const slug of slugs) {
    let meta: RecipeMeta;
    try {
      meta = readRecipeMeta(slug);
    } catch (error) {
      results.push(failed(slug, "en", "recipe", (error as Error).message));
      continue;
    }
    if (!opts.slugs.length && meta.status === "retired") continue;
    const manifest = readManifest(slug);
    if (!manifest) {
      results.push(failed(slug, meta.sample.locales[0] ?? "en", "sandbox", "no capture.json: capture the recipe first"));
      continue;
    }
    if (manifest.sourceHash !== sourceHash(slug, meta)) {
      results.push(failed(slug, meta.sample.locales[0] ?? "en", "sandbox", "the recipe changed since its capture: capture it again, which writes the bundle too"));
      continue;
    }
    const variants = SAMPLE_LOCALES.filter((l) => manifest.variants[l] && langs.includes(l));
    if (variants.length) tasks.push({ slug, meta, manifest, variants });
  }
  if (!tasks.length) return results;

  const hb = await launchBrowser({ headed: opts.headed, protocolTimeout: protocolTimeoutFor(tasks.map((task) => task.meta.capture.timeoutMs)) });
  try {
    const jobs = tasks.flatMap((task) => task.variants.map((variant) => async () => {
      const old = task.manifest.variants[variant]!;
      const engine = `npm@${task.manifest.engine.postext}`;
      const dir = path.join(captureDir(task.slug), variant);
      const card = path.join(dir, old.card.file480);
      const result: CaptureResult = {
        slug: task.slug, variant, ok: false, fails: [], warns: [], pages: old.pages.length, totalMs: 0, written: false,
        outDir: dir, engine: task.manifest.engine.postext,
      };
      process.stderr.write(dim(`  bundling ${task.slug} ${variant} · postext ${task.manifest.engine.postext}
`));
      let bytes: Buffer | null = null;
      let sandbox: SandboxBundle | null = null;
      let findings: CaptureVariant["diagnostics"]["findings"] = [];
      try {
        const run = await runVariant({
          hb, slug: task.slug, variant, meta: task.meta, engine, refreshNet: opts.refreshNet, sandboxOnly: true,
          sandbox: { ...sandboxMeta(task.slug, variant, task.meta), thumbnail: fs.existsSync(card) ? fs.readFileSync(card) : null },
        });
        result.totalMs = run.timings.totalMs;
        sayFallbacks(run);
        if (run.done !== "ok") result.fails.push({ check: "run", detail: run.done === "error" ? `the pen failed: ${run.err ?? ""}` : "the pen timed out" });
        if (run.pageErrors.length) result.fails.push({ check: "run", detail: `page errors: ${run.pageErrors.slice(0, 3).join(" · ")}` });
        if (!run.facts || run.facts.selected < 0) result.fails.push({ check: "run", detail: "no build recorded" });
        const vdtHash = run.facts?.vdt ? sha1(run.facts.vdt) : "";
        if (vdtHash && vdtHash !== old.vdtHash) {
          result.warns.push({ check: "vdt", severity: "warn", detail: "the layout differs from the published pages (fonts or network?)" });
        }
        const bundled = sandboxFindings(run.sandbox ?? { bytes: null, error: "not written", warnings: [], notes: [], warns: [], penWarnings: [], pages: 0, allPages: 0, readBack: null, committedReadBack: null });
        result.fails.push(...bundled.filter((f) => f.severity === "fail").map(({ check, detail }) => ({ check, detail })));
        findings = kept(bundled);
        result.warns.push(...findings);
        sandbox = run.sandbox;
        bytes = run.sandbox?.bytes ?? null;
        result.bytes = bytes?.length;
      } catch (error) {
        result.fails.push({ check: "harness", detail: harnessDetail(error) });
      }
      result.ok = result.fails.length === 0;
      return { task, variant, result, bytes, sandbox, findings };
    }));
    const done = await pool(jobs, opts.concurrency ?? 3);

    for (const task of tasks) {
      const mine = done.filter((d) => d.task === task);
      results.push(...mine.map((d) => d.result));
      if (!mine.every((d) => d.result.ok)) {
        for (const d of mine) d.result.note = d.result.ok ? "not written: another edition failed" : "not written";
        continue;
      }
      if (opts.check) {
        for (const d of mine) d.result.note = "check only";
        continue;
      }
      // Re-read capture.json: only the `sandbox` entries and the bundle's
      // own findings change.
      const manifest = readManifest(task.slug)!;
      for (const d of mine) {
        const file = sandboxFile(task.slug);
        d.result.written = writeIfChanged(path.join(captureDir(task.slug), d.variant, file), d.bytes!);
        // Where a fresh capture puts them: the entry after the PDF, before
        // `detected`; the findings after the checks' own.
        const { detected, diagnostics, ...head } = manifest.variants[d.variant]!;
        const others = diagnostics.findings.filter((f) => f.check !== "sandbox" && f.check !== "C33");
        manifest.variants[d.variant] = {
          ...head, sandbox: sandboxEntry(task.slug, { ...d.sandbox!, bytes: d.bytes! }, task.meta), detected,
          diagnostics: { ...diagnostics, findings: [...others, ...d.findings] },
        };
        if (!d.result.written) d.result.note = "unchanged";
      }
      // A bundle written again is not the one a later release read back (#735).
      if (mine.some((d) => d.result.written)) delete manifest.verified;
      const target = path.join(captureDir(task.slug), "capture.json");
      if (writeIfChanged(target, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))) {
        for (const d of mine) if (!d.result.written) d.result.note = "bundle unchanged, capture.json updated";
      }
    }
  } finally {
    await hb.browser.close().catch(() => {});
  }
  return results;
}

function writeReport(file: string, results: CaptureResult[], engine: EngineSpec, chrome: string | null): void {
  const out = userPath(file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const report = { engine: { postext: engine.postext, postextPdf: engine.postextPdf, source: engine.source }, chrome, results };
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
}
