// A viewer tab's status as a tool answers with it, and the wait for a
// viewer to finish what it is making.

import type { ViewportTab } from '../types/index.js';
import type { ViewerControls, ViewerStatus } from '../viewport/viewerControls.js';
import { ToolError } from './modelContext.js';

/** Most entries of a table of contents, notices or videos one answer lists. */
export const MAX_STATUS_ENTRIES = 40;

/** How long a PDF or an EPUB may take to write. */
export const GENERATE_TIMEOUT_MS = 10 * 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** `status` without what says nothing (members that are null, lists that
 *  are empty), its numbers rounded and its lists cut to
 *  {@link MAX_STATUS_ENTRIES} — `contentsMore`, `noticesMore` and
 *  `videosMore` then count what was left out. */
export function compactStatus(status: ViewerStatus): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(status)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out[key] = value.slice(0, MAX_STATUS_ENTRIES);
      if (value.length > MAX_STATUS_ENTRIES) out[`${key}More`] = value.length - MAX_STATUS_ENTRIES;
      continue;
    }
    out[key] = value;
  }
  if (typeof status.progress === 'number') out.progress = round(status.progress, 2);
  if (typeof status.magnification === 'number') out.magnification = round(status.magnification, 2);
  if (status.view) out.view = { tilt: round(status.view.tilt, 1), yaw: round(status.view.yaw, 1) };
  return out;
}

/** Resolves once `controls` reports nothing being made. A viewer that is
 *  still at it after `timeoutMs` is left to it: the error says so. */
export async function whenViewerIdle(
  tab: ViewportTab,
  controls: ViewerControls,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ViewerStatus> {
  const timeoutMs = options.timeoutMs ?? GENERATE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  // The tab's state follows its last render.
  await sleep(80);
  for (;;) {
    const status = controls.status();
    if (!status.generating) return status;
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() > deadline) {
      const waited = timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} minute(s)` : `${Math.round(timeoutMs / 1000)} second(s)`;
      throw new ToolError(`The ${tab} viewer is still at work after ${waited}; it goes on in its tab. sandbox_get_state says how far it is.`);
    }
    await sleep(200);
  }
}
