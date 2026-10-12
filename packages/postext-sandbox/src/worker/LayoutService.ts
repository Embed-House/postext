import { createLayoutWorker } from 'postext/worker';
import type { BuildProgress, BuildStats, LayoutWorkerHandle } from 'postext/worker';
import { documentFontFaces } from 'postext';
import type { FontVariantUse, PostextConfig, PostextContent, VDTDocument } from 'postext';
import {
  collectFontPayloadsForFamilies,
  collectStandInPayloads,
  configFontUses,
  FONT_RETRY_MS,
  familyCutFaces,
  fetchFacePayloads,
  fontPayloadKey,
  getCustomFontFamily,
  loadFont,
  onCustomFontsChanged,
  unansweredFontRequests,
} from '../controls/fontLoader';
import { resourcesKeyOf } from '../book/layoutKeys';
import { perfSizeKb, perfSpan } from '../perf/marks';

/** Who is asking, by urgency: what the reader is looking at, what they
 *  asked for, what runs behind their back. */
export type LayoutPriority = 'preview' | 'pdf' | 'background';

const RANK: Record<LayoutPriority, number> = { preview: 0, pdf: 1, background: 2 };

export interface LayoutRequest {
  /** One client keeps one build: a new request from the same client
   *  supersedes its earlier one (queued or running). */
  clientId: string;
  priority: LayoutPriority;
  content: PostextContent;
  config: PostextConfig;
  /** Fingerprint of everything the document depends on; the worker keeps
   *  the last few documents by it. Omit for a document not worth keeping. */
  cacheKey?: string;
  onProgress?: (progress: BuildProgress) => void;
  /** Warm the worker's cache only: the document is built and kept there,
   *  not sent back (needs `cacheKey`). Resolves with `undefined`. */
  warmOnly?: boolean;
}

export interface LayoutService {
  /** Lay `content` out on the shared worker. Rejects with an `AbortError`
   *  when a later request from the same client supersedes this one, or
   *  when the client is cancelled. */
  build(request: LayoutRequest): Promise<VDTDocument>;
  /** Drop whatever `clientId` has pending (a component unmounting), and
   *  the requests of its sub-clients (`clientId:…`). */
  cancel(clientId: string): void;
  dispose(): void;
  /** Disposed services reject every build: the host makes a new one. */
  readonly disposed: boolean;
}

interface Entry {
  request: LayoutRequest;
  resolve: (doc: VDTDocument) => void;
  reject: (err: unknown) => void;
  /** Set while the entry runs on the worker. */
  controller: AbortController | null;
  /** The running build was interrupted for a more urgent one and goes
   *  back to the queue when the worker acknowledges the cancel. */
  requeue: boolean;
  /** The running build was superseded or cancelled: its rejection is final. */
  dropped: boolean;
}

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

/** Layouts at most after the first, for faces its pages name that the
 *  configuration did not. */
const FONT_ROUNDS = 2;

/** A build waits this long for the files of its faces (#757). The files
 *  are fetched before the worker lays a chapter out, and one of them on a
 *  connection that stalls would hold the layout as long as the network
 *  cares to: past this, the chapter is laid out with the faces the worker
 *  has, and again when the rest arrive (`onLateFonts`). */
export const FONT_HOLD_MS = 8_000;

/** Times a family whose files the network did not give is asked for
 *  again, a while apart, without a build asking. */
const FONT_RETRIES = 3;

type LateFontsListener = (families: string[]) => void;
const lateFontsListeners = new Set<LateFontsListener>();

/**
 * Faces reached a layout worker after a build that could not wait for
 * them (a file slower than `FONT_HOLD_MS`, one the network gave at a later
 * try): the documents built so far were measured without them, and the
 * views lay out again. The listener gets the families.
 */
export function onLateFonts(listener: LateFontsListener): () => void {
  lateFontsListeners.add(listener);
  return () => { lateFontsListeners.delete(listener); };
}

/** True when `work` settles within `ms`; false when the wait ends first
 *  (`work` goes on). Rejects as `work` does, while waited for. */
