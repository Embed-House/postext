/**
 * `pnpm cookbook sandbox [slug…]`: every recipe bundle through the Sandbox's
 * own font and layout path, against what capture.json records (#736).
 *
 * Check C33 reads a bundle back on the pen's engine with the pen's fonts.
 * It runs no Sandbox code: the Sandbox takes its faces from Google Fonts
 * and Fontsource by family name and sends them to a layout worker, and
 * four defects of 1.25 and 1.26 sat on that path with every capture check
 * green (#688, #689, #690, #691). Each showed as a warning the Sandbox
 * raised and the pen did not.
 *
 *   no --site   the working tree: the Sandbox package's headless entry
 *               (`src/headless/layOutBundle.ts`) and its layout worker are
 *               built with bun and run in a page of the capture's own
 *               static server, the network through the capture's cache
 *   --site URL  a deployed site: `/<lang>/sandbox#recipe=<slug>&lang=<lang>`
 *               in a browser context of its own, the layout worker's
 *               `built` messages read from the page. Also fails when the
 *               page fetched another edition's bundle (#737)
 *
 * An edition fails when its bundle does not open or lay out, when the
 * worker or the page reports an error, when nothing comes within the
 * timeout, or when the Sandbox raises a warning that is not in
 * `sandbox.warnings`. A chapter count, a page count or (on the engine
 * capture.json records) lines other than `sandbox.chapters` fail with
 * --strict and warn without it: a pull request that moves lines on purpose
 * cannot capture the recipe again before its release.
 *
 * The lines, not the layout hash: up to #757 the Sandbox did not measure
 * with the files a pen measures with. The kit loads the static cuts
 * Fontsource serves; the Sandbox's loader took Google's variable file,
 * whose advances between the masters are not rounded to the font's units.
 * A line of body text came out a few hundredths to a few tenths of a pixel
 * wider or narrower (an edition's widest difference: 0.11 px in the median
 * one, 2.3 px in the worst), and the layout hash rounds every box to half
 * a pixel. On the 334 editions captured on 1.28.1: 134 with another layout
 * hash, 127 of them with every line the same and widths apart, 7 with two
 * to eight lines broken at another word. Since #757 the loader declares
 * the static cuts, in the kit's order, and the 334 come back with the
 * recorded layout hash; a family it still takes from Google's style sheet
 * (one Fontsource has no files for, a weight between two cuts) may differ
 * again. The lines hash (`linesHash` in lib/probe.js) holds no box, so it
 * tells a line broken elsewhere from one set to another width; a layout
 * hash that differs under the same lines is a note.
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { styleText } from "node:util";
import type { Browser, Page } from "puppeteer-core";
import { htmlLang } from "../../src/i18n/locales.ts";
import { captureDir, REPO_DIR, WEB_DIR } from "../../src/lib/cookbook/paths.ts";
import { listRecipeSlugs, readRecipeMeta } from "../../src/lib/cookbook/sources.ts";
import type { CaptureManifest, CaptureVariant, SampleLocale } from "../../src/lib/cookbook/types.ts";
import { SAMPLE_LOCALES } from "../../src/lib/cookbook/types.ts";
import { UsageError, flag, int, list, parseArgs, str, userPath } from "./args.ts";
import type { CaptureResult } from "./capture.ts";
import type { NetIssue } from "./net.ts";
import { releasedVersion } from "./shim.ts";
import { harnessDetail, step, StepError } from "./steps.ts";

export { SANDBOX_USAGE } from "./sandbox-usage.ts";

// ─── What is compared ───────────────────────────────────────────────────────

/** One chapter as the Sandbox laid it out. */
export interface SandboxChapter {
  pages: number;
  hash?: string;
  /** The lines and their order, no box (lib/probe.js `linesHash`). */
  lines?: string;
  /** Kind and what it names, positions aside (lib/probe.js `warningsOf`). */
  warnings: string[];
}

/** What a run of one edition brought back. */
export interface SandboxRun {
  chapters: SandboxChapter[];
  /** Faces per family: on the page and sent to the worker. */
  fonts: Record<string, { page: string[]; worker: string[] }>;
  /** The plan settled and every chapter has a document. */
  settled: boolean;
  /** Page, console and worker errors. */
  errors: string[];
  /** `--site`: the `.postext` the page fetched (its path). */
  bundleUrl?: string;
}

