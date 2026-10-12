import { describe, expect, it } from "vitest";
import { OLDEST_CHROME, chromeMajor, chromeTooOld, pickChrome, tooOldMessage } from "../../../scripts/cookbook/chrome.ts";

// The Chrome a capture runs on (#746). The recipes were captured on the
// Chrome for Testing 131 that sat in Puppeteer's cache, and Chrome 152 and
// 154 broke ten of their editions at other words: digits and the marks
// beside them are shaped otherwise since a canvas has a language.

describe("the Chrome of a capture (#746)", () => {
  it("reads a version's major", () => {
    expect(chromeMajor("131.0.6778.204")).toBe(131);
    expect(chromeMajor(" 154.0.8037.98 ")).toBe(154);
    expect(chromeMajor("HeadlessChrome")).toBeNaN();
  });

  it("refuses a Chrome older than the oldest the editions were compared on", () => {
    expect(chromeTooOld("131.0.6778.204")).toBe(true);
    expect(chromeTooOld(`${OLDEST_CHROME - 1}.0.0.0`)).toBe(true);
    expect(chromeTooOld(`${OLDEST_CHROME}.0.7977.83`)).toBe(false);
    expect(chromeTooOld("154.0.8037.98")).toBe(false);
    // What does not read as a version is left to the run.
    expect(chromeTooOld("unknown")).toBe(false);
  });

  it("says which Chrome was refused and what to do", () => {
    const message = tooOldMessage("131.0.6778.204", "/cache/chrome");
    expect(message).toContain("Chrome 131.0.6778.204 (/cache/chrome) is older than 152");
    expect(message).toContain("npx @puppeteer/browsers install chrome@stable");
    expect(message).toContain("COOKBOOK_CHROME");
  });

  const old = { file: "/cache/mac_arm-131.0.6778.204/chrome", version: "131.0.6778.204" };
  const current = { file: "/cache/mac_arm-154.0.8037.98/chrome", version: "154.0.8037.98" };
  const installed = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];

  it("takes COOKBOOK_CHROME before anything else", () => {
    expect(pickChrome({ env: "/opt/chrome", cached: [current], installed })).toEqual({ file: "/opt/chrome", from: "COOKBOOK_CHROME" });
  });

  it("takes the newest cached Chrome for Testing when it is current", () => {
    expect(pickChrome({ cached: [current, old], installed })).toEqual({ file: current.file, version: current.version, from: "puppeteer" });
  });

  it("takes the installed Chrome over a cached one that is too old", () => {
    expect(pickChrome({ cached: [old], installed })).toEqual({ file: installed[0], from: "installed" });
    expect(pickChrome({ cached: [], installed })).toEqual({ file: installed[0], from: "installed" });
  });

  it("has no choice when the only Chrome is an old cached one", () => {
    expect(pickChrome({ cached: [old], installed: [] })).toBeNull();
    expect(pickChrome({ cached: [], installed: [] })).toBeNull();
  });
});
