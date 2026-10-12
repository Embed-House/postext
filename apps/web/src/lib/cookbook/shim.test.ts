import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCapture, runSandboxOnly } from "../../../scripts/cookbook/capture.ts";
import { SHIM_PATHS, forcedConfig, importMapTag, localImports, resolveBare, resolveEngine, rewriteBareImports, shimModules } from "../../../scripts/cookbook/shim.ts";
import { POSTEXT_EPUB_URL, POSTEXT_EPUB_WORKER_URL, POSTEXT_FOLIO_URL, isEngineUrl } from "./detect.ts";
import { ALLOWED_IMPORTS } from "./lint.ts";
import { REPO_DIR } from "./paths.ts";

// The capture page's import map: every module a pen may import has a shim.

const version = (pkg: string) =>
  (JSON.parse(fs.readFileSync(path.join(REPO_DIR, "packages", pkg, "package.json"), "utf-8")) as { version: string }).version;

describe("capture shims", () => {
  it("serve every allowed import", () => {
    expect(Object.keys(SHIM_PATHS).sort()).toEqual([...ALLOWED_IMPORTS].sort());
    for (const url of ALLOWED_IMPORTS) if (url !== "https://esm.sh/postext?bundle") expect(isEngineUrl(url)).toBe(true);
  });

  it("pin postext-epub to its package version and record what it writes (#404)", () => {
    const npm = resolveEngine("npm");
    expect(npm.postextEpub).toBe(version("postext-epub"));
    expect(resolveEngine("npm@1.20.0").postextEpub).toBe(version("postext-epub"));
    const shim = shimModules(npm)["/__shim/postext-epub.js"];
    expect(shim).toContain(`https://esm.sh/postext-epub@${npm.postextEpub}?deps=postext@${npm.postext}`);
    expect(shim).toContain("export async function renderToEpub(docs, options = {})");
    expect(shim).toContain("real.readEpub(bytes)");
    expect(shimModules(resolveEngine("local"))["/__shim/postext-epub.js"]).toContain("'/__local/postext-epub/index.js'");
    expect(importMapTag()).toContain(`"${POSTEXT_EPUB_URL}":"/__shim/postext-epub.js"`);
    expect(importMapTag()).toContain(`"${POSTEXT_FOLIO_URL}":"/__shim/postext-folio.js"`);
  });

  it("serve postext-epub/worker and record what its handle writes (#406)", () => {
    const npm = resolveEngine("npm");
    const shim = shimModules(npm)["/__shim/postext-epub-worker.js"];
    expect(shim).toContain(`https://esm.sh/postext-epub@${npm.postextEpub}/worker?deps=postext@${npm.postext}`);
    expect(shim).toContain("export function createEpubWorker(...args)");
    expect(shim).toContain("readEpub(bytes)");
    expect(shimModules(resolveEngine("local"))["/__shim/postext-epub-worker.js"]).toContain("'/__local/postext-epub/worker/client.js'");
    expect(importMapTag()).toContain(`"${POSTEXT_EPUB_WORKER_URL}":"/__shim/postext-epub-worker.js"`);
  });
});