/** What capture.json records for the edition. */
export interface SandboxExpected {
  slug: string;
  variant: SampleLocale;
  sandbox: NonNullable<CaptureVariant["sandbox"]>;
  /** Pages of the capture (`specimen.pages`), for an edition without `sandbox.chapters`. */
  pages: number;
  /** The engine capture.json records. */
  engine: string;
}

export interface SandboxFinding {
  severity: "fail" | "warn" | "info";
  detail: string;
}

/** The warnings in `got` beyond those in `expected`, each as often as it is over. */
export function extraWarnings(expected: readonly string[], got: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const w of expected) left.set(w, (left.get(w) ?? 0) + 1);
  const out: string[] = [];
  for (const w of got) {
    const n = left.get(w) ?? 0;
    if (n > 0) left.set(w, n - 1);
    else out.push(w);
  }
  return out;
}

/** "fontFallback Bangers 700 (synthesized)" → "Bangers". */
function fallbackFamily(warning: string, families: readonly string[]): string | null {
  if (!warning.startsWith("fontFallback ")) return null;
  const rest = warning.slice("fontFallback ".length);
  return [...families].sort((a, b) => b.length - a.length).find((family) => rest.startsWith(`${family} `)) ?? null;
}

/** "A", "A and B", "A, B and C". */
const listed = (names: readonly string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * The families of a run the page set from a variable file: every loaded
 * face of theirs answers for a range of weights ("200 900 normal"). A
 * family with one cut and a stand-in for its bold (#688: "400 normal" and
 * "600 900 normal") is not one. Empty for a run that reports no faces
 * (`--site`).
 */
export function variableFamilies(fonts: SandboxRun["fonts"]): string[] {
  return Object.entries(fonts)
    .filter(([, held]) => {
      const loaded = held.page.filter((face) => !/\((unloaded|loading|error)\)/.test(face));
      return loaded.length > 0 && loaded.every((face) => /^\d+ \d+ /.test(face));
    })
    .map(([family]) => family);
}

/**
 * An edition's run against its record. Failures: an error of the page or
 * the worker, a layout that did not settle, a warning the pen's builds do
 * not have (for a `fontFallback`, with the family's faces on the page and
 * in the worker). A chapter count, a page count or, on the recorded engine
 * (`sameEngine`), lines other than the recorded ones: failures with
 * `strict`, warnings without. A layout hash other than the recorded one
 * under the recorded lines is a note: the Sandbox measures with another
 * build of the family than the pen (Google's variable file, the pen the
 * static cuts), and the hash rounds widths that differ by fractions of a
 * pixel. With no lines recorded (a capture from before them) the layout
 * hash cannot tell a line that moved from such a width: a warning that
 * says to capture again. An edition whose capture.json has no
 * `sandbox.chapters` yet is compared on its page total, and its warnings
 * are notes: there is nothing recorded to read them against.
 */
export function compareEdition(
  expected: SandboxExpected,
  run: SandboxRun,
  { strict, sameEngine, ownBundle }: { strict: boolean; sameEngine: boolean; ownBundle?: string },
): SandboxFinding[] {
  const out: SandboxFinding[] = [];
  const add = (severity: SandboxFinding["severity"], detail: string) => out.push({ severity, detail });
  const moved: SandboxFinding["severity"] = strict ? "fail" : "warn";
  for (const error of run.errors) add("fail", error);
  if (!run.chapters.length) {
    if (!run.errors.length) add("fail", "the Sandbox laid out no chapter");
    return out;
  }
  if (!run.settled) add("fail", "the book's plan did not settle: a chapter kept being asked for again");
  if (ownBundle !== undefined && run.bundleUrl !== ownBundle) {
    add("fail", `the page fetched ${run.bundleUrl ?? "no bundle"}, not the edition's own ${ownBundle}`);
  }

  const s = (n: number) => `${n} page${n === 1 ? "" : "s"}`;
  const got = run.chapters;
  const want = expected.sandbox.chapters;
  const raised = got.flatMap((c) => c.warnings);
  const faces = (warning: string) => {
    const family = fallbackFamily(warning, Object.keys(run.fonts));
    const held = family ? run.fonts[family] : undefined;
    return held ? ` (${family} on the page: ${held.page.join(", ") || "no face"}; in the worker: ${held.worker.join(", ") || "no face"})` : "";
  };
  if (!want) {
    // Before the capture records chapters: the page total, and notes.
    const total = got.reduce((sum, c) => sum + c.pages, 0);
    const recorded = expected.sandbox.pages ?? expected.pages;
    if (total !== recorded) add(moved, `the Sandbox lays the bundle out to ${s(total)}, the capture counts ${recorded}`);
    for (const warning of raised) add("info", `the Sandbox raises ${warning}${faces(warning)} (capture.json records no sandbox.warnings to read it against: capture with --sandbox-only)`);
    return out;
  }
  for (const warning of extraWarnings(expected.sandbox.warnings ?? [], raised)) {
    add("fail", `the Sandbox raises a warning the pen does not: ${warning}${faces(warning)}`);
  }
  if (got.length !== want.length) {
    add(moved, `the Sandbox lays out ${got.length} chapter${got.length === 1 ? "" : "s"}, the capture records ${want.length}`);
    return out;
  }
  const one = want.length === 1;
  const variable = variableFamilies(run.fonts);
  const measured = variable.length ? `the Sandbox measures ${listed(variable)} from ${variable.length === 1 ? "a variable file" : "variable files"}, a pen from the static cuts` : "";
  got.forEach((chapter, i) => {
    const name = one ? "the bundle" : `chapter ${i + 1}`;
    const recorded = want[i]!;
    if (chapter.pages !== recorded.pages) {
      add(moved, `the Sandbox lays ${name} out to ${s(chapter.pages)}, the capture records ${recorded.pages}`);
      return;
    }
    if (!sameEngine || chapter.hash === undefined || chapter.hash === recorded.hash) return;
    const hashes = `layout hash ${chapter.hash} against ${recorded.hash}`;
    if (recorded.lines === undefined || chapter.lines === undefined) {
      add("warn", `the Sandbox lays ${name} out to another layout hash than the capture records (${s(chapter.pages)} on both sides, ${hashes}), and capture.json records no lines hash to tell a line that breaks elsewhere from one set to another width: capture with --sandbox-only`);
    } else if (chapter.lines !== recorded.lines) {
      add(moved, `the Sandbox breaks the lines of ${name} otherwise than the capture records (${s(chapter.pages)} on both sides, lines hash ${chapter.lines} against ${recorded.lines})${measured ? `; ${measured}, and a line a fraction of a pixel from its measure breaks on either side of it` : ""}`);
    } else {
      add("info", `the Sandbox sets ${name} in the lines the capture records, some of them to another width (${hashes})${measured ? `: ${measured}` : ""}`);
    }
  });
  return out;
}

// ─── The editions of a run ──────────────────────────────────────────────────

interface Edition extends SandboxExpected {
  timeoutMs: number;
}

function editionsOf(slugs: readonly string[], langs: readonly SampleLocale[], timeoutMs: number): { editions: Edition[]; broken: CaptureResult[] } {
  const editions: Edition[] = [];
  const broken: CaptureResult[] = [];
  const failed = (slug: string, detail: string): CaptureResult => ({
    slug, variant: "en", ok: false, fails: [{ check: "sandbox", detail }], warns: [], pages: 0, totalMs: 0, written: false, outDir: captureDir(slug),
  });
  for (const slug of slugs) {
    const file = path.join(captureDir(slug), "capture.json");
    if (!fs.existsSync(file)) {
      broken.push(failed(slug, "no capture.json: capture the recipe first"));
      continue;
    }
    let manifest: CaptureManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, "utf-8")) as CaptureManifest;
    } catch (error) {
      broken.push(failed(slug, `capture.json does not parse: ${(error as Error).message}`));
      continue;
    }
    for (const variant of SAMPLE_LOCALES) {
      const data = manifest.variants?.[variant];
      if (!data?.sandbox || !langs.includes(variant)) continue;
      editions.push({ slug, variant, sandbox: data.sandbox, pages: data.specimen.pages, engine: manifest.engine.postext, timeoutMs });
    }
  }
  return { editions, broken };
}

