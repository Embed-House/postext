import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutWorkerHandle } from 'postext/worker';
import type { VDTDocument } from 'postext';

/** What the font loader answers: the faces a build's configuration asks
 *  of each family, the files of a cut (one per subset in `subsets`), the
 *  custom families, and the stand-ins not sent yet (#688). */
const fontLoader = vi.hoisted(() => ({
  uses: {} as Record<string, { weight: number; style: 'normal' | 'italic' }[]>,
  subsets: ['latin'] as string[],
  custom: [] as string[],
  /** Families cut by slices: no regular, bold and italics beyond the faces asked. */
  sliced: [] as string[],
  standIns: [] as { family: string; weight: string; style: string; buffer: ArrayBuffer }[],
  changed: null as ((families: string[]) => void) | null,
  /** The faces the page was told to declare. */
  pageLoads: [] as string[],
  /** What the files of a registration wait for before they are had. */
  files: null as Promise<void> | null,
  /** The files the network does not give (by URL), and the requests made
   *  for files. */
  failing: new Set<string>(),
  fileRequests: [] as string[][],
  unanswered: [] as string[],
}));

vi.mock('../controls/fontLoader', () => {
  const STANDARD = [{ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' }, { weight: 400, style: 'italic' }, { weight: 700, style: 'italic' }] as const;
  const key = (p: { family: string; weight: string; style: string; unicodeRange?: string }) => `${p.family}|${p.weight}|${p.style}|${p.unicodeRange ?? ''}`;
  return {
    configFontUses: () => new Map(Object.entries(fontLoader.uses)),
    getCustomFontFamily: (family: string) => (fontLoader.custom.includes(family) ? { name: family, variants: [] } : undefined),
    collectFontPayloadsForFamilies: async (families: string[]) => families.map((family) => ({ family, weight: '400', style: 'normal', buffer: new ArrayBuffer(1) })),
    // Every file of each cut asked, light to heavy, upright first.
    familyCutFaces: async (family: string, uses: { weight: number; style: string }[], options?: { standard?: boolean }) => {
      const asked = [...uses, ...(options?.standard && !fontLoader.sliced.includes(family) ? STANDARD : [])];
      const cuts = [...new Map(asked.map((u) => [`${u.weight}|${u.style}`, u])).values()]
        .sort((a, b) => a.weight - b.weight || (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1));
      return cuts.flatMap((u) => fontLoader.subsets.map((subset) => ({ family, weight: String(u.weight), style: u.style, unicodeRange: subset, url: `${family}-${subset}-${u.weight}-${u.style}` })));
    },
    fetchFacePayloads: async (faces: { family: string; weight: string; style: string; unicodeRange?: string; url: string }[]) => {
      fontLoader.fileRequests.push(faces.map((f) => f.url));
      if (fontLoader.files) await fontLoader.files;
      return faces
        .filter((f) => !fontLoader.failing.has(f.url))
        .map((f) => ({ family: f.family, weight: f.weight, style: f.style, unicodeRange: f.unicodeRange, buffer: new ArrayBuffer(1) }));
    },
    FONT_RETRY_MS: 30_000,
    unansweredFontRequests: () => fontLoader.unanswered,
    collectStandInPayloads: async (_config: unknown, _content: unknown, sent: ReadonlySet<string>) =>
      fontLoader.standIns.filter((p) => !sent.has(key(p))),
    fontPayloadKey: key,
    loadFont: async (family: string, uses: { weight: number; style: string }[]) => {
      fontLoader.pageLoads.push(...uses.map((u) => `${family} ${u.weight} ${u.style}`));
    },
    onCustomFontsChanged: (cb: (families: string[]) => void) => {
      fontLoader.changed = cb;
      return () => {};
    },
  };
});

import { createLayoutService, FONT_HOLD_MS, onLateFonts } from './LayoutService';

interface FakeBuild {
  markdown: string;
  cacheKey: string | undefined;
  finish: (doc?: VDTDocument) => void;
  aborted: boolean;
}

/** A worker handle whose builds finish when the test says so. */
function fakeHandle() {
  const builds: FakeBuild[] = [];
  const handle: LayoutWorkerHandle = {
    registerFonts: async () => {},
    unregisterFonts: async () => {},
    dispose: () => {},
    warm: (content, config, opts) => handle.build(content, config, { ...opts, wantDoc: false }).then(() => undefined),
    build: (content, _config, opts) =>
      new Promise<VDTDocument>((resolve, reject) => {
        const entry: FakeBuild = {
          markdown: content.markdown,
          cacheKey: opts?.cacheKey,
          aborted: false,
          finish: (doc) => resolve(doc ?? ({ pages: [], blocks: [] } as unknown as VDTDocument)),
        };
        opts?.signal?.addEventListener('abort', () => {
          entry.aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
        builds.push(entry);
      }),
  };
  return { handle, builds };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const content = (markdown: string) => ({ markdown });

describe('createLayoutService', () => {
  it('runs one build at a time, more urgent first', async () => {
    const { handle, builds } = fakeHandle();
    const service = createLayoutService({ handle });
    const bg = service.build({ clientId: 'paginator', priority: 'background', content: content('bg'), config: {} });
    await tick();
    const pdf = service.build({ clientId: 'pdf', priority: 'pdf', content: content('pdf'), config: {} });
    const preview = service.build({ clientId: 'canvas', priority: 'preview', content: content('preview'), config: {} });
    await tick();
    // The background build was interrupted for the preview; nothing else started.
    expect(builds.map((b) => b.markdown)).toEqual(['bg', 'preview']);
    expect(builds[0]!.aborted).toBe(true);
    builds[1]!.finish();
    await preview;
    await tick();
    // Then the PDF, then the interrupted background chapter again — its
    // promise still pending, never rejected.
    expect(builds.map((b) => b.markdown)).toEqual(['bg', 'preview', 'pdf']);
    builds[2]!.finish();
    await pdf;
    await tick();
    expect(builds.map((b) => b.markdown)).toEqual(['bg', 'preview', 'pdf', 'bg']);
    builds[3]!.finish();
    await expect(bg).resolves.toBeTruthy();
    service.dispose();
  });

  it('lets the last request of a client win', async () => {
    const { handle, builds } = fakeHandle();
    const service = createLayoutService({ handle });
    const first = service.build({ clientId: 'canvas', priority: 'preview', content: content('v1'), config: {} });
    await tick();
    const second = service.build({ clientId: 'canvas', priority: 'preview', content: content('v2'), config: {} });
    const third = service.build({ clientId: 'canvas', priority: 'preview', content: content('v3'), config: {} });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    // v2 never reached the worker; v3 runs once v1's cancel is acknowledged.
    expect(builds.map((b) => b.markdown)).toEqual(['v1', 'v3']);
    builds[1]!.finish();
    await expect(third).resolves.toBeTruthy();
    service.dispose();
  });

  it('sends the stand-in faces after the families\' own, each once (#688)', async () => {
    const { handle, builds } = fakeHandle();
    const registered: string[][] = [];
    handle.registerFonts = async (faces) => {
      registered.push(faces.map((f) => `${f.family} ${f.weight} ${f.style}`));
    };
    fontLoader.custom = ['Bangers'];
    fontLoader.uses = { Bangers: [{ weight: 400, style: 'normal' }] };
    fontLoader.standIns = [{ family: 'Bangers', weight: '600 900', style: 'normal', buffer: new ArrayBuffer(1) }];
    try {
      const service = createLayoutService({ handle });
      const first = service.build({ clientId: 'canvas', priority: 'preview', content: content('WHAM'), config: {} });
      await tick();
      expect(registered).toEqual([['Bangers 400 normal'], ['Bangers 600 900 normal']]);
      builds[0]!.finish();
      await first;
      // The next build has nothing new to send.
      const second = service.build({ clientId: 'canvas', priority: 'preview', content: content('WHAM!'), config: {} });
      await tick();
      builds[1]!.finish();
      await second;
      expect(registered).toHaveLength(2);
      // A family whose files change is sent again, its stand-ins too.
      fontLoader.changed?.(['Bangers']);
      const third = service.build({ clientId: 'canvas', priority: 'preview', content: content('WHAM!!'), config: {} });
      await tick();
      builds[2]!.finish();
      await third;
      expect(registered.slice(2)).toEqual([['Bangers 400 normal'], ['Bangers 600 900 normal']]);
      // A slice the text comes to need (a character of another file of
      // the face) is sent before the build that sets it, to the worker
      // that has measured with the family: its next build measures with
      // it (#760).
      fontLoader.standIns = [...fontLoader.standIns, { family: 'Bangers', weight: '600 900', style: 'italic', buffer: new ArrayBuffer(1) }];
      const fourth = service.build({ clientId: 'canvas', priority: 'preview', content: content('*WHAM*'), config: {} });
      await tick();
      expect(registered.slice(4)).toEqual([['Bangers 600 900 italic']]);
      expect(builds).toHaveLength(4);
      builds[3]!.finish();
      await fourth;
      service.dispose();
    } finally {
      fontLoader.custom = [];
      fontLoader.uses = {};
      fontLoader.standIns = [];
    }
  });

  it('passes the cache key through and cancels a client on request', async () => {
    const { handle, builds } = fakeHandle();
    const service = createLayoutService({ handle });
    const p = service.build({ clientId: 'canvas', priority: 'preview', content: content('x'), config: {}, cacheKey: 'k1' });
    await tick();
    expect(builds[0]!.cacheKey).toBe('k1');
    service.cancel('canvas');
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    service.dispose();
  });
});

// #757: a catalogue family is a file per weight, style and subset. The
// worker is sent the cuts a build is set in before it lays it out, each
// with all its files. A face its pages name that it was not sent goes to
// the same worker, and the document is laid out again: the engine's worker
// measures with a face that arrives after a build (#760).
describe('the static cuts a build is sent (#757)', () => {
  /** A document whose text is set in `fonts` (CSS font shorthands). */
  const docSetIn = (...fonts: string[]) => ({
    pages: [],
    blocks: fonts.map((fontString) => ({ fontString, lines: [{ segments: [] }] })),
  }) as unknown as VDTDocument;

  /** A handle that records what it is sent. */
  function recording() {
    const { handle, builds } = fakeHandle();
    const registered: string[][] = [];
    const unregistered: string[][] = [];
    handle.registerFonts = async (faces) => {
      registered.push(faces.map((f) => `${f.family} ${f.weight} ${f.style} ${f.unicodeRange}`));
    };
    handle.unregisterFonts = async (families) => {
      unregistered.push(families);
    };
    return { handle, builds, registered, unregistered };
  }

  const reset = () => {
    fontLoader.uses = {};
    fontLoader.subsets = ['latin'];
    fontLoader.sliced = [];
    fontLoader.pageLoads = [];
  };

  it('sends every file of each cut the configuration asks for, and of the regular, the bold and their italics, before the build', async () => {
    const { handle, builds, registered, unregistered } = recording();
    fontLoader.uses = { 'Source Serif 4': [{ weight: 600, style: 'normal' }] };
    fontLoader.subsets = ['latin', 'latin-ext'];
    try {
      const service = createLayoutService({ handle });
      const first = service.build({ clientId: 'canvas', priority: 'preview', content: content('One'), config: {} });
      await tick();
      // One message, the cuts in order, every subset of each: the worker
      // has them all before it measures a word.
      expect(registered).toEqual([[
        'Source Serif 4 400 normal latin', 'Source Serif 4 400 normal latin-ext',
        'Source Serif 4 400 italic latin', 'Source Serif 4 400 italic latin-ext',
        'Source Serif 4 600 normal latin', 'Source Serif 4 600 normal latin-ext',
        'Source Serif 4 700 normal latin', 'Source Serif 4 700 normal latin-ext',
        'Source Serif 4 700 italic latin', 'Source Serif 4 700 italic latin-ext',
      ]]);
      expect(builds).toHaveLength(1);
      builds[0]!.finish(docSetIn('600 20px "Source Serif 4"', 'italic 400 12px "Source Serif 4"'));
      await first;
      expect(builds).toHaveLength(1);
      // Nothing more for the same faces; a weight the configuration gains
      // is sent alone, before the build that sets it.
      fontLoader.uses = { 'Source Serif 4': [{ weight: 600, style: 'normal' }, { weight: 300, style: 'normal' }] };
      const second = service.build({ clientId: 'canvas', priority: 'preview', content: content('Two'), config: {} });
      await tick();
      expect(registered.slice(1)).toEqual([['Source Serif 4 300 normal latin', 'Source Serif 4 300 normal latin-ext']]);
      expect(unregistered).toEqual([]);
      // The page declares the cut too: it paints with what the worker measures with.
      expect(fontLoader.pageLoads).toEqual(['Source Serif 4 600 normal', 'Source Serif 4 400 italic', 'Source Serif 4 300 normal']);
      builds[1]!.finish(docSetIn('300 20px "Source Serif 4"'));
      await second;
      service.dispose();
    } finally {
      reset();
    }
  });

  it('sends the worker a face its pages name that it was not sent, and lays the document out again', async () => {
    const { handle, builds, registered, unregistered } = recording();
    fontLoader.uses = { Geist: [{ weight: 600, style: 'normal' }] };
    try {
      const service = createLayoutService({ handle });
      const build = service.build({ clientId: 'canvas', priority: 'preview', content: content('# A *title*'), config: {}, cacheKey: 'k' });
      await tick();
      expect(registered).toHaveLength(1);
      // The pages set the italic of the heading weight: no file of it was sent.
      builds[0]!.finish(docSetIn('600 20px Geist', 'italic 600 20px Geist'));
      await tick();
      await tick();
      // The page declares it, and the worker it has gets its files: no
      // other face is sent again, none is taken away.
      expect(fontLoader.pageLoads).toEqual(['Geist 600 normal', 'Geist 600 italic']);
      expect(registered.slice(1)).toEqual([['Geist 600 italic latin']]);
      expect(unregistered).toEqual([]);
      expect(builds.map((b) => b.cacheKey)).toEqual(['k', 'k']);
      const again = docSetIn('600 20px Geist', 'italic 600 20px Geist');
      builds[1]!.finish(again);
      await expect(build).resolves.toBe(again);
      // The next build of the book has its faces from the start.
      const next = service.build({ clientId: 'canvas', priority: 'preview', content: content('# B'), config: {} });
      await tick();
      builds[2]!.finish(docSetIn('italic 600 20px Geist'));
      await next;
      expect(registered).toHaveLength(2);
      expect(builds).toHaveLength(3);
      service.dispose();
    } finally {
      reset();
    }
  });

  it('builds once when the pages are set in the faces the worker has: the regular, the bold and their italics need no asking', async () => {
    const { handle, builds, registered } = recording();
    fontLoader.uses = { Geist: [{ weight: 500, style: 'normal' }] };
    try {
      const service = createLayoutService({ handle });
      const build = service.build({ clientId: 'canvas', priority: 'preview', content: content('A **bold** *word*'), config: {} });
      await tick();
      const doc = docSetIn('500 12px Geist', '700 12px Geist', 'italic 400 12px Geist', 'italic 700 12px Geist');
      builds[0]!.finish(doc);
      await expect(build).resolves.toBe(doc);
      expect(builds).toHaveLength(1);
      expect(registered).toHaveLength(1);
      // The page is told all the same: it declares a cut when it is set.
      expect(fontLoader.pageLoads.sort()).toEqual(['Geist 400 italic', 'Geist 500 normal', 'Geist 700 italic', 'Geist 700 normal']);
      service.dispose();
    } finally {
      reset();
    }
  });

  it('asks a family cut by slices for the faces set alone, and sends the bold its pages bring', async () => {
    const { handle, builds, registered } = recording();
    fontLoader.uses = { 'Noto Serif JP': [{ weight: 400, style: 'normal' }] };
    fontLoader.subsets = ['latin', '119', '118'];
    fontLoader.sliced = ['Noto Serif JP'];
    try {
      const service = createLayoutService({ handle });
      const build = service.build({ clientId: 'canvas', priority: 'preview', content: content('本'), config: {} });
      await tick();
      expect(registered).toEqual([['Noto Serif JP 400 normal latin', 'Noto Serif JP 400 normal 119', 'Noto Serif JP 400 normal 118']]);
      builds[0]!.finish(docSetIn('400 12px "Noto Serif JP"', '700 12px "Noto Serif JP"'));
      await tick();
      await tick();
      expect(registered.slice(1)).toEqual([['Noto Serif JP 700 normal latin', 'Noto Serif JP 700 normal 119', 'Noto Serif JP 700 normal 118']]);
      builds[1]!.finish(docSetIn('400 12px "Noto Serif JP"', '700 12px "Noto Serif JP"'));
      await build;
      service.dispose();
    } finally {
      reset();
    }
  });

  it('gives up after two more layouts when every one names another face', async () => {
    const { handle, builds } = recording();
    fontLoader.uses = { Geist: [{ weight: 400, style: 'normal' }] };
    try {
      const service = createLayoutService({ handle });
      const build = service.build({ clientId: 'canvas', priority: 'preview', content: content('x'), config: {} });
      for (const weight of [300, 500, 800]) {
        await tick();
        await tick();
        builds.at(-1)!.finish(docSetIn(`${weight} 12px Geist`));
      }
      await build;
      expect(builds).toHaveLength(3);
      service.dispose();
    } finally {
      reset();
    }
  });
});

describe('a build and a file that is slow or does not come (#757)', () => {
  const reset = () => {
    fontLoader.uses = { Lora: [{ weight: 400, style: 'normal' }] };
    fontLoader.subsets = ['latin'];
    fontLoader.sliced = ['Lora'];
    fontLoader.pageLoads = [];
    fontLoader.files = null;
    fontLoader.failing = new Set();
    fontLoader.fileRequests = [];
    fontLoader.unanswered = [];
  };
  /** A handle that records, in order, what the worker is asked. */
  function ordered() {
    const { handle, builds } = fakeHandle();
    const log: string[] = [];
    const build = handle.build;
    handle.build = (content, config, opts) => {
      log.push(`build ${content.markdown}`);
      return build(content, config, opts).then((doc) => {
        log.push(`built ${content.markdown}`);
        return doc;
      });
    };
    handle.registerFonts = async (faces) => {
      log.push(`register ${faces.map((f) => `${f.family} ${f.weight}`).join(', ')}`);
    };
    return { handle, builds, log };
  }
  const late = () => {
    const told: string[][] = [];
    const off = onLateFonts((families) => told.push(families));
    return { told, off };
  };

  afterEach(() => {
    vi.useRealTimers();
    fontLoader.files = null;
    fontLoader.failing = new Set();
    fontLoader.unanswered = [];
    fontLoader.sliced = [];
  });

  it('waits for the files that come in time: they are registered before the build, and nobody is told', async () => {
    reset();
    const { handle, builds, log } = ordered();
    const { told, off } = late();
    const service = createLayoutService({ handle });
    const built = service.build({ clientId: 'canvas', priority: 'preview', content: content('a'), config: {} });
    await tick();
    builds[0]!.finish();
    await built;
    expect(log).toEqual(['register Lora 400', 'build a', 'built a']);
    expect(told).toEqual([]);
    expect(FONT_HOLD_MS).toBeLessThanOrEqual(10_000);
    off();
    service.dispose();
  });

  it('lays the chapter out with the faces the worker has when a file outlasts the hold, registers it once the build is over and tells the views', async () => {
    reset();
    vi.useFakeTimers();
    let arrive!: () => void;
    fontLoader.files = new Promise<void>((resolve) => { arrive = resolve; });
    const { handle, builds, log } = ordered();
    const { told, off } = late();
    const service = createLayoutService({ handle, fontHoldMs: 500 });
    const built = service.build({ clientId: 'canvas', priority: 'preview', content: content('a'), config: {} });
    await vi.advanceTimersByTimeAsync(499);
    // Held for its file.
    expect(log).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    // No longer: the chapter is laid out without it.
    expect(log).toEqual(['build a']);
    // The file lands while the worker lays out: its faces wait for the
    // build, which would otherwise be measured half with them.
    arrive();
    await vi.advanceTimersByTimeAsync(50);
    expect(log).toEqual(['build a']);
    expect(told).toEqual([]);
    builds[0]!.finish();
    await built;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['build a', 'built a', 'register Lora 400']);
    expect(told).toEqual([['Lora']]);
    // The view lays out again: nothing to wait for, the faces are there.
    const again = service.build({ clientId: 'canvas', priority: 'preview', content: content('a'), config: {} });
    await vi.advanceTimersByTimeAsync(0);
    builds[1]!.finish();
    await again;
    expect(log.slice(3)).toEqual(['build a', 'built a']);
    expect(told).toHaveLength(1);
    off();
    service.dispose();
  });

  it('waits for the files without a bound when the host asks so (the headless entry)', async () => {
    reset();
    vi.useFakeTimers();
    let arrive!: () => void;
    fontLoader.files = new Promise<void>((resolve) => { arrive = resolve; });
    const { handle, builds, log } = ordered();
    const { told, off } = late();
    const service = createLayoutService({ handle, fontHoldMs: Infinity });
    const built = service.build({ clientId: 'headless', priority: 'background', content: content('a'), config: {} });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(log).toEqual([]);
    arrive();
    await vi.advanceTimersByTimeAsync(0);
    builds[0]!.finish();
    await built;
    expect(log).toEqual(['register Lora 400', 'build a', 'built a']);
    expect(told).toEqual([]);
    off();
    service.dispose();
  });

  it('asks again, a while later, for a file the network did not give, and tells the views when it arrives', async () => {
    reset();
    vi.useFakeTimers();
    fontLoader.uses = { Lora: [{ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' }] };
    fontLoader.failing = new Set(['Lora-latin-700-normal']);
    const { handle, builds, log } = ordered();
    const { told, off } = late();
    const service = createLayoutService({ handle });
    const built = service.build({ clientId: 'canvas', priority: 'preview', content: content('a'), config: {} });
    await vi.advanceTimersByTimeAsync(0);
    builds[0]!.finish();
    await built;
    // Laid out with the regular alone.
    expect(log).toEqual(['register Lora 400', 'build a', 'built a']);
    // Nobody builds; the network gives the file at the next try.
    fontLoader.failing = new Set();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fontLoader.fileRequests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fontLoader.fileRequests).toEqual([['Lora-latin-400-normal', 'Lora-latin-700-normal'], ['Lora-latin-700-normal']]);
    expect(log).toEqual(['register Lora 400', 'build a', 'built a', 'register Lora 700']);
    expect(told).toEqual([['Lora']]);
    // Nothing is short any more: no further try.
    await vi.advanceTimersByTimeAsync(200_000);
    expect(fontLoader.fileRequests).toHaveLength(2);
    off();
    service.dispose();
  });

  it('gives a file up after three more tries, and asks for it no more without a build', async () => {
    reset();
    vi.useFakeTimers();
    fontLoader.failing = new Set(['Lora-latin-400-normal']);
    const { handle, builds } = ordered();
    const { told, off } = late();
    const service = createLayoutService({ handle });
    const built = service.build({ clientId: 'canvas', priority: 'preview', content: content('a'), config: {} });
    await vi.advanceTimersByTimeAsync(0);
    builds[0]!.finish();
    await built;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fontLoader.fileRequests).toHaveLength(4);
    expect(told).toEqual([]);
    off();
    service.dispose();
  });

  it('asks no more once disposed', async () => {
    reset();
    vi.useFakeTimers();
    fontLoader.failing = new Set(['Lora-latin-400-normal']);
    const { handle, builds } = ordered();
    const service = createLayoutService({ handle });
    const built = service.build({ clientId: 'canvas', priority: 'preview', content: content('a'), config: {} });
    await vi.advanceTimersByTimeAsync(0);
    builds[0]!.finish();
    await built;
    service.dispose();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fontLoader.fileRequests).toHaveLength(1);
  });
});