// A run can force a configuration on every build (COOKBOOK_FORCE_CONFIG):
// the paint check of #764 lays the recipes out under
// `bodyText.shapingLanguage: 'document'`, which no pen names.
describe("a forced configuration", () => {
  const FORCE = { bodyText: { shapingLanguage: "document" } };

  it("is the JSON object of COOKBOOK_FORCE_CONFIG, or none", () => {
    expect(forcedConfig(undefined)).toBeNull();
    expect(forcedConfig("  ")).toBeNull();
    expect(forcedConfig(JSON.stringify(FORCE))).toEqual(FORCE);
    expect(() => forcedConfig("{bodyText")).toThrow(/COOKBOOK_FORCE_CONFIG is not JSON/);
    expect(() => forcedConfig("[1]")).toThrow(/expects a JSON object/);
    expect(() => forcedConfig("3")).toThrow(/expects a JSON object/);
  });

  /** The recorder's `forced` of a run, taken out of the module's text. */
  const forcedOf = (force: Record<string, unknown> | null): ((config: unknown) => unknown) => {
    const recorder = shimModules(resolveEngine("npm"), { force })["/__shim/recorder.js"]!;
    const tail = recorder.slice(recorder.indexOf("const FORCED")).replace("export function forced", "function forced");
    return new Function(`${tail}; return forced;`)() as (config: unknown) => unknown;
  };

  it("is merged key by key over each configuration a pen builds with", () => {
    const forced = forcedOf(FORCE);
    const config = { locale: "ar", bodyText: { fontFamily: "Amiri", hyphenation: { enabled: false } } };
    expect(forced(config)).toEqual({ locale: "ar", bodyText: { fontFamily: "Amiri", hyphenation: { enabled: false }, shapingLanguage: "document" } });
    // The pen's own object is left as it is.
    expect(config.bodyText).not.toHaveProperty("shapingLanguage");
    expect(forced(undefined)).toEqual(FORCE);
    expect(forced({ bodyText: { shapingLanguage: "host" } })).toEqual(FORCE);
  });

  it("leaves a configuration as given when none is forced", () => {
    const config = { locale: "ar" };
    expect(forcedOf(null)(config)).toBe(config);
    expect(forcedOf(null)(undefined)).toBeUndefined();
  });

  it("reaches buildDocument, buildDocumentWithFonts, buildBundle and the worker client's build", () => {
    const shims = shimModules(resolveEngine("local"), { force: FORCE });
    const engine = shims["/__shim/postext.js"]!;
    expect(engine.match(/config = forced\(config\);/g)).toHaveLength(2);
    expect(engine).toContain("config: forced(options?.config ?? bundle?.config)");
    expect(shims["/__shim/postext-worker.js"]).toContain("config = forced(config);");
    expect(shims["/__shim/recorder.js"]).toContain(`const FORCED = ${JSON.stringify(FORCE)};`);
  });

  it("is never captured: a run that would write stops", async () => {
    const before = process.env.COOKBOOK_FORCE_CONFIG;
    process.env.COOKBOOK_FORCE_CONFIG = JSON.stringify(FORCE);
    try {
      await expect(runCapture({ slugs: ["no-such-recipe"] })).rejects.toThrow(/COOKBOOK_FORCE_CONFIG is set: a forced configuration is never captured/);
      await expect(runSandboxOnly({ slugs: ["no-such-recipe"] })).rejects.toThrow(/COOKBOOK_FORCE_CONFIG is set/);
    } finally {
      if (before === undefined) delete process.env.COOKBOOK_FORCE_CONFIG;
      else process.env.COOKBOOK_FORCE_CONFIG = before;
    }
  });
});

// The local engine's bare imports (#742). `tsc` keeps the specifiers of the
// source; the page resolved them through its import map, which a module
// worker does not have: `web-worker-live-editor` failed with "Worker error"
// on `--engine local`. The pen server writes them as URLs instead.

