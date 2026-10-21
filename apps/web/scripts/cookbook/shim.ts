/**
 * The engine shims of the capture page. A pen imports the unpinned
 * `https://esm.sh/postext`; the capture page's import map sends that
 * specifier to a local shim that re-exports the pinned release and records
 * what the pen does with it in `window.__cb`: every build (content, config,
 * the documents and their time), the images it registers, documents that
 * reach the renderer without a recorded build (a layout worker's, harness
 * need H6), the PDF bytes and the font-provider failures.
 *
 * A worker has no import map. On the npm engine the worker client starts
 * esm.sh's own worker entry of the pinned release, so a worker recipe runs
 * the published engine inside its worker. On the local engine the client is
 * a file of `packages/postext/dist` on the pen server's origin and starts
 * `layout.worker.js` beside it: the server writes the bare imports of every
 * module of `dist` it serves as the URLs `localImports()` gives them
 * (`rewriteBareImports`, #742), so the worker resolves the same files as
 * the page and runs the working tree's engine. Either way the worker's
 * documents are recorded on the main thread.
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_DIR } from "../../src/lib/cookbook/paths.ts";

export interface EngineSpec {
  /** Pinned postext version, e.g. "1.4.1". */
  postext: string;
  /** Pinned postext-pdf version. */
  postextPdf: string;
  /** Pinned postext-citeproc version (released with postext since 1.12). */
  postextCiteproc: string;
  /** Pinned postext-folio version (versioned on its own, 0.x). */
  postextFolio: string;
  /** Pinned postext-epub version (versioned on its own, 0.x). */
  postextEpub: string;
  /** `local`: the workspace packages' `dist`, served by the pen server
   *  (previews of unreleased features; never written as a capture). */
  source: "npm" | "local";
}

const VERSION = /^\d+\.\d+\.\d+$/;

/** The released version of a workspace package (its package.json). */
export function releasedVersion(name: "postext" | "postext-pdf" | "postext-citeproc" | "postext-folio" | "postext-epub"): string {
  const file = path.join(REPO_DIR, "packages", name, "package.json");
  const version = (JSON.parse(fs.readFileSync(file, "utf-8")) as { version?: string }).version ?? "";
  if (!VERSION.test(version)) throw new Error(`packages/${name}/package.json has no x.y.z version`);
  return version;
}

/** `npm` (default: the released versions) or `npm@x.y.z` (both packages,
 *  which the release script publishes with one version). */
export function resolveEngine(spec: string = "npm"): EngineSpec {
  // The viewer and the EPUB writer have versions of their own.
  const own = { postextFolio: releasedVersion("postext-folio"), postextEpub: releasedVersion("postext-epub") };
  if (spec === "npm") {
    return { postext: releasedVersion("postext"), postextPdf: releasedVersion("postext-pdf"), postextCiteproc: releasedVersion("postext-citeproc"), ...own, source: "npm" };
  }
  const match = /^npm@(\d+\.\d+\.\d+)$/.exec(spec);
  if (match) return { postext: match[1], postextPdf: match[1], postextCiteproc: match[1], ...own, source: "npm" };
  if (spec === "local") {
    return { postext: releasedVersion("postext"), postextPdf: releasedVersion("postext-pdf"), postextCiteproc: releasedVersion("postext-citeproc"), ...own, source: "local" };
  }
  throw new Error(`--engine expects npm, npm@x.y.z or local, not "${spec}"`);
}

/**
 * The configuration forced on every build of a run: the JSON object of
 * `COOKBOOK_FORCE_CONFIG`, merged key by key over each configuration a pen
 * builds with (`{"bodyText":{"shapingLanguage":"host"}}` lays every recipe
 * out in the host's language, as postext 1.29.2 did by default and as a
 * stored document still is, #770; `"document"` in its own, the default
 * from 1.30), or null. Such a run shows what the recipes would do under a
 * setting none of them names; it is never written as a capture
 * (capture.ts).
 */
export function forcedConfig(raw: string | undefined = process.env.COOKBOOK_FORCE_CONFIG): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`COOKBOOK_FORCE_CONFIG is not JSON: ${(error as Error).message}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("COOKBOOK_FORCE_CONFIG expects a JSON object");
  return value as Record<string, unknown>;
}

/** The recorder's `forced(config)`: the run's forced values over a pen's
 *  configuration, the configuration as given when none is forced. */
function forcedModule(force: Record<string, unknown> | null): string {
  return `
