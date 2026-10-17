/**
 * The capture harness (spec §8.2): runs one recipe edition in headless
 * Chrome and brings back everything the checks and the outputs need.
 *
 *   serve.ts   compose the pen, serve it with the recording shims
 *   net.ts     answer every request (repo files, the site, cached esm.sh
 *              and Fontsource, nothing else)
 *   here       wait for `__done`, the fonts, a quiet settle window (H10)
 *              and two frames; build the PDF when the recipe keeps one;
 *              read the facts and paint the pages and the card in the page,
 *              then write the document as a `.postext` bundle for the
 *              Sandbox (lib/probe.js)
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import type { CaptureBuild, SampleLocale, RecipeMeta } from "../../src/lib/cookbook/types.ts";
import { cardProblems, heroPages, publishedPages } from "./cards.ts";
import { CHROME_HELP, chromeTooOld, installedChromes, pickChrome, tooOldMessage } from "./chrome.ts";
import type { BundleReadBack, EpubRecord, ProbeFacts } from "./checks.ts";
import type { NetIssue } from "./net.ts";
import { interceptor, routeFor } from "./net.ts";
import type { PenServer } from "./serve.ts";
import { startPenServer } from "./serve.ts";
import { step } from "./steps.ts";

// ─── Chrome ─────────────────────────────────────────────────────────────────

const CFT_BINARIES = [
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-linux64/chrome",
  "chrome-win64/chrome.exe",
];

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The Chrome to launch (chrome.ts `pickChrome`): COOKBOOK_CHROME, else the
 *  newest Chrome for Testing Puppeteer cached when it is current enough,
 *  else the Chrome installed on the machine. */
export function findChrome(): string {
  const env = process.env.COOKBOOK_CHROME;
  if (env && !fs.existsSync(env)) throw new Error(`COOKBOOK_CHROME does not exist: ${env}`);
  const root = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  const cached = (fs.existsSync(root) ? fs.readdirSync(root) : [])
    .map((dir) => ({ dir, version: /-(\d+\.\d+\.\d+\.\d+)$/.exec(dir)?.[1] }))
    .filter((entry): entry is { dir: string; version: string } => !!entry.version)
    .flatMap(({ dir, version }) =>
      CFT_BINARIES.map((bin) => ({ file: path.join(root, dir, bin), version })).filter(({ file }) => fs.existsSync(file)),
    )
    .sort((a, b) => compareVersions(b.version, a.version));
  const choice = pickChrome({ env, cached, installed: installedChromes() });
  if (!choice) {
    throw new Error(cached.length
      ? `${tooOldMessage(cached[0].version, cached[0].file)} No other Chrome is installed.`
      : `No Chrome found (none in ~/.cache/puppeteer/chrome, none installed): ${CHROME_HELP}.`);
  }
  return choice.file;
}

export interface HarnessBrowser {
  browser: Browser;
  /** "131.0.6778.204" */
  chrome: string;
  userAgent: string;
}

/** `protocolTimeout`: how long one CDP call may stay unanswered
 *  (steps.ts `protocolTimeoutFor`; Puppeteer's own default is 180 s).
 *  A Chrome older than chrome.ts `OLDEST_CHROME` is refused: its pages are
 *  not the ones a reader's browser lays out (#746). */
export async function launchBrowser({ headed = false, protocolTimeout }: { headed?: boolean; protocolTimeout?: number } = {}): Promise<HarnessBrowser> {
  const executablePath = findChrome();
  const browser = await puppeteer.launch({
    executablePath,
    headless: !headed,
    args: ["--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check"],
    defaultViewport: null,
    ...(protocolTimeout ? { protocolTimeout } : {}),
  });
  const version = await browser.version();
  const chrome = /(\d+\.\d+\.\d+\.\d+)/.exec(version)?.[1] ?? version;
  if (chromeTooOld(chrome)) {
    await browser.close().catch(() => {});
    throw new Error(tooOldMessage(chrome, executablePath));
  }
  return { browser, chrome, userAgent: await browser.userAgent() };
}

// ─── One edition ────────────────────────────────────────────────────────────

export interface RenderedPage {
  n: number;
  w: number;
  h: number;
  full: Buffer;
  strip: Buffer;
  png: Buffer | null;
}

export interface CardImages {
  card: Buffer;
  card480: Buffer;
  og: Buffer;
  png: Buffer | null;
  ogPng: Buffer | null;
  magnification: number | null;
}

