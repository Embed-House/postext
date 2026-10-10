import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localMathJaxModule } from "../../../scripts/cookbook/serve.ts";
import { importMapTag, resolveEngine } from "../../../scripts/cookbook/shim.ts";
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
    const map = importMapTag(resolveEngine("local"));
    expect(map).toContain('"postext":"/__local/postext/index.js"');
    expect(map).not.toContain("mathjax");
  });
});
