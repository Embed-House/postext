import type { CaptureManifest, SemVer } from "./types.ts";

/** The release a recipe was last tested with, and when. */
export interface TestedOn {
  postext: SemVer;
  postextPdf?: SemVer;
  /** ISO time of the run. */
  at: string;
}

/**
 * The release a recipe was last tested with (#735): the newest one on which
 * a capture run found its pages, PDF and bundle unchanged (`verified`),
 * else the run that wrote its files (`engine`, `capturedAt`). What the
 * recipe page, its Markdown page and the gallery print as "tested with";
 * the engine that laid out the pictured pages stays `capture.engine`.
 */
export function testedOn(capture: Pick<CaptureManifest, "engine" | "capturedAt" | "verified">): TestedOn {
  const { verified, engine } = capture;
  if (verified) return { postext: verified.postext, ...(verified.postextPdf ? { postextPdf: verified.postextPdf } : {}), at: verified.at };
  return { postext: engine.postext, ...(engine.postextPdf ? { postextPdf: engine.postextPdf } : {}), at: capture.capturedAt };
}
