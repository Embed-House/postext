import { afterEach, describe, expect, it, vi } from "vitest";
import { frames, fontsReady } from "../../../scripts/cookbook/lib/probe.js";
import { StepError, harnessDetail, protocolTimeoutFor, step } from "../../../scripts/cookbook/steps.ts";

// The capture harness names its steps (#743). An all-recipes
// `--sandbox-only` run had an edition wait out Puppeteer's 180 s protocol
// timeout, and the failure named a CDP method, not the step that waited.

describe("harness steps (#743)", () => {
  it("pass a step's value through", async () => {
    expect(await step("facts", { edition: "a-recipe en", timeoutMs: 1000 }, async () => 7)).toBe(7);
  });

  it("name the step and the edition of a rejection", async () => {
    const failing = step("goto", { edition: "a-recipe es" }, async () => {
      throw new Error("net::ERR_CONNECTION_REFUSED");
    });
    await expect(failing).rejects.toMatchObject({ name: "StepError", step: "goto", edition: "a-recipe es", stalled: false });
    await expect(failing).rejects.toThrow("step goto of a-recipe es: net::ERR_CONNECTION_REFUSED");
  });

  it("fail a step that never answers within its bound, by name", async () => {
    const t0 = Date.now();
    const never = new Promise<never>(() => {});
    const stalled = step("frames", { edition: "accessible-tagged-pdf es", timeoutMs: 80 }, () => never);
    await expect(stalled).rejects.toMatchObject({ step: "frames", stalled: true });
    await expect(stalled).rejects.toThrow("step frames of accessible-tagged-pdf es: no answer in 0.1 s");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("keep the name of the innermost step", async () => {
    const inner = () => step("bundle", { edition: "x en" }, async () => { throw new Error("boom"); });
    await expect(step("outer", { edition: "x en", timeoutMs: 500 }, inner)).rejects.toMatchObject({ step: "bundle" });
  });

  it("print the step first in a harness failure", () => {
    const cause = new Error("Runtime.callFunctionOn timed out.");
    cause.stack = "ProtocolError: Runtime.callFunctionOn timed out.\n    at Callback.<instance_members_initializer> (CallbackRegistry.js:1:1)\n    at new Callback (CallbackRegistry.js:2:2)\n    at more (x.js:3:3)";
    const detail = harnessDetail(new StepError("frames", "a-recipe es", cause.message, { cause }));
    expect(detail).toBe("step frames of a-recipe es: Runtime.callFunctionOn timed out. ⏎ at Callback.<instance_members_initializer> (CallbackRegistry.js:1:1) ⏎ at new Callback (CallbackRegistry.js:2:2)");
    expect(harnessDetail(new StepError("frames", "a-recipe es", "no answer in 60 s", { stalled: true }))).toBe("step frames of a-recipe es: no answer in 60 s");
    expect(harnessDetail(new Error("plain"))).toMatch(/^Error: plain ⏎ /);
  });

  it("bound a CDP call by the slowest recipe of the run, not by 180 s", () => {
    expect(protocolTimeoutFor([undefined, undefined])).toBe(90_000);
    expect(protocolTimeoutFor([undefined, 120_000, 30_000])).toBe(150_000);
    expect(protocolTimeoutFor([])).toBe(90_000);
  });
});

describe("the probe's waits on the browser (#743)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("frames: counts the frames that come", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 1));
    expect(await frames(2, 200)).toEqual({ frames: 2 });
  });

  it("frames: a page that is not presented falls back on a timer and says so", async () => {
    // No frame ever comes.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const t0 = Date.now();
    expect(await frames(2, 60)).toEqual({ frames: 0, fellBack: true });
    expect(Date.now() - t0).toBeLessThan(1000);
    // One frame, then none: the timer starts again after the frame.
    let calls = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => (calls++ === 0 ? setTimeout(callback, 1) : 0));
    expect(await frames(2, 60)).toEqual({ frames: 1, fellBack: true });
  });

  it("fontsReady: a font request left without an answer does not hold the capture", async () => {
    vi.stubGlobal("document", { fonts: { ready: new Promise(() => {}) } });
    expect(await fontsReady(60)).toEqual({ timedOut: true });
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
    expect(await fontsReady(60)).toEqual({});
  });
});
