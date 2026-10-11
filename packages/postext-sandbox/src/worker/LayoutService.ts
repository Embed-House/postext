import { createLayoutWorker } from 'postext/worker';
import type { BuildProgress, BuildStats, LayoutWorkerHandle } from 'postext/worker';
import { documentFontFaces } from 'postext';
import type { FontVariantUse, PostextConfig, PostextContent, VDTDocument } from 'postext';
import {
  collectFontPayloadsForFamilies,
  collectStandInPayloads,
  configFontUses,
  familyCutFaces,
  fetchFacePayloads,
  fontPayloadKey,
  getCustomFontFamily,
  loadFont,
  onCustomFontsChanged,
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
  /** A worker handle to use, in place of the Sandbox's own worker. */
  handle?: LayoutWorkerHandle;
  /** How to make another handle: the service asks for one when it has to
   *  start over on a fresh worker (see `lacksDocumentFonts`). With a
   *  `handle` and no factory, the service keeps that one handle. */
  createHandle?: () => LayoutWorkerHandle;
}): LayoutService {
  // The worker is spawned on first use, not on creation: the provider's
  // state initialiser also runs while the page is rendered on the server
  // (Next.js prerender), where `Worker` does not exist.
  let handle: LayoutWorkerHandle | null = options?.handle ?? null;
  // The Sandbox's own entry: Postext's worker with the citation engine
  // loaded on demand (see ./layout.worker.ts).
  const createHandle = options?.createHandle ?? (options?.handle ? null : (): LayoutWorkerHandle => createLayoutWorker({
    worker: new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' }),
  }));
  const worker = (): LayoutWorkerHandle => {
    if (!handle) {
      if (!createHandle) throw new Error('Layout service has no worker');
      handle = createHandle();
    }
    return handle;
  };
  const queue: Entry[] = [];
  let active: Entry | null = null;
  let disposed = false;

  // --- fonts: registered lazily, for the worker's lifetime
  // The custom families sent, each with every file it has.
  const registeredFamilies = new Set<string>();
  // The catalogue families (#757): the weights and slants the builds so
  // far asked of each, and the faces sent for them, by face key. A family
  // is a file per weight, style and subset, and the worker is sent the
  // cuts a build is set in before it lays it out, each with all its files:
  // a worker's canvas resolves a font the first time it sets text with it
  // and never looks at the font set again for that font (Chrome 131 and
  // 154), so a file that arrives later, another weight or another subset
  // of a cut, would never be measured with.
  const familyUses = new Map<string, Map<string, FontVariantUse>>();
  const sentFaces = new Map<string, Set<string>>();
  // The stand-in faces sent so far (#688), by face key: a family's own
  // file under a bold or an italic it lacks, for the characters of the
  // builds so far.
  const registeredStandIns = new Set<string>();
  let fontQueue: Promise<void> = Promise.resolve();
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

  /** Send the worker the faces of `families` it lacks. */
  const sendFamilies = async (families: readonly string[]): Promise<void> => {
    const custom = families.filter((f) => getCustomFontFamily(f) && !registeredFamilies.has(f));
    if (custom.length > 0) {
      for (const f of custom) registeredFamilies.add(f);
      try {
        const payloads = await collectFontPayloadsForFamilies(custom);
        if (payloads.length > 0) await worker().registerFonts(payloads);
        const delivered = new Set(payloads.map((p) => p.family));
        for (const f of custom) if (!delivered.has(f)) registeredFamilies.delete(f);
      } catch (err) {
        for (const f of custom) registeredFamilies.delete(f);
        console.warn('[LayoutService] font registration failed', err);
      }
    }
    // One message for every family: their files are fetched side by side.
    try {
      const lacking = (await Promise.all(families.filter((f) => !getCustomFontFamily(f)).map(lackingFaces))).flat();
      if (lacking.length === 0) return;
      // A file that cannot be had is left out, and asked for again by a
      // later build.
      const payloads = await fetchFacePayloads(lacking);
      if (payloads.length === 0) return;
      const keys = payloads.map((p) => [p.family, fontPayloadKey(p)] as const);
      await worker().registerFonts(payloads);
      for (const [family, key] of keys) {
        const had = sentFaces.get(family);
        if (had) had.add(key);
        else sentFaces.set(family, new Set([key]));
      }
    } catch (err) {
      console.warn('[LayoutService] font registration failed', err);
    }
  };

  const ensureFonts = async (config: PostextConfig, content: PostextContent): Promise<void> => {
    // The text decides some faces too (a comic page letters in its own).
    const uses = configFontUses(config, content.markdown);
    noteUses(uses);
    const families = [...uses.keys()];
    const next = fontQueue.then(async () => {
      await sendFamilies(families);
      // After the families' own faces: the bold or the italic a family
      // has no file for, answered by its own face (#688), in the files
      // that hold this build's characters.
      try {
        const standIns = await collectStandInPayloads(config, content, registeredStandIns);
        if (standIns.length > 0) {
          const keys = standIns.map(fontPayloadKey);
          await worker().registerFonts(standIns);
          for (const key of keys) registeredStandIns.add(key);
        }
      } catch (err) {
        console.warn('[LayoutService] stand-in font registration failed', err);
      }
    });
    fontQueue = next;
    await next;
  };

  /**
   * Whether the pages of `doc` are set in a face the worker was not sent
   * (#757): a weight and slant its configuration did not announce and the
   * regular, the bold and their italics do not cover (the italic of a
   * heading set at 600, the bold of a caption in a family cut by slices).
   * With the variable file every weight was there; with a file per weight
   * the pages say which ones they need. The service notes those faces (and
   * the page declares them), and the document has to be laid out again: on
   * a fresh worker, since the one that set it resolved those fonts without
   * their files and will not look again.
   */
  const lacksDocumentFonts = async (doc: VDTDocument): Promise<boolean> => {
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
    const lacking = await Promise.all(fresh.map(([family]) => lackingFaces(family).catch(() => [])));
    return lacking.some((faces) => faces.length > 0);
  };

  /** Start over on a fresh worker: the next build sends it its fonts. */
  const replaceWorker = (): void => {
    if (!createHandle) return;
    handle?.dispose();
    handle = null;
    registeredFamilies.clear();
    sentFaces.clear();
    registeredStandIns.clear();
    fontQueue = Promise.resolve();
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
      await ensureFonts(request.config, request.content);
      if (controller.signal.aborted) throw abortError();
      const buildOptions = {
        signal: controller.signal,
        onProgress: request.onProgress,
        onStats: (s: BuildStats) => { stats = s; },
        resourcesKey: request.content.resources ? resourcesKeyOf(request.content.resources) : undefined,
        cacheKey: request.cacheKey,
      };
      let doc = request.warmOnly && request.cacheKey
        ? await worker().warm(request.content, request.config, { ...buildOptions, cacheKey: request.cacheKey }).then(() => null)
        : await worker().build(request.content, request.config, buildOptions);
      // Laid out again when its pages set a face the worker did not have
      // (#757), on a fresh worker: once for the faces the first layout
      // names, once more for any the second brings.
      for (let round = 0; doc && round < FONT_ROUNDS; round++) {
        if (!(await lacksDocumentFonts(doc))) break;
        if (controller.signal.aborted) throw abortError();
        replaceWorker();
        await ensureFonts(request.config, request.content);
        if (controller.signal.aborted) throw abortError();
        doc = await worker().build(request.content, request.config, buildOptions);
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
      unsubscribeFonts();
      for (const q of queue.splice(0)) q.reject(abortError());
      if (active) interrupt(active, false);
      handle?.dispose();
    },
  };
}