export interface VariantRun {
  slug: string;
  variant: SampleLocale;
  engine: PenServer["engine"];
  pen: ReturnType<PenServer["current"]>["pen"];
  done: "ok" | "error" | "timeout";
  err: string | null;
  loaderErrors: string[];
  console: { type: string; text: string }[];
  pageErrors: string[];
  net: NetIssue[];
  failedRequests: string[];
  settle: { waitedMs: number; timedOut?: boolean } | null;
  /** Waits that ended on their timer instead of their event (#743): the
   *  fonts that never settled, the animation frame that never came. */
  fallbacks: string[];
  /** `data-postext` and the status line once the pen settled, before the PDF. */
  kit: { state: string | null; status: string | null } | null;
  facts: ProbeFacts | null;
  /** Pages whose painting taints the canvas (C15). */
  tainted: number[];
  pdf: { wanted: boolean; button: boolean; timedOut: boolean; error: string | null; fontFailures: string[]; ms: number; bytes: Buffer | null } | null;
  /** The EPUBs the pen wrote while it ran (C30). */
  epubs: EpubRecord[];
  published: number[];
  publishError: string | null;
  cardErrors: string[];
  pages: RenderedPage[];
  /** The published pages that differ from the committed images; null when
   *  there was no committed folder to compare with. */
  pageChanges: PageChange[] | null;
  card: CardImages | null;
  renderError: { message: string; taint: boolean } | null;
  timings: { totalMs: number; runMs: number };
  netStats: { cached: number; fetched: number };
  /** Captured without request interception (a worker recipe). */
  passive: boolean;
  /** postext versions a worker imported (workers ignore the import map). */
  workerEngines: string[];
  /** The selected document as a `.postext` file for the Sandbox. */
  sandbox: SandboxBundle | null;
}

export interface SandboxBundle {
  bytes: Buffer | null;
  error: string | null;
  /** createBundle's warnings (a family left out, a skipped face). */
  warnings: string[];
  /** What the bundle cannot carry (a continuation's page sides, counters). */
  notes: string[];
  /** Builds left out because their configuration is another and the recipe
   *  did not say which to keep (`capture.sandbox`). */
  warns: string[];
  /** The warnings of the pen's builds the bundle holds (kind and what it
   *  names, positions aside): `sandbox.warnings` in capture.json (#736). */
  penWarnings: string[];
  /** The pages of the builds the bundle holds, and of every build the
   *  capture publishes. */
  pages: number;
  allPages: number;
  /** The bundle opened and laid out again against the pen's documents (C33). */
  readBack: BundleReadBack | null;
  /** The committed bundle, when its bytes are not the run's, read back the
   *  same way by the run's engine (#734); null when the bytes are equal or
   *  no committed bundle was given. */
  committedReadBack: BundleReadBack | null;
}

/** A published page whose image is not the committed one beyond rendering
 *  noise (#734, lib/probe.js `PAGE_DIFFERENCE`). */
export interface PageChange {
  n: number;
  /** The worst cell's mean difference (of 255), when both images decoded. */
  worst?: number;
  /** "worst cell 36.2 of 255, 14 cells over 12", "no committed image". */
  detail: string;
}

/** What the bundle is called: `recipe-<slug>`, the write-up's title. */
export interface SandboxMeta {
  id: string;
  name: string;
  description?: string;
  /** The card (480 px WebP), used as the bundle's thumbnail. */
  thumbnail?: Buffer | null;
  /** recipe.json `folio` as `config.folio`, over the pen's own. */
  folio?: Record<string, unknown>;
}

export interface RunOptions {
  hb: HarnessBrowser;
  slug: string;
  variant: SampleLocale;
  meta: RecipeMeta;
  engine?: string;
  refreshNet?: boolean;
  /** Also encode PNG copies (for --previewDir). */
  png?: boolean;
  /** Write the Sandbox bundle (the card becomes its thumbnail). */
  sandbox?: SandboxMeta;
  /** Only the facts and the Sandbox bundle: no PDF, pages or card. */
  sandboxOnly?: boolean;
  /** The edition's committed folder, when its sources are the capture's:
   *  the new pages are compared with its images and its bundle is read
   *  back by the run's engine, so files that say nothing new stay (#734). */
  committedDir?: string;
  /** The largest mean difference of a cell (of 255) a page may show
   *  against its committed image (`--max-diff`, C39); lib/probe.js
   *  `PAGE_DIFFERENCE.max` by default. */
  maxDiff?: number;
  /** Each content file of the edition as the pen inlines it: the stress
   *  test's longer text (#869). */
  transformContent?: (text: string, key: string) => string;
  /** Only the facts: no PDF, pages, card or bundle (the stretched run of
   *  the stress test). */
  factsOnly?: boolean;
  /** The facts and every page as a PNG, no PDF, card or bundle: the
   *  stretched run of the stress test with `--stress-out` (#915). */
  pagesOnly?: boolean;
}

