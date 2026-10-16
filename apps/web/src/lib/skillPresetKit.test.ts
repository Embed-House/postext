import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
    expect(r.stdout).toContain("ERROR contentInConfig config.headingStyles[page-05] (header): 1 element(s), 21 characters");
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