function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  if (!Number.isFinite(ms)) return work.then(() => true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * One layout worker for the whole sandbox — previews, the PDF tab and the
 * background paginator share its fonts, its measurement cache and its
 * document cache — with one build in flight at a time, chosen by priority:
 * a preview's build goes before the PDF's, which goes before a background
 * chapter's. A more urgent request interrupts a less urgent build (the
 * worker stops at the next pass) and puts it back in the queue, promise
 * still pending, so a paginator never loses a chapter to the reader's
 * typing. Within one client the last request wins: the earlier one is
 * cancelled and rejected.
 */
export function createLayoutService(options?: {
  handle?: LayoutWorkerHandle;
  /** How long a build waits for the files of its faces (`FONT_HOLD_MS`);
   *  `Infinity` for a host that has nobody to show a first layout to and
   *  wants the one with every face (the headless entry). */
  fontHoldMs?: number;
}): LayoutService {
  const fontHoldMs = options?.fontHoldMs ?? FONT_HOLD_MS;
  // The worker is spawned on first use, not on creation: the provider's
  // state initialiser also runs while the page is rendered on the server
  // (Next.js prerender), where `Worker` does not exist.
  let handle: LayoutWorkerHandle | null = options?.handle ?? null;
  // The Sandbox's own entry: Postext's worker with the citation engine
  // loaded on demand (see ./layout.worker.ts).
  const worker = (): LayoutWorkerHandle => (handle ??= createLayoutWorker({
    worker: new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' }),
  }));
  const queue: Entry[] = [];
  let active: Entry | null = null;
  let disposed = false;

  // One thing at a time on the worker (#757): a build that did not wait
  // for a slow file must not have its faces registered half way through
  // (the worker answers a registration between two passes of a build, and
  // would keep the document measured half with them under its cache key).
  // A registration waits for the build under way, and a build for it.
  let workerUse: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(use: () => Promise<T>): Promise<T> => {
    const run = workerUse.then(use, use);
    workerUse = run.catch(() => {});
    return run;
  };
  const register = (payloads: Parameters<LayoutWorkerHandle['registerFonts']>[0]): Promise<void> =>
    exclusive(() => worker().registerFonts(payloads));

  // --- fonts: registered lazily, for the worker's lifetime
  // The custom families sent, each with every file it has.
  const registeredFamilies = new Set<string>();
  // The catalogue families (#757): the weights and slants the builds so
  // far asked of each, and the faces sent for them, by face key. A family
  // is a file per weight, style and subset, and the worker is sent the
  // cuts a build is set in before it lays it out, each with all its files,
  // so a chapter is laid out once and the files of a cut stand in the
  // worker in the order they are declared. A face that arrives later
  // (one only the pages name, a stand-in slice, a custom font uploaded
  // again) is measured with from the next build on: the engine's worker
  // makes its canvas resolve those fonts again (#760).
  const familyUses = new Map<string, Map<string, FontVariantUse>>();
  const sentFaces = new Map<string, Set<string>>();
  // The stand-in faces sent so far (#688), by face key: a family's own
  // file under a bold or an italic it lacks, for the characters of the
  // builds so far.
  const registeredStandIns = new Set<string>();
  let fontQueue: Promise<void> = Promise.resolve();
  // The families the network did not give every file of, and the tries
  // each has left: asked for again a while later, and the views told when
  // their files arrive.
  const shortFamilies = new Set<string>();
  const retriesLeft = new Map<string, number>();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const announce = (families: readonly string[]): void => {
    if (disposed || families.length === 0) return;
    for (const listener of [...lateFontsListeners]) listener([...families]);
  };
  const unsubscribeFonts = onCustomFontsChanged((families) => {
    const toUnregister = families.filter((f) => registeredFamilies.has(f) || sentFaces.has(f));
    for (const f of families) {
      registeredFamilies.delete(f);
      sentFaces.delete(f);
    }
    // The worker drops every face of the family, its stand-ins too.
    for (const key of registeredStandIns) if (families.some((f) => key.startsWith(`${f}|`))) registeredStandIns.delete(key);
    if (toUnregister.length === 0) return;
    fontQueue = fontQueue.then(() =>
      worker().unregisterFonts(toUnregister).catch((err) => {
        console.warn('[LayoutService] font unregister failed', err);
      }),
    );
  });

  /** Note the faces asked of each family, and have the page declare the
   *  new ones: it paints with the cut the worker measures with, and a cut
   *  is declared when it is first set (a heading weight changed in the
   *  settings, a face only the pages name). They load as the page paints. */
  const noteUses = (uses: Iterable<[string, readonly FontVariantUse[]]>): void => {
    for (const [family, list] of uses) {
      let known = familyUses.get(family);
      if (!known) familyUses.set(family, (known = new Map()));
      const fresh: FontVariantUse[] = [];
      for (const use of list) {
        const key = `${use.weight}|${use.style}`;
        if (known.has(key)) continue;
        known.set(key, { weight: use.weight, style: use.style });
        fresh.push({ weight: use.weight, style: use.style });
      }
      if (fresh.length > 0 && !getCustomFontFamily(family)) void loadFont(family, fresh).catch(() => {});
    }
  };

  /** The files of a catalogue family the worker lacks for the faces asked
   *  of it so far: every file of each cut, and of its regular, its bold
   *  and their italics, which a text asks for without its configuration
   *  saying so (`familyCutFaces`). */
  const lackingFaces = async (family: string) => {
    const uses = [...(familyUses.get(family)?.values() ?? [])];
    const had = sentFaces.get(family);
    return (await familyCutFaces(family, uses, { standard: true })).filter((face) => !had?.has(fontPayloadKey(face)));
  };

  /** Send the worker the faces of `families` it lacks; true when it got
   *  any. */
  const sendFamilies = async (families: readonly string[]): Promise<boolean> => {
    let sent = false;
    const custom = families.filter((f) => getCustomFontFamily(f) && !registeredFamilies.has(f));
    if (custom.length > 0) {
      for (const f of custom) registeredFamilies.add(f);
      try {
        const payloads = await collectFontPayloadsForFamilies(custom);
        if (payloads.length > 0) {
          await register(payloads);
          sent = true;
        }
        const delivered = new Set(payloads.map((p) => p.family));
        for (const f of custom) if (!delivered.has(f)) registeredFamilies.delete(f);
      } catch (err) {
        for (const f of custom) registeredFamilies.delete(f);
        console.warn('[LayoutService] font registration failed', err);
      }
    }
    // One message for every family: their files are fetched side by side.
    try {
      const catalogue = families.filter((f) => !getCustomFontFamily(f));
      const perFamily = await Promise.all(catalogue.map(lackingFaces));
      const lacking = perFamily.flat();
      // A file that cannot be had is left out, and asked for again: by a
      // later build, and by the service itself a while later.
      const payloads = lacking.length > 0 ? await fetchFacePayloads(lacking) : [];
      const got = new Set(payloads.map(fontPayloadKey));
      // Short of files: one of its files did not come, or the family has
      // no face at all while a request went unanswered (its record, its
      // style sheet).
      const unanswered = unansweredFontRequests().length > 0;
      catalogue.forEach((family, i) => {
        const faces = perFamily[i]!;
        const short = faces.some((face) => !got.has(fontPayloadKey(face)))
          || (faces.length === 0 && unanswered && !sentFaces.has(family));
        if (short) shortFamilies.add(family);
        else {
          shortFamilies.delete(family);
          retriesLeft.delete(family);
        }
      });
      scheduleRetry();
      if (payloads.length === 0) return sent;
      const keys = payloads.map((p) => [p.family, fontPayloadKey(p)] as const);
      await register(payloads);
      for (const [family, key] of keys) {
        const had = sentFaces.get(family);
        if (had) had.add(key);
        else sentFaces.set(family, new Set([key]));
      }
      return true;
    } catch (err) {
      console.warn('[LayoutService] font registration failed', err);
      return sent;
    }
  };

  /** Ask again, a while later, for the families short of files: nobody
   *  may build in the meantime, and the pages on show were measured
   *  without them. */
  function scheduleRetry(): void {
    if (retryTimer !== null || disposed) return;
    const due = (): string[] => [...shortFamilies].filter((f) => (retriesLeft.get(f) ?? FONT_RETRIES) > 0);
    if (due().length === 0) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const families = due();
      if (disposed || families.length === 0) return;
      for (const f of families) retriesLeft.set(f, (retriesLeft.get(f) ?? FONT_RETRIES) - 1);
      const next = fontQueue.then(async () => {
        if (disposed) return;
        if (await sendFamilies(families)) announce(families);
      });
      fontQueue = next;
    }, FONT_RETRY_MS + 1_000);
  }

  /** After the families' own faces: the bold or the italic a family has no
   *  file for, answered by its own face (#688), in the files that hold
   *  this build's characters. True when the worker got any. */
  const sendStandIns = async (config: PostextConfig, content: PostextContent): Promise<boolean> => {
    try {
      const standIns = await collectStandInPayloads(config, content, registeredStandIns);
      if (standIns.length > 0) {
        const keys = standIns.map(fontPayloadKey);
        await register(standIns);
        for (const key of keys) registeredStandIns.add(key);
        return true;
      }
    } catch (err) {
      console.warn('[LayoutService] stand-in font registration failed', err);
    }
    return false;
  };

  /** Send the worker the faces of a build; the families, when it got any
   *  it did not have. */
  const ensureFonts = async (config: PostextConfig, content: PostextContent): Promise<string[]> => {
    // The text decides some faces too (a comic page letters in its own).
    const uses = configFontUses(config, content.markdown);
    noteUses(uses);
    const families = [...uses.keys()];
    let sent = false;
    const next = fontQueue.then(async () => {
      sent = await sendFamilies(families);
      sent = (await sendStandIns(config, content)) || sent;
    });
    fontQueue = next;
    await next;
    return sent ? families : [];
  };

  /** Wait for `fonts` as long as a build may (`fontHoldMs`); past it, the
   *  build goes ahead and the views are told when the faces arrive. */
  const hold = async (fonts: Promise<string[] | boolean>, families: () => string[]): Promise<boolean> => {
    if (await settledWithin(fonts, fontHoldMs)) return true;
    void fonts.then((sent) => {
      const late = Array.isArray(sent) ? sent : sent ? families() : [];
      announce(late);
    }, () => {});
    return false;
  };

  /**
   * The faces the pages of `doc` are set in that the worker was not sent
   * (#757): a weight and slant its configuration did not announce and the
   * regular, the bold and their italics do not cover (the italic of a
   * heading set at 600, the bold of a caption in a family cut by slices).
   * With the variable file every weight was there; with a file per weight
   * the pages say which ones they need. The service notes those faces (the
   * page declares them) and sends the worker their files; true when it
   * got any, and the document is then laid out again with them.
   */
  const ensureDocumentFonts = async (doc: VDTDocument, config: PostextConfig, content: PostextContent): Promise<boolean> => {
    const asked = new Map<string, FontVariantUse[]>();
    for (const face of documentFontFaces(doc)) {
      const list = asked.get(face.family);
      if (list) list.push({ weight: face.weight, style: face.style });
      else asked.set(face.family, [{ weight: face.weight, style: face.style }]);
    }
    const fresh: [string, FontVariantUse[]][] = [];
    for (const [family, list] of asked) {
      if (getCustomFontFamily(family)) continue;
      const known = familyUses.get(family);
      const news = list.filter((use) => !known?.has(`${use.weight}|${use.style}`));
      if (news.length > 0) fresh.push([family, news]);
    }
    if (fresh.length === 0) return false;
    noteUses(fresh);
    let sent = false;
    const next = fontQueue.then(async () => {
      sent = await sendFamilies(fresh.map(([family]) => family));
      if (sent) await sendStandIns(config, content);
    });
    fontQueue = next;
    await next;
    return sent;
  };

  // --- the queue
  const takeNext = (): Entry | null => {
    if (queue.length === 0) return null;
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (RANK[queue[i]!.request.priority] < RANK[queue[best]!.request.priority]) best = i;
    }
    return queue.splice(best, 1)[0]!;
  };

  const run = async (entry: Entry): Promise<void> => {
    active = entry;
    const controller = new AbortController();
    entry.controller = controller;
    const { request } = entry;
    const span = perfSpan('worker.build', {
      client: request.priority,
      markdownKb: Math.round(request.content.markdown.length / 1024),
      contentKb: perfSizeKb(request.content),
    });
    let stats: BuildStats | null = null;
    try {
      // Bounded (#757): one slow file does not hold the chapter.
      await hold(ensureFonts(request.config, request.content), () => []);
      if (controller.signal.aborted) throw abortError();
      const buildOptions = {
        signal: controller.signal,
        onProgress: request.onProgress,
        onStats: (s: BuildStats) => { stats = s; },
        resourcesKey: request.content.resources ? resourcesKeyOf(request.content.resources) : undefined,
        cacheKey: request.cacheKey,
      };
      const build = (): Promise<VDTDocument> => exclusive(() => worker().build(request.content, request.config, buildOptions));
      let doc = request.warmOnly && request.cacheKey
        ? await exclusive(() => worker().warm(request.content, request.config, { ...buildOptions, cacheKey: request.cacheKey! })).then(() => null)
        : await build();
      // Laid out again when its pages set a face the worker did not have
      // (#757): once for the faces the first layout names, once more for
      // any the second brings.
      for (let round = 0; doc && round < FONT_ROUNDS; round++) {
        const named = ensureDocumentFonts(doc, request.config, request.content);
        const families = (): string[] => [...new Set(documentFontFaces(doc!).map((face) => face.family))];
        // A file of theirs that is slow: the document stands as it is, and
        // the views lay out again when it arrives.
        if (!(await hold(named, families)) || !(await named)) break;
        if (controller.signal.aborted) throw abortError();
        doc = await build();
      }
      const built = stats as BuildStats | null;
      span.end({
        warm: !!request.warmOnly,
        pages: doc?.pages.length,
        docKb: doc ? perfSizeKb(doc) : 0,
        cached: built?.cached ?? false,
        workerMs: built?.totalMs,
        passes: built?.passes.length,
        passMs: built?.passes.map((p) => Math.round(p.ms)).join('/'),
      });
      entry.resolve(doc as VDTDocument);
    } catch (err) {
      const aborted = (err as { name?: string } | null)?.name === 'AbortError';
      if (aborted && entry.requeue && !entry.dropped && !disposed) {
        span.end({ requeued: true });
        entry.requeue = false;
        entry.controller = null;
        queue.push(entry);
      } else {
        span.end({ aborted });
        entry.reject(err);
      }
    } finally {
      if (active === entry) active = null;
      pump();
    }
  };

  const pump = (): void => {
    if (disposed || active) return;
    const next = takeNext();
    if (next) void run(next);
  };

  const interrupt = (entry: Entry, requeue: boolean): void => {
    entry.requeue = requeue;
    entry.dropped = !requeue;
    entry.controller?.abort();
  };

  return {
    get disposed() { return disposed; },
    build(request) {
      if (disposed) return Promise.reject(new Error('Layout service disposed'));
      return new Promise<VDTDocument>((resolve, reject) => {
        // Last wins within a client: the earlier request is dropped.
        for (let i = queue.length - 1; i >= 0; i--) {
          const q = queue[i]!;
          if (q.request.clientId === request.clientId) {
            queue.splice(i, 1);
            q.reject(abortError());
          }
        }
        if (active?.request.clientId === request.clientId) interrupt(active, false);
        // A more urgent request interrupts a less urgent build, which
        // returns to the queue once the worker has stopped it.
        else if (active && RANK[request.priority] < RANK[active.request.priority] && !active.requeue) interrupt(active, true);
        queue.push({ request, resolve, reject, controller: null, requeue: false, dropped: false });
        pump();
      });
    },
    cancel(clientId) {
      const owned = (id: string) => id === clientId || id.startsWith(`${clientId}:`);
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i]!;
        if (owned(q.request.clientId)) {
          queue.splice(i, 1);
          q.reject(abortError());
        }
      }
      if (active && owned(active.request.clientId)) interrupt(active, false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      unsubscribeFonts();
      for (const q of queue.splice(0)) q.reject(abortError());
      if (active) interrupt(active, false);
      handle?.dispose();
    },
  };
}
