/**
 * Cuts the CJK web faces for the site's own text (#1050):
 *
 *   pnpm --filter web fonts:cjk                 add what the sources hold and no slice covers
 *   pnpm --filter web fonts:cjk plan [--site U] measure the zh and ja pages and cut every slice again
 *
 * `plan` opens every zh and ja page of the sitemap (postext.dev by default,
 * or a local `next start`) in Chrome and records, per page, the characters
 * each Noto face sets. It then cuts per face: a core of the characters at
 * least {@link CORE} of the pages use, a middle tier ({@link MID}), and the
 * rest in clusters of up to {@link CLUSTER} characters, taken page by page
 * in the order a reader meets them (the landing, the docs and glossary
 * indexes, then the docs and Cookbook pages), so the rare characters of a
 * page sit together. The characters of the sources no page showed (a
 * dialog, a tooltip, a page not in the sitemap) go to extra slices.
 *
 * Without `plan` the cut is kept and the characters the sources added since
 * go to the last extra slice, or a new one when it is full: one small file
 * changes. Only the slices whose characters changed are written again.
 *
 * The sources are Google's variable cuts (every weight the site sets) from
 * github.com/google/fonts at a pinned commit, cached in apps/web/.cache.
 * Subsetting keeps every OpenType feature (`locl`, `vert`, `palt`...).
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import {
  CJK_FACES, GOOGLE_FONTS_COMMIT, cjkCorpus, cjkDir, coveredChars, isCjkFontChar, sortChars, unicodeRange,
} from "../../src/lib/cjkFonts.ts";
import type { CjkFace, CjkFaceKey, CjkManifest, CjkSlice } from "../../src/lib/cjkFonts.ts";

const WEB_DIR = process.cwd();
const OUT_DIR = cjkDir(WEB_DIR);
const CACHE_DIR = path.join(WEB_DIR, ".cache", "cjk-fonts");
const require = createRequire(import.meta.url);

/** Share of the pages a face appears on that a character must be used on
 *  to go to the core slice, and to the middle tier. */
const CORE = 0.45;
const MID = 0.14;
/** Most characters in a cluster or an extra slice. */
const CLUSTER = 150;

// ─── sources and subsetting ─────────────────────────────────────────────────

async function sourceFont(face: CjkFace): Promise<Uint8Array> {
  const file = path.join(CACHE_DIR, path.basename(face.source));
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const url = `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/${face.source.split("/").map(encodeURIComponent).join("/")}`;
    console.log(`downloading ${face.family} (${url})`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  }
  const data = new Uint8Array(fs.readFileSync(file));
  const sha = crypto.createHash("sha256").update(data).digest("hex");
  if (sha !== face.sha256) throw new Error(`${file}: SHA-256 ${sha}, expected ${face.sha256}; delete it and run again`);
  return data;
}

/** The code points a font maps (its Unicode cmap subtable, format 4 or 12). */
function cmapCodepoints(font: Uint8Array): Set<number> {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = v.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) if (v.getUint32(12 + i * 16) === 0x636d6170) cmap = v.getUint32(12 + i * 16 + 8);
  if (cmap < 0) throw new Error("no cmap table");
  const subtables = v.getUint16(cmap + 2);
  let best = -1, bestFormat = 0;
  for (let i = 0; i < subtables; i++) {
    const off = cmap + v.getUint32(cmap + 4 + i * 8 + 4);
    const format = v.getUint16(off);
    if (format === 12 || (format === 4 && bestFormat !== 12)) { best = off; bestFormat = format; }
  }
  const out = new Set<number>();
  if (bestFormat === 12) {
    const groups = v.getUint32(best + 12);
    for (let g = 0; g < groups; g++) {
      const start = v.getUint32(best + 16 + g * 12), end = v.getUint32(best + 20 + g * 12);
      for (let c = start; c <= end; c++) out.add(c);
    }
  } else if (bestFormat === 4) {
    const segs = v.getUint16(best + 6) / 2;
    for (let s = 0; s < segs; s++) {
      const end = v.getUint16(best + 14 + s * 2), start = v.getUint16(best + 16 + segs * 2 + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) out.add(c);
    }
  }
  return out;
}