const PROBE = "/__cb/probe.js";

/** Calls an export of lib/probe.js inside the page. */
function probe<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async (url: string, fn: string, params: unknown[]) => {
      const mod = await import(url);
      return mod[fn](...params);
    },
    PROBE,
    name,
    args,
  ) as Promise<T>;
}

function dataUrlBytes(url: string): Buffer {
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Past a step's own timeout, so Puppeteer's error (which names what it
 *  waited for) arrives before the step's bound does. */
const STEP_GRACE_MS = 5_000;
/** `document.fonts.ready` settles when the pen says it is done; a font
 *  request left without an answer would keep it pending for ever. */
const FONTS_BOUND_MS = 10_000;
/** A presented tab paints a frame every 16 ms. */
const FRAME_BOUND_MS = 500;

export async function runVariant(opts: RunOptions): Promise<VariantRun> {
  const { hb, meta } = opts;
  const timeout = meta.capture.timeoutMs ?? 60_000;
  // Request interception stalls a module worker's imports, so a worker
  // recipe runs unintercepted: its page rewrites jsDelivr and postext.dev
  // URLs in fetch() to the local server, and hosts are checked after the fact.
  const passive = !!meta.engine.worker;
  const server = await startPenServer({
    slug: opts.slug, variant: opts.variant, engine: opts.engine, rewriteFetch: passive,
    ...(opts.transformContent ? { transformContent: opts.transformContent } : {}),
  });
  const netStats = { cached: 0, fetched: 0 };
  const run: VariantRun = {
    slug: opts.slug,
    variant: opts.variant,
    engine: server.engine,
    pen: server.current().pen,
    done: "timeout",
    err: null,
    loaderErrors: [],
    console: [],
    pageErrors: [],
    net: [],
    failedRequests: [],
    settle: null,
    fallbacks: [],
    kit: null,
    facts: null,
    tainted: [],
    pdf: null,
    epubs: [],
    published: [],
    publishError: null,
    cardErrors: [],
    pages: [],
    pageChanges: null,
    card: null,
    renderError: null,
    timings: { totalMs: 0, runMs: 0 },
    netStats,
    passive,
    workerEngines: [],
    sandbox: null,
  };
  const flagged = new Set<string>();
  const t0 = Date.now();
  // Every step is named and bounded by the recipe's own timeout (#743): a
  // call that never answers says which step of which edition it was.
  const edition = `${opts.slug} ${opts.variant}`;
  const within = <T>(name: string, run: () => Promise<T>, timeoutMs: number = timeout) => step(name, { edition, timeoutMs }, run);
  let page: Page;
  try {
    // A window of its own (#743). As tabs of one window only the last one
    // opened is presented: the others get no animation frame, and
    // `document.fonts.ready` and whatever a pen awaits before it paints stay
    // pending until Chrome happens to bring them forward. With three
    // editions at a time the first one opened could wait for the whole run.
    page = await within("newPage", () => hb.browser.newPage({ type: "window" }));
  } catch (error) {
    await server.close();
    throw error;
  }
  try {
    const screenshot = meta.capture.card === "screenshot";
    const viewport = meta.capture.viewport ?? { width: 1280, height: 900 };
    await within("viewport", () => page.setViewport({ ...viewport, deviceScaleFactor: screenshot ? 2 : 1 }));
    const localOrigin = server.url.replace(/\/$/, "");
    const onIssue = (issue: NetIssue) => {
      flagged.add(issue.url);
      run.net.push(issue);
    };
    if (!passive) {
      await within("intercept", () => page.setRequestInterception(true));
      page.on("request", interceptor({ localOrigin, userAgent: hb.userAgent, refresh: opts.refreshNet, stats: netStats, onIssue }));
    } else {
      page.on("request", (request) => {
        const url = request.url();
        if (url.startsWith(localOrigin) || !/^https?:/.test(url)) return;
        const route = routeFor(url);
        if (route.kind === "blocked") onIssue({ severity: "fail", url, detail: `host not allowed: ${route.host} (${url})` });
        const version = request.frame() === null ? /^https:\/\/esm\.sh\/postext@(\d+\.\d+\.\d+)\//.exec(url)?.[1] : undefined;
        if (version && !run.workerEngines.includes(version)) run.workerEngines.push(version);
      });
    }
    page.on("console", (message) => run.console.push({ type: message.type(), text: message.text() }));
    page.on("pageerror", (error) => run.pageErrors.push(error instanceof Error ? error.message : String(error)));
    page.on("requestfailed", (request) => {
      if (!flagged.has(request.url())) run.failedRequests.push(`${request.failure()?.errorText ?? "failed"}: ${request.url()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !flagged.has(response.url())) {
        run.failedRequests.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });

    await within("goto", () => page.goto(server.url, { waitUntil: "domcontentloaded", timeout }), timeout + STEP_GRACE_MS);
    try {
      const left = Math.max(1000, timeout - (Date.now() - t0));
      await within("done", () => page.waitForFunction("window.__done !== undefined", { timeout: left, polling: 100 }), left + STEP_GRACE_MS);
    } catch {
      run.done = "timeout";
    }
    const state = await within("state", () => page.evaluate(
      "({ done: window.__done ?? null, err: window.__err ?? null, errors: window.__cbErrors ?? [] })",
    ) as Promise<{ done: "ok" | "error" | null; err: string | null; errors: string[] }>);
    if (state.done) run.done = state.done;
    run.err = state.err;
    run.loaderErrors = state.errors;
    if (run.done === "timeout") return run;

    // Fonts, then no new build for 500 ms (H10), then two frames. The
    // fonts and the frames wait on the browser, so each has a timer beside
    // it in the page (#743): a tab the browser is not presenting gets no
    // animation frame. No picture is taken of a `sandboxOnly` run, which
    // needs no frame at all.
    const fonts = await within("fonts", () => probe<{ timedOut?: boolean }>(page, "fontsReady", FONTS_BOUND_MS));
    if (fonts.timedOut) run.fallbacks.push(`fonts: document.fonts.ready did not settle in ${FONTS_BOUND_MS / 1000} s`);
    run.settle = await within("settle", () => probe(page, "settle", 500, 10_000));
    {
      const painted = await within("frames", () => probe<{ frames: number; fellBack?: boolean }>(page, "frames", 2, FRAME_BOUND_MS));
      if (painted.fellBack) run.fallbacks.push(`frames: no animation frame in ${FRAME_BOUND_MS} ms after ${painted.frames} of 2`);
    }
    run.timings.runMs = Date.now() - t0;
    run.kit = await within("kit", () => probe(page, "kitState"));
    run.epubs = await within("epubs", () => probe<EpubRecord[]>(page, "epubState"));

    if (meta.downloads?.pdf && !opts.sandboxOnly && !opts.factsOnly && !opts.pagesOnly) {
      const button = await within("pdfButton", () => page.$("[data-postext-pdf]"));
      const pdf: NonNullable<VariantRun["pdf"]> = {
        wanted: true, button: !!button, timedOut: false, error: null, fontFailures: [], ms: 0, bytes: null,
      };
      run.pdf = pdf;
      if (button) {
        await within("pdfClick", async () => {
          await page.evaluate("window.scrollTo(0, 0)");
          await button.click();
        });
        try {
          await within("pdf", () => page.waitForFunction(
            "!!(window.__cb && (window.__cb.pdf || window.__cb.pdfError)) || document.documentElement.dataset.postext === 'error'",
            { timeout, polling: 100 },
          ), timeout + STEP_GRACE_MS);
        } catch {
          pdf.timedOut = true;
        }
        const pdfState = await within("pdfState", () => probe<{ bytes: number; error: string | null; fontFailures: string[]; ms: number }>(page, "pdfState"));
        pdf.error = pdfState.error;
        pdf.fontFailures = pdfState.fontFailures;
        pdf.ms = pdfState.ms;
        if (pdfState.bytes) {
          const base64 = await within("pdfBytes", () => probe<string | null>(page, "pdfBase64"));
          if (base64) pdf.bytes = Buffer.from(base64, "base64");
        }
      }
    }

    const hero = heroPages(meta);
    const select = meta.capture.doc ?? "last";
    run.facts = await within("facts", () => probe<ProbeFacts>(page, "facts", { select, hero }));
    // C36: the characters no loaded file of their family holds (the
    // browser is asked, which takes a moment: a step of its own).
    if (run.facts.selected >= 0) {
      run.facts.systemFont = await within("systemFont", () => probe<NonNullable<ProbeFacts["systemFont"]>>(page, "systemFontChars", { select }));
    }
    const all = (run.facts.pages ?? []).map((p) => p.n);
    if (run.facts.selected < 0 || all.length === 0 || opts.factsOnly) return run;
    if (opts.pagesOnly) {
      const rendered = await within("pages", () => probe<{ pages?: { n: number; w: number; h: number; full: string; strip: string; png: string | null }[]; error?: string; taint?: boolean }>(
        page, "renderPages", { select, pages: all, png: true },
      ));
      if (rendered.error) run.renderError = { message: rendered.error, taint: !!rendered.taint };
      run.pages = (rendered.pages ?? []).map((p) => ({
        n: p.n, w: p.w, h: p.h, full: dataUrlBytes(p.full), strip: dataUrlBytes(p.strip), png: p.png ? dataUrlBytes(p.png) : null,
      }));
      return run;
    }
    const keep = meta.capture.sandbox ?? null;
    if (opts.sandboxOnly) {
      const sandbox = opts.sandbox;
      if (sandbox) run.sandbox = await within("bundle", () => sandboxBundle(page, select, keep, opts.variant, sandbox, sandbox.thumbnail ?? null, null));
      return run;
    }

    run.tainted = await within("tainted", () => probe<number[]>(page, "taintedPages", { select }));
    const published = publishedPages(meta, all);
    run.published = published.list;
    run.publishError = published.error;
    run.cardErrors = cardProblems(meta, all, new Map((run.facts.pages ?? []).map((p) => [p.n, p.book])));

    const rendered = await within("pages", () => probe<{ pages?: { n: number; w: number; h: number; full: string; strip: string; png: string | null }[]; error?: string; taint?: boolean }>(
      page, "renderPages", { select, pages: run.published, png: !!opts.png },
    ));
    if (rendered.error) run.renderError = { message: rendered.error, taint: !!rendered.taint };
    run.pages = (rendered.pages ?? []).map((p) => ({
      n: p.n, w: p.w, h: p.h, full: dataUrlBytes(p.full), strip: dataUrlBytes(p.strip), png: p.png ? dataUrlBytes(p.png) : null,
    }));

    if (opts.committedDir && !run.renderError) {
      const dir = opts.committedDir;
      run.pageChanges = await within("compare", () => changedPages(page, dir, run.pages, opts.maxDiff));
    }

    let shot: string | null = null;
    if (screenshot && !run.cardErrors.length) {
      try {
        shot = await within("screenshot", () => screenshotOf(page, meta.capture.selector ?? "#pages"));
      } catch (error) {
        run.cardErrors.push((error as Error).message);
      }
    }
    if (!run.cardErrors.length && !run.renderError) {
      const card = await within("card", () => probe<{ card?: string; card480?: string; og?: string; png?: string | null; ogPng?: string | null; magnification?: number | null; error?: string; taint?: boolean }>(
        page, "composeCard", { select, mode: meta.capture.card, hero, focus: meta.capture.focus ?? null, screenshot: shot, png: !!opts.png },
      ));
      if (card.error || !card.card || !card.card480 || !card.og) {
        run.renderError = { message: `card: ${card.error ?? "no image"}`, taint: !!card.taint };
      } else {
        run.card = {
          card: dataUrlBytes(card.card),
          card480: dataUrlBytes(card.card480),
          og: dataUrlBytes(card.og),
          png: card.png ? dataUrlBytes(card.png) : null,
          ogPng: card.ogPng ? dataUrlBytes(card.ogPng) : null,
          magnification: card.magnification ?? null,
        };
      }
    }
    const sandbox = opts.sandbox;
    const committedBundle = opts.committedDir ? path.join(opts.committedDir, `${opts.slug}.postext`) : null;
    const committed = committedBundle && fs.existsSync(committedBundle) ? fs.readFileSync(committedBundle) : null;
    if (sandbox) run.sandbox = await within("bundle", () => sandboxBundle(page, select, keep, opts.variant, sandbox, run.card?.card480 ?? null, committed));
    return run;
  } finally {
    run.timings.totalMs = Date.now() - t0;
    if (!run.timings.runMs) run.timings.runMs = run.timings.totalMs;
    // Let late requests settle before the page and its server go away.
    await sleep(20);
    await page.close().catch(() => {});
    await server.close();
  }
}

/** The selected document as a `.postext` file, written in the page by the
 *  pen's engine and read back by it (lib/probe.js `sandboxBundle`). `keep`
 *  is `capture.sandbox`: of several builds, the one whose configuration the
 *  bundle takes. */
async function sandboxBundle(
  page: Page,
  select: CaptureBuild | CaptureBuild[],
  keep: CaptureBuild | null,
  locale: SampleLocale,
  meta: SandboxMeta,
  thumbnail: Buffer | null,
  committed: Buffer | null,
): Promise<SandboxBundle> {
  const none = { warnings: [], notes: [], warns: [], penWarnings: [], pages: 0, allPages: 0, readBack: null, committedReadBack: null };
  try {
    const out = await probe<{
      base64?: string; error?: string; warnings?: string[]; notes?: string[]; warns?: string[];
      pages?: number; allPages?: number; readBack?: BundleReadBack; committedReadBack?: BundleReadBack; penWarnings?: string[];
    }>(page, "sandboxBundle", {
      select,
      keep,
      id: meta.id,
      name: meta.name,
      description: meta.description,
      locale,
      thumbnail: thumbnail ? thumbnail.toString("base64") : null,
      folio: meta.folio ?? null,
      committed: committed ? committed.toString("base64") : null,
    });
    return {
      bytes: out.base64 ? Buffer.from(out.base64, "base64") : null,
      error: out.error ?? (out.base64 ? null : "no bundle"),
      warnings: out.warnings ?? [],
      notes: out.notes ?? [],
      warns: out.warns ?? [],
      penWarnings: out.penWarnings ?? [],
      pages: out.pages ?? 0,
      allPages: out.allPages ?? 0,
      readBack: out.readBack ?? null,
      committedReadBack: out.committedReadBack ?? null,
    };
  } catch (error) {
    return { ...none, bytes: null, error: String((error as Error).message ?? error) };
  }
}

/** The published pages whose image is not the committed one (#734): equal
 *  bytes pass at once; the rest are decoded in the page, both sides, and
 *  compared cell by cell (lib/probe.js `comparePages`). */
async function changedPages(page: Page, dir: string, pages: RenderedPage[], max?: number): Promise<PageChange[]> {
  const changes: PageChange[] = [];
  const pairs: { n: number; committed: string; fresh: string }[] = [];
  for (const p of pages) {
    const file = path.join(dir, `p${String(p.n).padStart(2, "0")}.webp`);
    if (!fs.existsSync(file)) {
      changes.push({ n: p.n, detail: "no committed image" });
      continue;
    }
    const committed = fs.readFileSync(file);
    if (!committed.equals(p.full)) pairs.push({ n: p.n, committed: committed.toString("base64"), fresh: p.full.toString("base64") });
  }
  // A few at a time: each pair is two images through the protocol.
  for (let i = 0; i < pairs.length; i += 4) {
    const compared = await probe<{ n: number; differ: boolean; worst: number; cells: number; error?: string }[]>(page, "comparePages", pairs.slice(i, i + 4), max === undefined ? {} : { max });
    for (const c of compared) {
      if (c.differ) changes.push({ n: c.n, worst: c.worst, detail: c.error ?? `worst cell ${c.worst} of 255, ${c.cells} cell${c.cells === 1 ? "" : "s"} over the threshold` });
    }
  }
  return changes.sort((a, b) => a.n - b.n);
}

/** The DOM card (`capture.card: 'screenshot'`): the element's top 4:3, at
 *  the viewport and DPR 2 set when the page opened. */
async function screenshotOf(page: Page, selector: string): Promise<string> {
  await page.evaluate("window.scrollTo(0, 0)");
  // The selector goes in as an argument, never spliced into the code.
  const box = (await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  }, selector)) as { x: number; y: number; width: number; height: number } | null;
  if (!box || box.width < 1 || box.height < 1) throw new Error(`capture.selector matches nothing visible: ${selector}`);
  const height = Math.min(box.height, (box.width * 3) / 4);
  // Capturing beyond the viewport resizes it for the shot, and a page that
  // relayouts on resize (a WebGL viewer repainting its pages) is caught
  // half-drawn: only when the crop does not fit the viewport.
  const viewport = page.viewport();
  const fits = !!viewport && box.y + height <= viewport.height && box.x + box.width <= viewport.width;
  const base64 = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height },
    captureBeyondViewport: !fits,
    encoding: "base64",
    type: "png",
  });
  return `data:image/png;base64,${base64}`;
}