const bundleFile = (slug: string, lang: string) => path.join(captureDir(slug), lang, `${slug}.postext`);
const dim = (text: string) => styleText("dim", text, { stream: process.stderr });

/** A run's findings as the capture's report prints them. */
function resultOf(edition: Edition, findings: SandboxFinding[], run: SandboxRun | null, totalMs: number, engine: string): CaptureResult {
  const fails = findings.filter((f) => f.severity === "fail").map((f) => ({ check: "sandbox", detail: f.detail }));
  return {
    slug: edition.slug, variant: edition.variant, ok: fails.length === 0, fails,
    warns: findings.filter((f): f is SandboxFinding & { severity: "warn" | "info" } => f.severity !== "fail").map((f) => ({ check: "sandbox", severity: f.severity, detail: f.detail })),
    pages: run?.chapters.reduce((sum, c) => sum + c.pages, 0) ?? 0, totalMs, written: false,
    outDir: path.join(captureDir(edition.slug), edition.variant), engine,
  };
}

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

// ─── The working tree ───────────────────────────────────────────────────────

const BUILD_DIR = path.join(WEB_DIR, ".cache", "cookbook-sandbox");
const SANDBOX_SRC = path.join(REPO_DIR, "packages", "postext-sandbox", "src");

/** bun, as the workspace installed it (a dev dependency of postext-cli), else on the PATH. */
function findBun(): string {
  for (const dir of [path.join(WEB_DIR, "node_modules", ".bin"), path.join(REPO_DIR, "packages", "postext-cli", "node_modules", ".bin")]) {
    const file = path.join(dir, process.platform === "win32" ? "bun.exe" : "bun");
    if (fs.existsSync(file)) return file;
  }
  return "bun";
}

