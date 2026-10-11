import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import os from "node:os";
import { localMathJaxModule, localModule, startPenServer } from "../../../scripts/cookbook/serve.ts";
import { importMapTag, localImports } from "../../../scripts/cookbook/shim.ts";
import { REPO_DIR } from "./paths.ts";

// The local engine's MathJax (#683). `pnpm build` ships the engine's
// MathJax module as one bundle; plain `tsc`, which a local-engine run is
// prepared with, writes it back with its `mathjax-full/js/…` imports. From
// esm.sh each of those subpaths is a bundle with its own copy of MathJax's
// core: every formula threw and was set as a small red box.

interface Converter {
  document: { convert(tex: string, options: object): unknown };
  adaptor: { outerHTML(node: unknown): string };
}

const MATHJAX_IMPORT = /^\s*import\b[^;]*?["']mathjax-full\//m;

describe("the local engine's MathJax module (#683)", () => {
  // What `tsc` emits for src/math/mathjax.ts keeps the imports of the source.
  const source = fs.readFileSync(path.join(REPO_DIR, "packages", "postext", "src", "math", "mathjax.ts"), "utf-8");

  it("is served as one module when dist holds the plain tsc output", async () => {
    expect(source).toMatch(MATHJAX_IMPORT);
    const code = await localMathJaxModule(source);
    expect(code).not.toMatch(MATHJAX_IMPORT);
    expect(code).not.toMatch(/\bimport\s*[\s{*("'`]/);
    const mod = (await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`)) as {
      createMathJaxConverter(): Converter;
    };
    const { document, adaptor } = mod.createMathJaxConverter();
    const svg = adaptor.outerHTML(document.convert("\\pi^\\text{SFT} = \\frac{1}{Z(x)}", { display: true, em: 16, ex: 8, containerWidth: 1280 }));
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("merror");
    // The bundle is made once per run.
    expect(await localMathJaxModule(source)).toBe(code);
  }, 60_000);

  it("is served as it is when dist holds the bundle of pnpm build", async () => {
    const bundled = "/*! MathJax 3.2.2 (mathjax-full), bundled */\nexport function createMathJaxConverter(){return null}\n";
    expect(await localMathJaxModule(bundled)).toBe(bundled);
  });

  it("is the only way the page reaches MathJax: the import map sends no subpath to a CDN", () => {
    expect(importMapTag()).not.toContain("mathjax");
    expect(Object.keys(localImports()).filter((name) => name.includes("mathjax"))).toEqual([]);
  });
});

// HarfBuzz on the local engine (#742). postext-pdf fetches `harfbuzz.wasm`
// from beside its module; `pnpm build` copies it into `dist`, plain `tsc`
// does not, and the next place the binding tries is a jsDelivr path the
// capture blocks: every PDF with Arabic text failed C3 on such a dist.

describe("the local engine's files (#742)", () => {
  const stand = () => {
    const packages = fs.mkdtempSync(path.join(os.tmpdir(), "cookbook-serve-"));
    const dist = path.join(packages, "postext-pdf", "dist");
    const installed = path.join(packages, "postext-pdf", "node_modules", "harfbuzzjs", "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.js"), "export {};\n");
    fs.writeFileSync(path.join(installed, "harfbuzz.wasm"), "installed");
    return { packages, dist, installed };
  };

  it("answer harfbuzz.wasm from the installed package when dist has none", () => {
    const { packages, dist, installed } = stand();
    try {
      expect(localModule("postext-pdf/harfbuzz.wasm", packages)).toEqual({ file: path.join(installed, "harfbuzz.wasm"), path: "postext-pdf/harfbuzz.wasm" });
      // The copy of `pnpm build` wins when it is there.
      fs.writeFileSync(path.join(dist, "harfbuzz.wasm"), "built");
      expect(localModule("postext-pdf/harfbuzz.wasm", packages)).toEqual({ file: path.join(dist, "harfbuzz.wasm"), path: "postext-pdf/harfbuzz.wasm" });
      // Only that one file: nothing else is read from node_modules.
      expect(localModule("postext-pdf/harfbuzz-subset.wasm", packages)).toBeNull();
      expect(localModule("harfbuzzjs/index.mjs", packages)).toBeNull();
      expect(localModule("postext-pdf/index", packages)).toEqual({ file: path.join(dist, "index.js"), path: "postext-pdf/index.js" });
    } finally {
      fs.rmSync(packages, { recursive: true, force: true });
    }
  });

  it("are served with their bare imports as URLs, to a page and to a worker alike", async () => {
    const entry = path.join(REPO_DIR, "packages", "postext", "dist", "worker", "layout.worker.js");
    // A checkout that has not built the engine has nothing to serve.
    if (!fs.existsSync(entry)) return;
    const server = await startPenServer({ slug: "web-worker-live-editor", variant: "en", engine: "local" });
    try {
      const get = async (route: string) => {
        const res = await fetch(new URL(route, server.url));
        return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
      };
      // The page: no entry for the engine's dependencies in its import map.
      const page = await get("/");
      expect(page.body).toContain('"https://esm.sh/postext/worker":"/__shim/postext-worker.js"');
      expect(page.body).not.toContain('"fflate"');
      // The worker's own graph: every import is relative or a URL.
      const seen = new Set<string>();
      const queue = ["/__local/postext/worker/layout.worker.js"];
      const bare: string[] = [];
      while (queue.length && seen.size < 400) {
        const route = queue.shift()!;
        if (seen.has(route)) continue;
        seen.add(route);
        const res = await get(route);
        expect(res.status, route).toBe(200);
        // Statements only: a comment or a message may quote an import.
        const code = res.body.replace(/\/\*[\s\S]*?\*\//g, "");
        const specifiers = [
          ...code.matchAll(/^(?:import|export)\b[^'";]*?\bfrom\s*(['"])([^'"\n]+)\1/gm),
          ...code.matchAll(/^import\s*(['"])([^'"\n]+)\1/gm),
          ...code.matchAll(/\bimport\(\s*(['"])([^'"\n]+)\1/g),
        ];
        for (const [, , specifier] of specifiers) {
          if (/^https:\/\/esm\.sh\//.test(specifier!)) continue;
          if (/^\.{1,2}\//.test(specifier!) || specifier!.startsWith("/__local/")) {
            const next = new URL(specifier!, new URL(route, server.url));
            // An extensionless import is redirected to its file by the server.
            const final = (await fetch(next)).url;
            queue.push(new URL(final).pathname);
          } else if (!/^mathjax-full\//.test(specifier!)) bare.push(`${route}: ${specifier}`);
        }
      }
      expect(bare).toEqual([]);
      expect(seen.size).toBeGreaterThan(20);
    } finally {
      await server.close();
    }
  }, 60_000);
});
