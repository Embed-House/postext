import { describe, expect, it } from "vitest";
import { testedOn } from "./tested.ts";
import type { CaptureManifest } from "./types.ts";

// "Tested with" follows the release a capture was last verified on (#735):
// 90 recipes said 1.26.0 on their pages although all passed on 1.27.0,
// because moving the version took a capture that rewrote every file.

const capture = (extra: Partial<CaptureManifest> = {}) => ({
  engine: { postext: "1.26.0", postextPdf: "1.26.0", source: "npm" },
  capturedAt: "2026-10-01T10:00:00.000Z",
  ...extra,
}) as Pick<CaptureManifest, "engine" | "capturedAt" | "verified">;

describe("testedOn (#735)", () => {
  it("is the run that wrote the files when no later release verified them", () => {
    expect(testedOn(capture())).toEqual({ postext: "1.26.0", postextPdf: "1.26.0", at: "2026-10-01T10:00:00.000Z" });
    expect(testedOn(capture({ engine: { postext: "1.26.0", source: "npm" } as CaptureManifest["engine"] }))).toEqual({ postext: "1.26.0", at: "2026-10-01T10:00:00.000Z" });
  });

  it("is the release that verified the capture unchanged, and its day", () => {
    const verified = { postext: "1.28.0", postextPdf: "1.28.0", chrome: "154.0.0.0", at: "2026-10-20T08:00:00.000Z" } as CaptureManifest["verified"];
    expect(testedOn(capture({ verified }))).toEqual({ postext: "1.28.0", postextPdf: "1.28.0", at: "2026-10-20T08:00:00.000Z" });
    // A recipe with no PDF is verified without one.
    expect(testedOn(capture({ verified: { postext: "1.28.0", chrome: "c", at: "t" } as CaptureManifest["verified"] }))).toEqual({ postext: "1.28.0", at: "t" });
  });
});
