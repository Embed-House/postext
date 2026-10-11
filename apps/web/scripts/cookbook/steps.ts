/**
 * The steps of the capture harness, named (#743). Every awaited step of
 * `runVariant` runs through `step()`: a rejection then says which step of
 * which edition was waiting, and a step that never answers fails within its
 * own bound instead of waiting out Puppeteer's protocol timeout with only
 * the CDP method to go by.
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */

/** A harness failure that knows the step it happened in. */
export class StepError extends Error {
  /** `newPage`, `goto`, `done`, `fonts`, `settle`, `frames`, `kit`, `facts`, `bundle`, … */
  step: string;
  /** "<slug> <variant>" */
  edition: string;
  /** True when the step ran out of its bound (it never answered). */
  stalled: boolean;

  constructor(step: string, edition: string, detail: string, { stalled = false, cause }: { stalled?: boolean; cause?: unknown } = {}) {
    super(`step ${step} of ${edition}: ${detail}`, cause === undefined ? undefined : { cause });
    this.name = "StepError";
    this.step = step;
    this.edition = edition;
    this.stalled = stalled;
  }
}

export interface StepOptions {
  /** "<slug> <variant>", for the message. */
  edition: string;
  /** The step fails after this long without an answer. */
  timeoutMs?: number;
}

/** Runs one step of the harness: its rejection carries `name`, and with
 *  `timeoutMs` so does its silence. */
export async function step<T>(name: string, opts: StepOptions, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(run);
  try {
    if (!opts.timeoutMs) return await work;
    const stall = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new StepError(name, opts.edition, `no answer in ${Math.round(opts.timeoutMs! / 100) / 10} s`, { stalled: true })),
        opts.timeoutMs,
      );
    });
    // The step goes on in the page until it is closed: its late rejection
    // has nobody waiting for it.
    work.catch(() => {});
    return await Promise.race([work, stall]);
  } catch (error) {
    if (error instanceof StepError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new StepError(name, opts.edition, message, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/** What a `harness` failure prints: the step and the edition, then where the
 *  error came from (the first lines of the stack that are not the message). */
export function harnessDetail(error: unknown): string {
  if (error instanceof StepError) {
    const cause = error.cause instanceof Error ? error.cause : null;
    const where = (cause?.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 2).map((line) => line.trim());
    return [error.message, ...where].join(" ⏎ ");
  }
  return String((error as Error)?.stack ?? error).split("\n").slice(0, 3).join(" ⏎ ");
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** Over the slowest recipe's own bound: a CDP call of a step that is bounded
 *  by the recipe's timeout must not be cut by the protocol first. */
const PROTOCOL_MARGIN_MS = 30_000;

/** Puppeteer's `protocolTimeout` for a run: the largest `capture.timeoutMs`
 *  among its recipes plus a margin (its default is 180 s, which is what a
 *  call that never answers used to wait). */
export function protocolTimeoutFor(timeouts: readonly (number | undefined)[]): number {
  return Math.max(DEFAULT_TIMEOUT_MS, ...timeouts.map((t) => t ?? DEFAULT_TIMEOUT_MS)) + PROTOCOL_MARGIN_MS;
}
