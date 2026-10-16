import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectConfigWarnings, extractFrontmatter, type PostextConfig } from "postext";
import { readBundle } from "postext/bundle";

/** The postext-port skill's `preset_kit.py lint`: content text typed into the
 *  configuration fails, placeholders and allowed literals pass. The Python
 *  unit tests next to the script run here too, so CI keeps them green. */
const REPO = path.join(__dirname, "../../../..");
const SCRIPTS = path.join(REPO, "plugins/postext/skills/postext-port/scripts");
const KIT = path.join(SCRIPTS, "preset_kit.py");

const python = spawnSync("python3", ["--version"]).status === 0;

const text = (id: string, content: string) => ({
  kind: "text", id, content, placement: { anchor: { to: "page", edge: "top-left" } }, fontSize: { value: 9, unit: "pt" },
});

function manifest(config: object): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "postext-kit-"));
  const file = path.join(dir, "preset.json");
  writeFileSync(file, JSON.stringify({
    version: 2, configVersion: 14, id: "t", name: "T", locale: "en",
    chapters: [{ title: "One", file: "chapters/en/01.md" }], config, resources: [], fonts: [],
  }));
  return file;
}

describe.skipIf(!python)("postext-port preset_kit.py lint", () => {
  it("fails on a page style that holds the book's text", () => {
    const file = manifest({
      headingStyles: [{ id: "page-05", header: { elements: [text("t", "FINDING YOUR POSITION"), text("n", "{pageNumber}")] } }],
    });
    const r = spawnSync("python3", [KIT, "lint", file], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ERROR contentInConfig config.headingStyles[0] (page-05): 1 design text(s), 19 letters and digits [header]");
    expect(r.stdout).toContain("config.headingStyles[0].header.elements[0]");
  });

  it("passes on placeholders and allowed literals", () => {
    const file = manifest({
      checks: { contentInConfig: { allow: ["The Quoin Room"] } },
      header: { elements: [text("rh", "{chapterTitle}"), text("p", "The Quoin Room · {pageNumber}")] },
    });
    const r = spawnSync("python3", [KIT, "lint", file], { encoding: "utf8" });
    expect(r.stdout + r.stderr).toContain("0 hold content");
    expect(r.status).toBe(0);
  });

  it("keeps the Python unit tests green", () => {
    const r = spawnSync("python3", ["-m", "unittest", "test_preset_kit_lint"], { cwd: path.join(SCRIPTS, "tests"), encoding: "utf8" });
    expect(r.stderr).toMatch(/\nOK/);
    expect(r.status).toBe(0);
  });
});

/** What `preset_kit.py lint --json` reports per edition. */
interface LintEdition { locale: string | null; warnings: unknown[] }

function lintJson(target: string): LintEdition[] {
  const r = spawnSync("python3", [KIT, "lint", target, "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
  expect(r.stderr).toBe("");
  return (JSON.parse(r.stdout) as { editions: LintEdition[] }).editions;
}

/** The engine's `contentInConfig` warnings for one edition of a project
 *  folder, as `postext check` gets them: the bundle read in that locale,
 *  the metadata of its first chapter's front matter. Only the Markdown and
 *  the manifest are read; pictures and fonts are not measured. */
async function engineWarnings(dir: string, locale: string | null): Promise<unknown[]> {
  const manifest = JSON.parse(readFileSync(path.join(dir, "preset.json"), "utf8")) as unknown;
  const read = await readBundle(manifest, async (file) => {
    const bytes = file.endsWith(".md") ? readFileSync(path.join(dir, file)) : Buffer.alloc(0);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }, { ...(locale ? { locale } : {}), measureSvg: () => ({ width: 100, height: 100 }), measureBitmap: () => ({ width: 100, height: 100 }) });
  const metadata = read.chapters[0] ? extractFrontmatter(read.chapters[0].markdown).metadata : {};
  return contentWarnings(collectConfigWarnings(read.config, { metadata }));
}

function contentWarnings(all: readonly unknown[]): unknown[] {
  return all.filter((w) => (w as { kind: string }).kind === "contentInConfig")
    .map((w) => { const { kind: _kind, used: _used, ...rest } = w as Record<string, unknown>; return rest; });
}

const PRESETS = path.join(REPO, "apps/web/public/presets");
const presetDirs = existsSync(PRESETS)
  ? readdirSync(PRESETS).filter((d) => existsSync(path.join(PRESETS, d, "preset.json"))).map((d) => path.join(PRESETS, d))
  : [];

/** A textbook-like book with its text typed into the config: page styles
 *  holding paragraphs, a heading level's standfirst, Chinese and Japanese
 *  running heads, a contents leader, the front-matter title in a header,
 *  allowed phrases, an html viewer override, and a localized edition. */
function textbookProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "postext-kit-parity-"));
  const config = {
    checks: { contentInConfig: { allow: ["Kirkwick Press", "红楼梦"] } },
    header: { elements: [text("rh", "{chapterTitle}"), text("t", "THE SOLAN ISLES · {pageNumber}"), text("p", "Kirkwick Press · Annual report")] },
    footer: { elements: [text("f", "红楼梦第一回 甄士隐梦幻识通灵 {pageNumber}"), text("j", "第{chapterNumber}章"), text("k", "これは長い日本語の文です")] },
    headings: { levels: [{ level: 1, advancedDesign: { enabled: true, slot: { elements: [
      text("num", "Unit {chapterNumber}"), text("lead", "In this unit you will learn where the Sun rises and sets"), text("x", "{titleText}"),
    ] } } }] },
    headingStyles: [
      { id: "page-05", header: { elements: [text("a", "FINDING YOUR POSITION"), text("b", "The **compass** points north. {attr.x}"), text("c", "N"), text("d", "{not a placeholder} at all, five words")] } },
      { id: "page-06", advancedDesign: { enabled: true, slot: { elements: [text("e", "Pneumonoultramicroscopics"), text("f", "Pneumono-ultra-microscopic")] } } },
      { id: "plate", footer: { elements: [{ kind: "image", id: "bg", resourceId: "{attr.fondo}", placement: {} }] } },
    ],
    parts: { design: { elements: [text("pt", "Part {partNumber} · Living together in a town by the sea")] } },
    toc: { parts: { design: { elements: [text("lead", ".".repeat(80)), text("n", "{titleText}")] } } },
    htmlViewer: { overrides: { header: { elements: [text("h", "Read the whole chapter online today")] } } },
  };
  const manifest = {
    version: 2, configVersion: 14, id: "solan", name: "The Solan Isles · Ciencias", locale: "en",
    chapters: { en: [{ title: "One", file: "chapters/en/01.md" }], es: [{ title: "Uno", file: "chapters/es/01.md" }] },
    localized: { es: { config: { locale: "es", header: { elements: [text("t", "LAS ISLAS SOLAN · {pageNumber}"), text("p", "Kirkwick Press · Informe anual del año")] } } } },
    config, resources: [], fonts: [],
  };
  mkdirSync(path.join(dir, "chapters/en"), { recursive: true });
  mkdirSync(path.join(dir, "chapters/es"), { recursive: true });
  writeFileSync(path.join(dir, "chapters/en/01.md"), '---\ntitle: "The Solan Isles"\nauthor:\n  - Ann Reid\n---\n\n# One\n');
  writeFileSync(path.join(dir, "chapters/es/01.md"), "---\ntitle: Las islas Solan\npublisher: [Kirkwick, Otra]\n---\n\n# Uno\n");
  writeFileSync(path.join(dir, "preset.json"), JSON.stringify(manifest));
  return dir;
}

describe.skipIf(!python)("preset_kit.py lint counts like the engine's contentInConfig", () => {
  it("on a textbook-like book in two editions", async () => {
    const dir = textbookProject();
    const editions = lintJson(dir);
    expect(editions.map((e) => e.locale)).toEqual(["en", "es"]);
    for (const e of editions) expect(e.warnings).toEqual(await engineWarnings(dir, e.locale));
    // The book's text is caught, in every slot the engine reads.
    expect(editions[0]!.warnings.length).toBeGreaterThanOrEqual(6);
  });

  it("on a bare config (no metadata)", () => {
    const dir = textbookProject();
    const config = (JSON.parse(readFileSync(path.join(dir, "preset.json"), "utf8")) as { config: PostextConfig }).config;
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify(config));
    const [only] = lintJson(file);
    expect(only!.warnings).toEqual(contentWarnings(collectConfigWarnings(config)));
  });

  it.each(presetDirs.map((d) => [path.basename(d), d]))("on the public preset %s, every edition", async (_name, dir) => {
    for (const e of lintJson(dir)) expect(e.warnings).toEqual(await engineWarnings(dir, e.locale));
  });
});