describe("the local engine's bare imports (#742)", () => {
  const imports = {
    postext: "/__local/postext/index.js",
    "postext/worker": "/__local/postext/worker/client.js",
    "postext-citeproc/register": "/__local/postext-citeproc/register.js",
    fflate: "https://esm.sh/fflate@0.8.3",
    three: "https://esm.sh/three@0.186.1",
    "three/": "https://esm.sh/three@0.186.1/",
  };

  it("resolve as an import map would", () => {
    expect(resolveBare("postext", imports)).toBe("/__local/postext/index.js");
    expect(resolveBare("postext/worker", imports)).toBe("/__local/postext/worker/client.js");
    expect(resolveBare("three/examples/jsm/postprocessing/SMAAPass.js", imports)).toBe("https://esm.sh/three@0.186.1/examples/jsm/postprocessing/SMAAPass.js");
    // No entry, relative, absolute, a URL: not the server's to resolve.
    expect(resolveBare("postext/word", imports)).toBeNull();
    expect(resolveBare("./layout.js", imports)).toBeNull();
    expect(resolveBare("../measure/rich.js", imports)).toBeNull();
    expect(resolveBare("/__shim/recorder.js", imports)).toBeNull();
    expect(resolveBare("https://esm.sh/postext", imports)).toBeNull();
    expect(resolveBare("node:fs", imports)).toBeNull();
  });

  it("are written as URLs in every import form, and nothing else is touched", () => {
    const source = [
      "import { unzipSync, zipSync } from 'fflate';",
      'import * as THREE from "three";',
      "import {\n  buildDocument,\n  type Ignored,\n} from 'postext';",
      "export { createLayoutWorker } from 'postext/worker';",
      "export * from 'postext';",
      "import 'fflate';",
      "import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';",
      "import { pipeline } from './pipeline.js';",
      "import { rich } from '../measure/rich';",
      "import { known } from 'not-in-the-map';",
      "const hook = () => import('postext-citeproc/register').catch(() => null);",
      'const lazy = await import("fflate");',
      "const other = import(name);",
      "const from = Array.from('abc');",
    ].join("\n");
    expect(rewriteBareImports(source, imports).split("\n")).toEqual([
      "import { unzipSync, zipSync } from 'https://esm.sh/fflate@0.8.3';",
      'import * as THREE from "https://esm.sh/three@0.186.1";',
      "import {",
      "  buildDocument,",
      "  type Ignored,",
      "} from '/__local/postext/index.js';",
      "export { createLayoutWorker } from '/__local/postext/worker/client.js';",
      "export * from '/__local/postext/index.js';",
      "import 'https://esm.sh/fflate@0.8.3';",
      "import { SMAAPass } from 'https://esm.sh/three@0.186.1/examples/jsm/postprocessing/SMAAPass.js';",
      "import { pipeline } from './pipeline.js';",
      "import { rich } from '../measure/rich';",
      "import { known } from 'not-in-the-map';",
      "const hook = () => import('/__local/postext-citeproc/register.js').catch(() => null);",
      'const lazy = await import("https://esm.sh/fflate@0.8.3");',
      "const other = import(name);",
      "const from = Array.from('abc');",
    ]);
  });

  it("cover what the built packages import, at the installed versions", () => {
    const map = localImports();
    for (const name of ["postext", "postext/bundle", "postext/worker", "postext-pdf", "postext-citeproc/register", "postext-epub", "postext-folio"]) {
      expect(map[name], name).toMatch(/^\/__local\/postext[\w-]*\/.+\.js$/);
    }
    for (const name of ["@chenglou/pretext", "fflate", "gray-matter", "hypher", "hyphenation.es", "pdf-lib", "citeproc", "three"]) {
      expect(map[name], name).toMatch(/^https:\/\/esm\.sh\/.+@\d+\.\d+\.\d+/);
    }
    // The layout worker's own source: every bare import it has resolves.
    const worker = fs.readFileSync(path.join(REPO_DIR, "packages", "postext", "src", "worker", "layout.worker.ts"), "utf-8");
    for (const [, specifier] of worker.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      if (!specifier!.startsWith(".")) expect(resolveBare(specifier!, map), specifier).not.toBeNull();
    }
  });

  it("are no longer the page's business: the import map holds the pen's own imports only", () => {
    const map = JSON.parse(/<script type="importmap">(.+)<\/script>/.exec(importMapTag())![1]!) as { imports: Record<string, string> };
    expect(map.imports).toEqual(SHIM_PATHS);
    // Left over from #384: postext-pdf loads harfbuzz.wasm with its own binding.
    expect(localImports().harfbuzzjs).toBeUndefined();
    expect(importMapTag()).not.toContain("harfbuzzjs");
  });
});