const FORCED = ${JSON.stringify(force)};
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function merged(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = isRecord(value) && isRecord(out[key]) ? merged(out[key], value) : value;
  return out;
}
export function forced(config) { return FORCED ? merged(config ?? {}, FORCED) : config; }
`;
}

/** Specifiers a pen may import → the shim that serves them. A maths recipe
 *  imports the engine from either of the first two (`?bundle` was required
 *  up to postext 1.4); both shims start MathJax through `initMathEngine`. */
export const SHIM_PATHS = {
  "https://esm.sh/postext": "/__shim/postext.js",
  "https://esm.sh/postext?bundle": "/__shim/postext-bundle.js",
  "https://esm.sh/postext/worker": "/__shim/postext-worker.js",
  "https://esm.sh/postext-pdf": "/__shim/postext-pdf.js",
  "https://esm.sh/postext-citeproc": "/__shim/postext-citeproc.js",
  "https://esm.sh/postext-folio": "/__shim/postext-folio.js",
  "https://esm.sh/postext-epub": "/__shim/postext-epub.js",
  "https://esm.sh/postext-epub/worker": "/__shim/postext-epub-worker.js",
} as const;

/** Where the local engine's modules are served (`packages/<name>/dist`). */
export const LOCAL_PREFIX = "/__local/";

/** The version of `dep` a workspace package installed. */
function installedVersion(pkg: string, dep: string): string {
  const file = path.join(REPO_DIR, "packages", pkg, "node_modules", dep, "package.json");
  return (JSON.parse(fs.readFileSync(file, "utf-8")) as { version: string }).version;
}

let localImportsMemo: Record<string, string> | null = null;

/** The local engine's bare imports: the workspace packages to the pen
 *  server, their dependencies to esm.sh at the installed versions. The
 *  server writes them into each module of `dist` it serves
 *  (`rewriteBareImports`), so a page and a worker resolve the same URLs and
 *  the import map carries none of them (#742). MathJax is not among them:
 *  esm.sh builds each `mathjax-full/js/…` subpath with a private copy of
 *  MathJax's core and no formula converts, so the pen server answers the
 *  engine's MathJax module with the one-module bundle the package ships
 *  (serve.ts `localMathJaxModule`, #683). Nor is HarfBuzz: postext-pdf loads
 *  `harfbuzz.wasm` with its own binding (#380), from beside its module. */
export function localImports(): Record<string, string> {
  if (localImportsMemo) return localImportsMemo;
  const esm = (pkg: string, dep: string) => `https://esm.sh/${dep}@${installedVersion(pkg, dep)}`;
  const imports: Record<string, string> = {
    postext: `${LOCAL_PREFIX}postext/index.js`,
    "postext/bundle": `${LOCAL_PREFIX}postext/bundle/index.js`,
    "postext/worker": `${LOCAL_PREFIX}postext/worker/client.js`,
    "postext-pdf": `${LOCAL_PREFIX}postext-pdf/index.js`,
    "postext-citeproc": `${LOCAL_PREFIX}postext-citeproc/index.js`,
    "postext-citeproc/register": `${LOCAL_PREFIX}postext-citeproc/register.js`,
    "postext-epub": `${LOCAL_PREFIX}postext-epub/index.js`,
    "postext-epub/worker": `${LOCAL_PREFIX}postext-epub/worker/client.js`,
    "postext-folio": `${LOCAL_PREFIX}postext-folio/index.js`,
  };
  for (const dep of ["@chenglou/pretext", "fflate", "gray-matter", "hypher", "react"]) imports[dep] = esm("postext", dep);
  for (const lang of ["ca", "de", "en-us", "es", "fr", "it", "nl", "pt"]) imports[`hyphenation.${lang}`] = esm("postext", `hyphenation.${lang}`);
  for (const dep of ["@pdf-lib/fontkit", "@pdf-lib/upng", "jpeg-js", "pdf-lib"]) imports[dep] = esm("postext-pdf", dep);
  imports.citeproc = esm("postext-citeproc", "citeproc");
  imports.three = esm("postext-folio", "three");
  // Its post-processing passes (SMAA): three's own example modules.
  imports["three/"] = `${esm("postext-folio", "three")}/`;
  // The viewer's HLS player, imported when a page holds a stream.
  imports["hls.js"] = esm("postext-folio", "hls.js");
  localImportsMemo = imports;
  return imports;
}