interface Subsetter { subset(font: Uint8Array, chars: string): Promise<Uint8Array> }

async function subsetter(): Promise<Subsetter> {
  const wasm = fs.readFileSync(path.join(path.dirname(require.resolve("harfbuzzjs")), "harfbuzz-subset.wasm"));
  const { instance } = await WebAssembly.instantiate(wasm, {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hb = instance.exports as any;
  const woff2 = require("wawoff2") as { compress(data: Uint8Array): Promise<Uint8Array> };
  const HB_MEMORY_MODE_WRITABLE = 2;
  const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
  return {
    async subset(font, chars) {
      const ptr = hb.malloc(font.byteLength);
      new Uint8Array(hb.memory.buffer).set(font, ptr);
      const blob = hb.hb_blob_create(ptr, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
      const face = hb.hb_face_create(blob, 0);
      hb.hb_blob_destroy(blob);
      const input = hb.hb_subset_input_create_or_fail();
      const unicodes = hb.hb_subset_input_unicode_set(input);
      for (const ch of chars) hb.hb_set_add(unicodes, ch.codePointAt(0));
      // Every layout feature, not only HarfBuzz's defaults: `locl` gives
      // the Japanese and Chinese forms, `vert` and `palt` the vertical
      // and proportional ones.
      const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
      hb.hb_set_clear(features);
      hb.hb_set_invert(features);
      const result = hb.hb_subset_or_fail(face, input);
      hb.hb_subset_input_destroy(input);
      if (!result) throw new Error("hb_subset_or_fail failed");
      const out = hb.hb_face_reference_blob(result);
      const bytes = new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(out, 0), hb.hb_blob_get_length(out)).slice();
      hb.hb_blob_destroy(out);
      hb.hb_face_destroy(result);
      hb.hb_face_destroy(face);
      hb.free(ptr);
      return woff2.compress(bytes);
    },
  };
}

// ─── measuring the pages ────────────────────────────────────────────────────

/** Per face: the characters a page draws, and the ones in its hidden UI. */
type PageUsage = Partial<Record<CjkFaceKey, { shown: string; hidden: string }>>;
type Usage = Map<string, PageUsage>;

/** The order a reader meets the pages in: the landing, the docs index, the
 *  glossary, the Cookbook index, then the docs and Cookbook pages. */
function pageRank(url: string): number {
  const [, section = "", sub] = new URL(url).pathname.split("/").filter(Boolean);
  if (section === "") return 0;
  if (section === "docs") return sub ? 4 : 1;
  if (section === "glossary") return 2;
  if (section === "cookbook") return sub ? 5 : 3;
  return 6;
}

async function measure(site: string): Promise<Usage> {
  const xml = await (await fetch(`${site}/sitemap.xml`)).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => site + new URL(m[1]).pathname)
    .filter((u) => /^\/(zh|ja)(\/|$)/.test(new URL(u).pathname));
  for (const l of ["zh", "ja"]) if (!urls.includes(`${site}/${l}/sandbox`)) urls.push(`${site}/${l}/sandbox`);
  const { installedChromes } = await import("../cookbook/chrome.ts");
  const chrome = process.env.COOKBOOK_CHROME ?? installedChromes()[0];
  if (!chrome) throw new Error("no Chrome installed: set COOKBOOK_CHROME");
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const usage: Usage = new Map();
  const families = Object.fromEntries(CJK_FACES.map((f) => [f.key, f.family]));
  let next = 0;
  const worker = async () => {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (r) => (["image", "font", "media"].includes(r.resourceType()) ? r.abort() : r.continue()));
    while (next < urls.length) {
      const url = urls[next++];
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });
        // Per text node, the first CJK family in its parent's stack, and
        // whether the node is rendered: a browser loads a slice for what it
        // draws. Scripts (the RSC payload carries every client message) and
        // styles hold no text; a closed menu, a footnote pop-up or an SVG
        // <title> is drawn only when opened.
        const used = await page.evaluate((fam: Record<string, string>) => {
          const out: Record<string, { shown: string; hidden: string }> = {};
          const sets: Record<string, { shown: Set<string>; hidden: Set<string> }> = {};
          const keyOf = new Map<Element, string | null>();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            const text = n.nodeValue ?? "";
            if (!el || !/[^\u0000-\u1fff]/.test(text) || el.closest("script, style, noscript, template")) continue;
            let key = keyOf.get(el);
            if (key === undefined) {
              const stack = getComputedStyle(el).fontFamily;
              let best: string | null = null, at = Infinity;
              for (const [k, f] of Object.entries(fam)) {
                const i = stack.indexOf(f);
                if (i >= 0 && i < at) { best = k; at = i; }
              }
              keyOf.set(el, (key = best));
            }
            if (!key) continue;
            const set = (sets[key] ??= { shown: new Set(), hidden: new Set() });
            const into = el.checkVisibility({ visibilityProperty: true }) ? set.shown : set.hidden;
            for (const ch of text) into.add(ch);
          }
          for (const [k, s] of Object.entries(sets)) out[k] = { shown: [...s.shown].join(""), hidden: [...s.hidden].join("") };
          return out;
        }, families);
        usage.set(url, used as PageUsage);
      } catch (e) {
        console.warn(`  ${url}: ${(e as Error).message}`);
      }
      if (usage.size % 50 === 0) console.log(`  ${usage.size}/${urls.length} pages`);
    }
    await page.close();
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await browser.close();
  return new Map([...usage].sort(([a], [b]) => pageRank(a) - pageRank(b) || a.localeCompare(b)));
}