/** The page entry and the layout worker of the Sandbox package, built from
 *  the working tree with code splitting (MathJax and the citation engine
 *  are chunks the worker loads when a text needs them). */
export function buildSandboxEntries(outDir: string = BUILD_DIR): void {
  for (const name of ["postext", "postext-citeproc"]) {
    if (!fs.existsSync(path.join(REPO_DIR, "packages", name, "dist", "index.js"))) {
      throw new Error(`packages/${name}/dist is not built: run pnpm turbo run build --filter=postext-sandbox... first`);
    }
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  try {
    execFileSync(findBun(), [
      "build", path.join(SANDBOX_SRC, "headless", "page.ts"), path.join(SANDBOX_SRC, "headless", "worker.ts"),
      "--outdir", outDir, "--target", "browser", "--format", "esm", "--splitting",
    ], { cwd: path.join(REPO_DIR, "packages", "postext-sandbox"), stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stderr, stdout, message } = error as { stderr?: Buffer; stdout?: Buffer; message: string };
    throw new Error(`the Sandbox's headless entry did not build with bun: ${String(stderr ?? "") || String(stdout ?? "") || message}`);
  }
}

/** One edition in a page of the harness: a browser context of its own (the
 *  font store and the loader's caches are per page), the network through
 *  the capture's cache with Google Fonts allowed. */
async function runLocal(browser: Browser, userAgent: string, url: string, edition: Edition, refresh: boolean): Promise<SandboxRun> {
  const { interceptor } = await import("./net.ts");
  const name = `${edition.slug} ${edition.variant}`;
  const within = <T>(what: string, run: () => Promise<T>, timeoutMs = edition.timeoutMs) => step(what, { edition: name, timeoutMs }, run);
  const context = await browser.createBrowserContext();
  const errors: string[] = [];
  try {
    const page = await within("newPage", () => context.newPage({ type: "window" }));
    const issues: NetIssue[] = [];
    await within("intercept", () => page.setRequestInterception(true));
    page.on("request", interceptor({ localOrigin: url.replace(/\/$/, ""), userAgent, refresh, profile: "sandbox", onIssue: (issue) => issues.push(issue) }));
    page.on("pageerror", (error) => errors.push(`page error: ${error instanceof Error ? error.message : String(error)}`));
    page.on("console", (message) => {
      // A font file the loader could not fetch is the warnings' business.
      if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(`console error: ${message.text().slice(0, 300)}`);
    });
    await within("goto", () => page.goto(url, { waitUntil: "domcontentloaded", timeout: edition.timeoutMs }));
    await within("entry", () => page.waitForFunction("window.__sbReady !== undefined", { timeout: edition.timeoutMs, polling: 50 }));
    const laid = await within("layout", () => page.evaluate(
      async (bundle: string, locale: string) => {
        const w = window as unknown as {
          __sbReady?: boolean; __sbErrors: string[];
          __postextSandbox?: { layOutBundle(bytes: Uint8Array, options: object): Promise<{ chapters: { pages: number; hash?: string; lines?: string; warnings: string[] }[]; fonts: Record<string, { page: string[]; worker: string[] }>; settled: boolean }> };
        };
        if (!w.__sbReady || !w.__postextSandbox) return { error: `the Sandbox entry did not load: ${w.__sbErrors.join(" · ")}` };
        try {
          const probe = (await import("/__cb/probe.js" as string)) as { layoutHash(doc: unknown): string; linesHash(doc: unknown): string; warningsOf(doc: unknown): string[] };
          const res = await fetch(bundle);
          if (!res.ok) return { error: `the bundle did not load: HTTP ${res.status}` };
          const bytes = new Uint8Array(await res.arrayBuffer());
          // A factory: the layout service starts over on a fresh worker when
          // a chapter's pages are set in a face it was not sent (#757).
          const worker = () => {
            const made = new Worker("/__sb/worker.js", { type: "module" });
            made.addEventListener("error", (event) => w.__sbErrors.push(`worker error: ${event.message ?? "the layout worker failed to start"}`));
            return made;
          };
          const out = await w.__postextSandbox.layOutBundle(bytes, { locale, worker, layoutHash: probe.layoutHash, linesHash: probe.linesHash, warningsOf: probe.warningsOf });
          return { chapters: out.chapters, fonts: out.fonts, settled: out.settled, errors: w.__sbErrors };
        } catch (error) {
          return { error: `the bundle does not open and lay out in the Sandbox: ${String((error as Error)?.message ?? error)}`, errors: w.__sbErrors };
        }
      },
      `/__bundle/${edition.slug}/${edition.variant}`,
      htmlLang(edition.variant),
    ));
    for (const issue of issues) if (issue.severity === "fail") errors.push(`network: ${issue.detail}`);
    if ("error" in laid && laid.error) return { chapters: [], fonts: {}, settled: false, errors: [laid.error, ...(laid.errors ?? []), ...errors] };
    const ok = laid as { chapters: SandboxChapter[]; fonts: SandboxRun["fonts"]; settled: boolean; errors: string[] };
    return { chapters: ok.chapters, fonts: ok.fonts, settled: ok.settled, errors: [...ok.errors, ...errors] };
  } finally {
    await context.close().catch(() => {});
  }
}

// ─── A deployed site ────────────────────────────────────────────────────────

/** Runs before the page's scripts: every layout worker's `build` requests
 *  and `built` answers are kept, the newest document per text built (a
 *  chapter is built again when the ones before it move its start). */
const SITE_HOOK = `(() => {
  const state = (window.__sbSite = { chapters: new Map(), errors: [], lastBuiltAt: 0, seq: 0 });
  const Real = window.Worker;
  window.Worker = class extends Real {
    constructor(url, options) {
      super(url, options);
      const asked = new Map();
      const post = this.postMessage.bind(this);
      this.postMessage = (data, transfer) => {
        if (data && data.kind === 'build' && data.content) asked.set(data.id, String(data.content.markdown ?? ''));
        return post(data, transfer);
      };
      this.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.kind === 'built' && data.doc && asked.has(data.id)) {
          state.chapters.set(asked.get(data.id), { doc: data.doc, seq: state.seq++ });
          state.lastBuiltAt = performance.now();
        }
        if (data.kind === 'error') state.errors.push('worker error: ' + String(data.message ?? data.error ?? '').slice(0, 300));
      });
      this.addEventListener('error', (event) => state.errors.push('worker error: ' + String(event.message ?? 'the layout worker failed').slice(0, 300)));
    }
  };
})()`;

/** How long no `built` message must come before the last one is read. */
const QUIET_MS = 2500;

async function runSite(browser: Browser, site: string, edition: Edition): Promise<SandboxRun> {
  const probe = (await import("./lib/probe.js" as string)) as { layoutHash(doc: unknown): string; linesHash(doc: unknown): string; warningsOf(doc: unknown): string[] };
  const name = `${edition.slug} ${edition.variant}`;
  const within = <T>(what: string, run: () => Promise<T>, timeoutMs = edition.timeoutMs) => step(what, { edition: name, timeoutMs }, run);
  const context = await browser.createBrowserContext();
  const errors: string[] = [];
  let bundleUrl: string | undefined;
  try {
    const page: Page = await within("newPage", () => context.newPage({ type: "window" }));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(SITE_HOOK);
    page.on("pageerror", (error) => errors.push(`page error: ${error instanceof Error ? error.message : String(error)}`));
    page.on("requestfinished", (request) => {
      const url = request.url();
      if (url.split("?")[0]!.endsWith(".postext") && request.response()?.ok()) bundleUrl = new URL(url).pathname;
    });
    await within("goto", () => page.goto(`${site}/${edition.variant}/sandbox#recipe=${edition.slug}&lang=${edition.variant}`, { waitUntil: "domcontentloaded", timeout: edition.timeoutMs }));
    // Every chapter paginated, and no `built` message for a while.
    await within("layout", () => page.waitForFunction(
      `(() => { const s = window.__sbSite; return !!s && s.chapters.size > 0 && performance.now() - s.lastBuiltAt > ${QUIET_MS}
        && document.documentElement.dataset.postextPagination !== 'pending' && document.documentElement.dataset.postextPagination !== 'loading'; })()`,
      { timeout: edition.timeoutMs, polling: 250 },
    ), edition.timeoutMs + 5_000);
    const count = await page.evaluate("window.__sbSite.chapters.size") as number;
    const docs: { offset: number; seq: number; doc: unknown }[] = [];
    for (let i = 0; i < count; i++) {
      // One document at a time through the protocol.
      const json = await within("read", () => page.evaluate(
        `(() => { const entry = [...window.__sbSite.chapters.values()][${i}]; return JSON.stringify({ seq: entry.seq, doc: entry.doc }); })()`,
      ) as Promise<string>);
      const { seq, doc } = JSON.parse(json) as { seq: number; doc: { pageIndexOffset?: number } };
      docs.push({ offset: doc.pageIndexOffset ?? 0, seq, doc });
    }
    errors.push(...(await page.evaluate("window.__sbSite.errors") as string[]));
    docs.sort((a, b) => a.offset - b.offset || a.seq - b.seq);
    const chapters = docs.map(({ doc }) => ({
      pages: (doc as { pages: unknown[] }).pages.length, hash: probe.layoutHash(doc), lines: probe.linesHash(doc), warnings: probe.warningsOf(doc),
    }));
    return { chapters, fonts: {}, settled: true, errors, bundleUrl };
  } finally {
    await context.close().catch(() => {});
  }
}

// ─── The command ────────────────────────────────────────────────────────────

export interface SandboxOptions {
  slugs: string[];
  langs?: SampleLocale[];
  site?: string;
  strict: boolean;
  concurrency?: number;
  timeoutMs: number;
  report?: string;
  refreshNet?: boolean;
}

export async function runSandboxCheck(opts: SandboxOptions): Promise<CaptureResult[]> {
  const langs = opts.langs?.length ? opts.langs : SAMPLE_LOCALES;
  const { editions, broken } = editionsOf(opts.slugs, langs, opts.timeoutMs);
  const results: CaptureResult[] = [...broken];
  if (!editions.length) return results;

  const { launchBrowser } = await import("./harness.ts");
  const tree = releasedVersion("postext");
  let server: { url: string; close(): Promise<void> } | null = null;
  if (!opts.site) {
    process.stderr.write(dim("  building the Sandbox's headless entry and its layout worker with bun\n"));
    buildSandboxEntries();
    const { startSandboxServer } = await import("./serve.ts");
    server = await startSandboxServer({ buildDir: BUILD_DIR, bundleFile });
  }
  // An edition that hangs fails alone: a CDP call may wait a little longer
  // than the edition's own bound, no more.
  const hb = await launchBrowser({ protocolTimeout: opts.timeoutMs + 30_000 });
  try {
    const jobs = editions.map((edition) => async () => {
      const t0 = Date.now();
      process.stderr.write(dim(`  ${opts.site ? "opening" : "laying out"} ${edition.slug} ${edition.variant}\n`));
      let run: SandboxRun | null = null;
      let findings: SandboxFinding[];
      // The lines are the engine's: only the recorded release gives the recorded ones.
      let version = tree;
      // A step that never answered gets a second try in a context of its
      // own: a font file the network stalled on is in the cache by then, and
      // an edition that hangs for a reason of its own hangs again and fails.
      const open = () => opts.site
        ? runSite(hb.browser, opts.site.replace(/\/$/, ""), edition)
        : runLocal(hb.browser, hb.userAgent, server!.url, edition, !!opts.refreshNet);
      try {
        let stalled: StepError | null = null;
        try {
          run = await open();
        } catch (error) {
          if (!(error instanceof StepError && error.stalled)) throw error;
          stalled = error;
          process.stderr.write(dim(`  ${edition.slug} ${edition.variant}: ${error.message}; trying once more\n`));
          run = await open();
        }
        if (opts.site) version = edition.engine;
        findings = compareEdition(edition, run, {
          strict: opts.strict,
          sameEngine: opts.site ? true : edition.engine === tree,
          ...(opts.site ? { ownBundle: `/cookbook/${edition.slug}/${edition.variant}/${edition.slug}.postext` } : {}),
        });
        if (stalled) findings.push({ severity: "info", detail: `laid out at the second try (the first: ${stalled.message})` });
      } catch (error) {
        findings = [{ severity: "fail", detail: harnessDetail(error) }];
      }
      return resultOf(edition, findings, run, Date.now() - t0, version);
    });
    results.push(...await pool(jobs, opts.concurrency ?? 3));
  } finally {
    await hb.browser.close().catch(() => {});
    await server?.close();
  }
  if (opts.report) {
    fs.mkdirSync(path.dirname(opts.report), { recursive: true });
    fs.writeFileSync(opts.report, `${JSON.stringify({ mode: opts.site ? "site" : "tree", site: opts.site ?? null, postext: tree, strict: opts.strict, chrome: hb.chrome, results }, null, 2)}\n`);
  }
  return results;
}

export async function runSandbox(argv: readonly string[]): Promise<number> {
  const args = parseArgs(
    argv,
    {
      lang: { type: "list", value: "en,es", choices: SAMPLE_LOCALES },
      site: { type: "string", value: "url" },
      strict: { type: "boolean" },
      "no-strict": { type: "boolean" },
      concurrency: { type: "int", value: "n", min: 1, max: 16 },
      timeout: { type: "int", value: "s", min: 5, max: 1800 },
      report: { type: "string", value: "out.json" },
      "refresh-net": { type: "boolean" },
    },
    "sandbox",
  );
  const site = str(args, "site");
  if (site && !/^https?:\/\/[^/]+/.test(site)) throw new UsageError(`--site expects a URL (https://postext.dev), not "${site}"`, "sandbox");
  if (flag(args, "strict") && flag(args, "no-strict")) throw new UsageError("pass --strict or --no-strict, not both", "sandbox");
  const known = listRecipeSlugs();
  const unknown = args.positionals.filter((slug) => !known.includes(slug));
  if (unknown.length) throw new UsageError(`no recipe ${unknown.map((s) => `"${s}"`).join(", ")} in cookbook/`, "sandbox");
  // With no slugs: every captured recipe that is not retired.
  const slugs = args.positionals.length ? args.positionals : known.filter((slug) => {
    try {
      return readRecipeMeta(slug).status !== "retired" && fs.existsSync(path.join(captureDir(slug), "capture.json"));
    } catch {
      return false;
    }
  });
  const strict = site ? !flag(args, "no-strict") : flag(args, "strict");
  const report = str(args, "report");
  const { printResults } = await import("./report.ts");
  console.log(`${styleText("bold", "Cookbook Sandbox check", { stream: process.stdout })} · ${slugs.length} recipe${slugs.length === 1 ? "" : "s"} · ${site ?? "the working tree"}${strict ? " · strict" : ""}\n`);
  const results = await runSandboxCheck({
    slugs,
    langs: list(args, "lang") as SampleLocale[] | undefined,
    ...(site ? { site } : {}),
    strict,
    concurrency: int(args, "concurrency"),
    timeoutMs: (int(args, "timeout") ?? 60) * 1000,
    ...(report ? { report: userPath(report) } : {}),
    refreshNet: flag(args, "refresh-net"),
  });
  return printResults(results);
}