/** What a bare specifier resolves to in `imports`, as an import map would:
 *  its own entry, else the longest prefix entry ending in `/`. Null for a
 *  relative or absolute specifier, a URL, and a bare one with no entry. */
export function resolveBare(specifier: string, imports: Record<string, string>): string | null {
  if (/^[./]/.test(specifier) || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) return null;
  if (Object.hasOwn(imports, specifier)) return imports[specifier]!;
  let best: string | null = null;
  for (const prefix of Object.keys(imports)) {
    if (prefix.endsWith("/") && specifier.startsWith(prefix) && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? imports[best] + specifier.slice(best.length) : null;
}

// `import … from 'x'` and `export … from 'x'` (the clause holds no quote
// and no semicolon), `import 'x'`, and `import('x')` with a literal.
const FROM_CLAUSE = /(\b(?:import|export)\b[^'"`;]*?\bfrom\s*)(['"])([^'"\n]+)\2/g;
const SIDE_EFFECT = /(^|[;\n}])(\s*import\s*)(['"])([^'"\n]+)\3/g;
const DYNAMIC = /(\bimport\s*\(\s*)(['"])([^'"\n]+)\2(\s*[,)])/g;

/**
 * A module of the local engine with its bare imports written as the URLs
 * `imports` gives them (#742). `tsc` keeps the specifiers of the source:
 * the page used to resolve them through its import map, which a module
 * worker does not have, so a worker recipe's `layout.worker.js` failed on
 * its first bare import ("Worker error"). A relative import, a URL and a
 * specifier with no entry are left as they are.
 */
export function rewriteBareImports(source: string, imports: Record<string, string> = localImports()): string {
  const to = (specifier: string) => resolveBare(specifier, imports) ?? specifier;
  return source
    .replace(FROM_CLAUSE, (_, head: string, quote: string, specifier: string) => `${head}${quote}${to(specifier)}${quote}`)
    .replace(SIDE_EFFECT, (_, before: string, head: string, quote: string, specifier: string) => `${before}${head}${quote}${to(specifier)}${quote}`)
    .replace(DYNAMIC, (_, head: string, quote: string, specifier: string, tail: string) => `${head}${quote}${to(specifier)}${quote}${tail}`);
}

/** The first postext-pdf that decodes WOFF2 with a binding of its own
 *  (#1092) and no longer imports wawoff2. */
export const OWN_WOFF2_SINCE = "1.50.0";

/** postext-pdf's own WOFF2 decoder as published: a self-contained module
 *  (the WebAssembly embedded, no environment branch) whose default export
 *  builds the decoder. An immutable release, so every run gets the same. */
export const WOFF2_BINDING_URL = `https://esm.sh/postext-pdf@${OWN_WOFF2_SINCE}/dist/woff2Binding.js`;

/**
 * The URLs at which esm.sh's builds of postext-pdf before 1.50 import
 * wawoff2 (#1093). Every release a recipe pins, from 1.25.0 to 1.49.x, with
 * and without `?deps=postext@…`, imports this one module (the browser
 * resolves it with the caret percent-encoded; the import map's key is
 * normalized the same way). wawoff2's emscripten glue takes its web branch
 * since esm.sh's `process` polyfill stopped naming a Node version, and its
 * `decompress()` never resolves, so a pen run on such a release waits for
 * its PDF until C14 gives up. An import map applies to every module of the
 * page, esm.sh's included: this entry sends wawoff2 to {@link WAWOFF2_SHIM},
 * which answers with the decoder 1.50 ships, and the layout stays the
 * pinned release's.
 */
export const WAWOFF2_IMPORTS: readonly string[] = ["https://esm.sh/wawoff2@^2.0.1?target=es2022"];

/** The shim that answers {@link WAWOFF2_IMPORTS}. */
export const WAWOFF2_SHIM = "/__shim/wawoff2.js";

/** wawoff2's `decompress` (what postext-pdf up to 1.49 calls) over the
 *  binding postext-pdf 1.50 ships, built once on the first font. The
 *  caller copies the bytes out and serializes the calls. */
export function wawoff2Shim(binding: string = WOFF2_BINDING_URL): string {
  return `// wawoff2's API over postext-pdf's own WOFF2 decoder (#1093).
import instantiateWoff2 from '${binding}';
let runtime = null;
export async function decompress(input) {
  runtime ??= instantiateWoff2();
  const out = (await runtime).decompress(input);
  if (out === false) throw new Error('WOFF2 decoder: ConvertWOFF2ToTTF failed');
  return out;
}
export async function compress() {
  throw new Error('WOFF2 compression is not available on the capture page');
}
export default { decompress, compress };
`;
}

/** The page's import map: the pen's own `https://esm.sh/…` imports to the
 *  shims, on either engine, and the wawoff2 module of postext-pdf before
 *  1.50 to {@link WAWOFF2_SHIM}. The local engine's bare imports are
 *  resolved by the server instead (`rewriteBareImports`). */
export function importMap(): Record<string, string> {
  const imports: Record<string, string> = { ...SHIM_PATHS };
  for (const url of WAWOFF2_IMPORTS) imports[url] = WAWOFF2_SHIM;
  return imports;
}

export function importMapTag(): string {
  return `<script type="importmap">${JSON.stringify({ imports: importMap() })}</script>`;
}

/** Shared by every shim: the record in `window.__cb`. */
const RECORDER = `// The capture's record of what the pen did with the engine.
export const cb = (window.__cb ??= {
  builds: [], images: [], engines: {}, pending: 0, lastBuildAt: 0, importedAt: 0,
  pdf: null, pdfError: null, pdfMs: 0, fontFailures: [],
  // Every EPUB the pen writes (shim postext-epub.js, check C30).
  epubs: [],
  // For the Sandbox bundle (probe sandboxBundle): what each registered
  // fileId was drawn from, the files handed to createBundle, the blob each
  // ImageBitmap was decoded from and the faces built from bytes.
  imageSources: new Map(), bundleFiles: new Map(), bitmapBlobs: new WeakMap(), faces: [],
});
cb.importedAt ||= performance.now();
const known = (cb.known ??= new WeakSet());

// A photo reaches registerResourceImage as an ImageBitmap: remember the
// blob it came from, so the bundle carries the original bytes.
if (typeof window.createImageBitmap === 'function' && !window.createImageBitmap.__cb) {
  const decode = window.createImageBitmap.bind(window);
  const wrapped = function (source, ...rest) {
    return decode(source, ...rest).then((bitmap) => {
      if (typeof Blob !== 'undefined' && source instanceof Blob) cb.bitmapBlobs.set(bitmap, source);
      return bitmap;
    });
  };
  wrapped.__cb = true;
  window.createImageBitmap = wrapped;
}

// A face built from bytes (a recipe's own font files, not Fontsource URLs).
if (typeof window.FontFace === 'function' && !window.FontFace.__cb) {
  const RealFontFace = window.FontFace;
  const Recorded = function FontFace(family, source, descriptors) {
    const face = new RealFontFace(family, source, descriptors);
    if (source && typeof source !== 'string') {
      try {
        const bytes = ArrayBuffer.isView(source)
          ? new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength))
          : new Uint8Array(source.slice(0));
        cb.faces.push({ family: String(family).replace(/^['"]|['"]$/g, ''), weight: String(descriptors?.weight ?? '400'),
          style: String(descriptors?.style ?? 'normal'), bytes });
      } catch { /* not bytes we can copy */ }
    }
    return face;
  };
  Recorded.prototype = RealFontFace.prototype;
  Recorded.__cb = true;
  window.FontFace = Recorded;
}

/** The faces loaded when a layout starts ([family, weight, style,
 *  unicodeRange]): the probe tells a CJK file that loaded after the layout
 *  (measured in a fallback face) from one the layout used. */
function loadedFaces() {
  const out = [];
  if (typeof document === 'undefined') return null;
  for (const face of document.fonts) {
    if (face.status === 'loaded') out.push([face.family.replace(/^['"]|['"]$/g, ''), face.weight, face.style, face.unicodeRange]);
  }
  return out;
}

/** A finished build: { kind, shim, content, config, docs, ms, at }. */
export function record(entry) {
  if (!('fonts' in entry)) entry.fonts = cb.fontsAtBegin ?? null;
  entry.index = cb.builds.length;
  for (const doc of entry.docs) if (doc && typeof doc === 'object') known.add(doc);
  cb.builds.push(entry);
  cb.lastBuildAt = performance.now();
  return entry;
}

export function begin() { cb.pending++; cb.fontsAtBegin = loadedFaces(); return performance.now(); }
export function end() { cb.pending = Math.max(0, cb.pending - 1); cb.lastBuildAt = performance.now(); }

/** A document painted without a recorded build (a worker's, H6). */
export function seen(doc, shim) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.pages) || known.has(doc)) return;
  record({ kind: 'rendered', shim, content: null, config: null, docs: [doc], ms: 0, at: performance.now(), fonts: null });
}
`;

function engineShim(name: string, url: string): string {
  return `export * from '${url}';
import * as real from '${url}';
import { cb, record, begin, end, seen, forced } from '/__shim/recorder.js';
const SHIM = ${JSON.stringify(name)};
cb.engines[SHIM] = real;

export function buildDocument(content, config, cache, options) {
  config = forced(config);
  const t0 = begin();
  try {
    const doc = real.buildDocument(content, config, cache, options);
    record({ kind: 'document', shim: SHIM, content, config, docs: [doc], ms: performance.now() - t0, at: t0 });
    return doc;
  } finally { end(); }
}

// The engine's font preparation around a build (#629): recorded as the
// document it returns, with the faces loaded when its last build ran.
// Its time is the passes of its last build (font loading left out).
export async function buildDocumentWithFonts(content, config, options) {
  config = forced(config);
  const started = performance.now();
  let ms = 0;
  const onPass = (info) => {
    if (info.pass === 1 && info.tocRound === 0) ms = 0;
    ms += info.ms;
    options?.onPass?.(info);
  };
  cb.pending++;
  let doc;
  try { doc = await real.buildDocumentWithFonts(content, config, { ...options, onPass }); } finally { cb.pending = Math.max(0, cb.pending - 1); }
  begin();
  end();
  record({ kind: 'document', shim: SHIM, content, config, docs: [doc], ms, at: started });
  return doc;
}

export function buildBundle(bundle, options) {
  if (forced(null)) options = { ...options, config: forced(options?.config ?? bundle?.config) };
  const t0 = begin();
  const done = (docs) => {
    record({ kind: 'bundle', shim: SHIM, content: bundle, config: options?.config ?? bundle?.config,
      docs: [...docs], ms: performance.now() - t0, at: t0 });
    return docs;
  };
  let out;
  try { out = real.buildBundle(bundle, options); } catch (error) { end(); throw error; }
  if (out && typeof out.then === 'function') {
    return out.then((docs) => { end(); return done(docs); }, (error) => { end(); throw error; });
  }
  end();
  return done(out);
}

export function registerResourceImage(fileId, image, options) {
  cb.images.push(fileId);
  cb.imageSources.set(fileId, image);
  return real.registerResourceImage(fileId, image, options);
}

export function createBundle(input, ...rest) {
  try {
    const files = input?.files instanceof Map ? input.files : Object.entries(input?.files ?? {});
    for (const [fileId, data] of files) cb.bundleFiles.set(fileId, data);
  } catch { /* the engine reports a bad input itself */ }
  return real.createBundle(input, ...rest);
}

export function renderPageToCanvas(page, doc, canvas, options) { seen(doc, SHIM); return real.renderPageToCanvas(page, doc, canvas, options); }
export function renderPage(page, doc, ...rest) { seen(doc, SHIM); return real.renderPage(page, doc, ...rest); }
export function renderToCanvas(doc, ...rest) { seen(doc, SHIM); return real.renderToCanvas(doc, ...rest); }
export function renderToHtml(doc, ...rest) { seen(doc, SHIM); return real.renderToHtml(doc, ...rest); }
`;
}

function workerShim(url: string): string {
  return `export * from '${url}';
import * as real from '${url}';
import { record, begin, end, forced } from '/__shim/recorder.js';

/** The worker client's build() is recorded like buildDocument (H6). */
export function createLayoutWorker(...args) {
  const client = real.createLayoutWorker(...args);
  const build = client.build;
  client.build = function (content, config, options) {
    config = forced(config);
    const t0 = begin();
    return build.call(this, content, config, options).then((doc) => {
      end();
      if (doc) record({ kind: 'worker', shim: 'postext', content, config, docs: [doc], ms: performance.now() - t0, at: t0, fonts: null });
      return doc;
    }, (error) => { end(); throw error; });
  };
  return client;
}
`;
}

/** `date`: the date the capture gives a PDF whose pen sets none (#734), so
 *  a recapture with an unchanged layout writes the same bytes. A pen on a
 *  postext-pdf without the option ignores it. */
function pdfShim(url: string, date: string | null = null): string {
  return `export * from '${url}';
import * as real from '${url}';
import { cb } from '/__shim/recorder.js';
const DATE = ${JSON.stringify(date)};

export async function renderToPdf(input, options = {}) {
  const provider = options.fontProvider;
  const fontProvider = provider && (async (...face) => {
    try {
      return await provider(...face);
    } catch (error) {
      cb.fontFailures.push(face.join(' ') + ': ' + (error?.message ?? error));
      throw error;
    }
  });
  // A PDF shaped without HarfBuzz reaches the console (check C14) even
  // when the pen keeps its warnings to itself.
  const onWarning = options.onWarning && ((w) => {
    if (w.kind === 'complexShapingUnavailable') console.warn(w.message);
    options.onWarning(w);
  });
  const t0 = performance.now();
  try {
    const dated = DATE && options.date === undefined ? { date: DATE } : {};
    const bytes = await real.renderToPdf(input, { ...dated, ...options, fontProvider, ...(onWarning ? { onWarning } : {}) });
    cb.pdf = bytes;
    cb.pdfMs = performance.now() - t0;
    return bytes;
  } catch (error) {
    cb.pdfError = String(error?.stack ?? error);
    throw error;
  }
}
`;
}

/** renderToEpub recorded: each file the pen writes is read back with the
 *  package's own readEpub, as a reading system opens it (check C30). */
function epubShim(url: string): string {
  return `export * from '${url}';
import * as real from '${url}';
import { cb } from '/__shim/recorder.js';

export async function renderToEpub(docs, options = {}) {
  const entry = { layout: options.layout ?? null, bytes: 0, ms: 0, documents: 0, pages: 0, toc: 0,
    readLayout: null, warnings: [], error: null };
  cb.epubs.push(entry);
  const onWarning = (w) => {
    entry.warnings.push(w.kind + ': ' + (w.fileId ?? w.family ?? w.detail ?? ''));
    options.onWarning?.(w);
  };
  const t0 = performance.now();
  let bytes;
  try {
    bytes = await real.renderToEpub(docs, { ...options, onWarning });
  } catch (error) {
    entry.error = String(error?.stack ?? error);
    throw error;
  }
  entry.ms = performance.now() - t0;
  entry.bytes = bytes.length;
  try {
    const book = real.readEpub(bytes);
    Object.assign(entry, { documents: book.spine.length, pages: book.pageList.length, toc: book.toc.length, readLayout: book.layout });
  } catch (error) {
    entry.error = 'readEpub: ' + String(error?.message ?? error);
  }
  return bytes;
}
`;
}

/** createEpubWorker recorded: each file its handle writes is read back
 *  with the package's readEpub (`main`), as renderToEpub's are (check C30). */
function epubWorkerShim(url: string, main: string): string {
  return `export * from '${url}';
import * as real from '${url}';
import { readEpub } from '${main}';
import { cb } from '/__shim/recorder.js';

export function createEpubWorker(...args) {
  const handle = real.createEpubWorker(...args);
  const render = handle.render;
  handle.render = async function (docs, options = {}) {
    const entry = { layout: options.layout ?? null, bytes: 0, ms: 0, documents: 0, pages: 0, toc: 0,
      readLayout: null, warnings: [], error: null, worker: true };
    cb.epubs.push(entry);
    const onWarning = (w) => {
      entry.warnings.push(w.kind + ': ' + (w.fileId ?? w.family ?? w.detail ?? ''));
      options.onWarning?.(w);
    };
    const t0 = performance.now();
    let bytes;
    try {
      bytes = await render.call(this, docs, { ...options, onWarning });
    } catch (error) {
      entry.error = String(error?.stack ?? error);
      throw error;
    }
    entry.ms = performance.now() - t0;
    entry.bytes = bytes.length;
    try {
      const book = readEpub(bytes);
      Object.assign(entry, { documents: book.spine.length, pages: book.pageList.length, toc: book.toc.length, readLayout: book.layout });
    } catch (error) {
      entry.error = 'readEpub: ' + String(error?.message ?? error);
    }
    return bytes;
  };
  return handle;
}
`;
}

/** The date a recipe's captured PDFs carry: the day it was written
 *  (`recipe.json` `created`), at 00:00 UTC. It never changes for a recipe,
 *  and a reader who opens the PDF's properties sees that day. */
export function pdfDateOf(created: string | undefined): string | null {
  return created && /^\d{4}-\d{2}-\d{2}$/.test(created) ? `${created}T00:00:00Z` : null;
}

/** The shim modules of one run, keyed by the path the server answers.
 *  `pdfDate`: see {@link pdfDateOf}. */
export function shimModules(engine: EngineSpec, { pdfDate = null, force = forcedConfig() }: { pdfDate?: string | null; force?: Record<string, unknown> | null } = {}): Record<string, string> {
  const V = engine.postext;
  const P = engine.postextPdf;
  const recorder = RECORDER + forcedModule(force);
  if (engine.source === "local") {
    const local = (file: string) => `${LOCAL_PREFIX}${file}`;
    return {
      "/__shim/recorder.js": recorder,
      // The working tree's postext-pdf decodes WOFF2 itself and never asks for this.
      [WAWOFF2_SHIM]: wawoff2Shim(),
      "/__shim/postext.js": engineShim("postext", local("postext/index.js")),
      "/__shim/postext-bundle.js": engineShim("postext-bundle", local("postext/index.js")),
      "/__shim/postext-worker.js": workerShim(local("postext/worker/client.js")),
      "/__shim/postext-pdf.js": pdfShim(local("postext-pdf/index.js"), pdfDate),
      "/__shim/postext-citeproc.js": `export * from '${local("postext-citeproc/index.js")}';\n`,
      "/__shim/postext-folio.js": `export * from '${local("postext-folio/index.js")}';\n`,
      "/__shim/postext-epub.js": epubShim(local("postext-epub/index.js")),
      "/__shim/postext-epub-worker.js": epubWorkerShim(local("postext-epub/worker/client.js"), local("postext-epub/index.js")),
    };
  }
  return {
    "/__shim/recorder.js": recorder,
    [WAWOFF2_SHIM]: wawoff2Shim(),
    "/__shim/postext.js": engineShim("postext", `https://esm.sh/postext@${V}`),
    "/__shim/postext-bundle.js": engineShim("postext-bundle", `https://esm.sh/postext@${V}?bundle`),
    "/__shim/postext-worker.js": workerShim(`https://esm.sh/postext@${V}/worker`),
    "/__shim/postext-pdf.js": pdfShim(`https://esm.sh/postext-pdf@${P}?deps=postext@${V}`, pdfDate),
    "/__shim/postext-citeproc.js": `export * from 'https://esm.sh/postext-citeproc@${engine.postextCiteproc}?deps=postext@${V}';\n`,
    "/__shim/postext-folio.js": `export * from 'https://esm.sh/postext-folio@${engine.postextFolio}?deps=postext@${V}';\n`,
    "/__shim/postext-epub.js": epubShim(`https://esm.sh/postext-epub@${engine.postextEpub}?deps=postext@${V}`),
    "/__shim/postext-epub-worker.js": epubWorkerShim(
      `https://esm.sh/postext-epub@${engine.postextEpub}/worker?deps=postext@${V}`,
      `https://esm.sh/postext-epub@${engine.postextEpub}?deps=postext@${V}`,
    ),
  };
}