/** Core, middle tier and clusters for one face, from the measured pages.
 *  The tiers count drawn characters only; the hidden ones join the cluster
 *  of the first page that holds them. */
function cut(usage: Usage, key: CjkFaceKey, glyphs: Set<number>): CjkSlice[] {
  const keep = (s = "") => [...new Set(s)].filter((c) => isCjkFontChar(c.codePointAt(0)!) && glyphs.has(c.codePointAt(0)!));
  const pages = [...usage].map(([url, u]) => ({ url, shown: keep(u[key]?.shown), hidden: keep(u[key]?.hidden) }))
    .filter((p) => p.shown.length + p.hidden.length > 0);
  const drawn = pages.filter((p) => p.shown.length > 0).length;
  const df = new Map<string, number>();
  for (const p of pages) for (const c of p.shown) df.set(c, (df.get(c) ?? 0) + 1);
  const core: string[] = [], mid: string[] = [];
  for (const [c, n] of df) {
    if (n >= CORE * drawn) core.push(c);
    else if (n >= MID * drawn) mid.push(c);
  }
  const placed = new Set([...core, ...mid]);
  const clusters: string[][] = [];
  let section = "";
  for (const p of pages) {
    const s = new URL(p.url).pathname.split("/").slice(1, 4).join("/");
    const last = clusters.at(-1);
    // A new section starts a cluster unless the last one is still small.
    if (s !== section && (!last || last.length > CLUSTER / 3)) clusters.push([]);
    section = s;
    for (const c of [...p.shown, ...p.hidden]) {
      if (placed.has(c)) continue;
      if (clusters.at(-1)!.length >= CLUSTER) clusters.push([]);
      clusters.at(-1)!.push(c);
      placed.add(c);
    }
  }
  return [
    { id: "core", chars: sortChars(core) },
    ...(mid.length ? [{ id: "mid", chars: sortChars(mid) }] : []),
    ...clusters.filter((c) => c.length).map((c, i) => ({ id: `c${i + 1}`, chars: sortChars(c) })),
  ];
}

/** Adds the characters no slice covers to the extra slices. */
function addExtras(slices: CjkSlice[], missing: string[]): CjkSlice[] {
  const out = slices.map((s) => ({ ...s }));
  const queue = [...missing];
  while (queue.length) {
    let last = out.filter((s) => s.id.startsWith("x")).at(-1);
    if (!last || [...last.chars].length >= CLUSTER) {
      last = { id: `x${out.filter((s) => s.id.startsWith("x")).length + 1}`, chars: "" };
      out.push(last);
    }
    const room = CLUSTER - [...last.chars].length;
    last.chars = sortChars([...last.chars, ...queue.splice(0, room)]);
  }
  return out;
}

// ─── writing ────────────────────────────────────────────────────────────────

function fileName(face: CjkFace, slice: CjkSlice): string {
  return `${face.slug}-${slice.id}.woff2`;
}

function css(manifest: CjkManifest): string {
  const rules = [
    "/* Generated by `pnpm --filter web fonts:cjk` (scripts/fonts/cjk.ts): do not edit. */",
  ];
  for (const face of CJK_FACES) {
    for (const slice of manifest.faces[face.key].slices) {
      rules.push(
        `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};font-display:swap;` +
        `src:url("./${fileName(face, slice)}") format("woff2");unicode-range:${unicodeRange(slice.chars)}}`,
      );
    }
  }
  return rules.join("\n") + "\n";
}

async function write(next: CjkManifest, previous: CjkManifest | null) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const hb = await subsetter();
  const keep = new Set<string>();
  for (const face of CJK_FACES) {
    const before = new Map((previous?.faces[face.key]?.slices ?? []).map((s) => [s.id, s.chars]));
    let font: Uint8Array | null = null;
    for (const slice of next.faces[face.key].slices) {
      const file = fileName(face, slice);
      keep.add(file);
      if (previous?.commit === next.commit && before.get(slice.id) === slice.chars && fs.existsSync(path.join(OUT_DIR, file))) continue;
      font ??= await sourceFont(face);
      const data = await hb.subset(font, slice.chars);
      fs.writeFileSync(path.join(OUT_DIR, file), data);
      console.log(`  ${file}: ${[...slice.chars].length} characters, ${Math.round(data.byteLength / 1024)} KB`);
    }
  }
  for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith(".woff2") && !keep.has(f)) fs.rmSync(path.join(OUT_DIR, f));
  fs.writeFileSync(path.join(OUT_DIR, "cjk.css"), css(next));
  fs.writeFileSync(path.join(OUT_DIR, "cjk.json"), JSON.stringify(next, null, 1) + "\n");
}

function readPrevious(): CjkManifest | null {
  const file = path.join(OUT_DIR, "cjk.json");
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as CjkManifest) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "update";
  const siteAt = args.indexOf("--site");
  const site = (siteAt >= 0 ? args[siteAt + 1] : "https://postext.dev").replace(/\/$/, "");
  if (command !== "plan" && command !== "update") {
    console.error("usage: fonts:cjk [plan [--site <url>]]");
    process.exit(2);
  }
  const previous = readPrevious();
  if (command === "update" && !previous) throw new Error("no cjk.json yet: run `fonts:cjk plan` first");
  const usage = command === "plan" ? (console.log(`measuring the zh and ja pages of ${site}`), await measure(site)) : null;
  const next: CjkManifest = { commit: GOOGLE_FONTS_COMMIT, faces: {} as CjkManifest["faces"] };
  for (const face of CJK_FACES) {
    const glyphs = cmapCodepoints(await sourceFont(face));
    const slices = usage ? cut(usage, face.key, glyphs) : previous!.faces[face.key].slices;
    const have = new Set(slices.flatMap((s) => [...s.chars]));
    const corpus = sortChars(cjkCorpus(WEB_DIR, face));
    const missing = [...corpus].filter((c) => !have.has(c) && glyphs.has(c.codePointAt(0)!));
    const absent = [...corpus].filter((c) => !glyphs.has(c.codePointAt(0)!));
    next.faces[face.key] = { slices: addExtras(slices, missing), absent: sortChars(absent) };
    if (missing.length) console.log(`${face.family}: ${missing.length} characters added to the extra slices`);
  }
  await write(next, previous);
  for (const face of CJK_FACES) {
    const n = coveredChars(next, face.key).size;
    console.log(`${face.family}: ${next.faces[face.key].slices.length} slices, ${n} characters`);
  }
}

await main();
