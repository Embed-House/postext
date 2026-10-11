import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fontFallbacks, type FontFaceLike, type PostextConfig } from 'postext';

// Where the Sandbox takes a family's faces from and which it declares
// beside them, against the answers Fontsource and Google Fonts give for
// the families of the recipes the defects were found on: a comic face with
// one weight (Bangers, #688), a family Google Fonts does not serve next to
// one it does (Commit Mono and Host Grotesk, #689).

type Loader = typeof import('./fontLoader');

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153';
const LATIN_EXT = 'U+0100-02BA, U+1E00-1E9F';
const VIETNAMESE = 'U+0102-0103, U+1EA0-1EF9, U+20AB';

/** A Google style sheet: one rule per file, as css2 answers. */
function googleCss(family: string, rules: { weight: string; style?: string; range: string; file: string }[]): string {
  return rules.map((r) => `@font-face {
  font-family: '${family}';
  font-style: ${r.style ?? 'normal'};
  font-weight: ${r.weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/${r.file}.woff2) format('woff2');
  unicode-range: ${r.range};
}`).join('\n');
}

const BANGERS_CSS = googleCss('Bangers', [
  { weight: '400', range: VIETNAMESE, file: 'bangers/vietnamese' },
  { weight: '400', range: LATIN_EXT, file: 'bangers/latin-ext' },
  { weight: '400', range: LATIN, file: 'bangers/latin' },
]);
const HOST_CSS = googleCss('Host Grotesk', [
  { weight: '300 800', range: LATIN_EXT, file: 'hostgrotesk/latin-ext' },
  { weight: '300 800', range: LATIN, file: 'hostgrotesk/latin' },
  { weight: '300 800', style: 'italic', range: LATIN, file: 'hostgrotesk/latin-italic' },
]);

const COMMIT_MONO = {
  family: 'Commit Mono', type: 'other', variable: false, weights: [400, 700], styles: ['normal', 'italic'], unicodeRange: {},
  variants: Object.fromEntries(['400', '700'].map((w) => [w, Object.fromEntries(['normal', 'italic'].map((s) => [s, {
    latin: { url: { woff2: `https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-${w}-${s}.woff2`, ttf: 'unused' } },
  }]))])),
};

/** What the network answers, by URL prefix: a string is a body, an Error a
 *  request that rejects (a response with no CORS headers), a number a
 *  status. Font files answer their own URL as bytes. */
let routes: Record<string, string | object | Error | number>;
let requests: string[];
/** Files answered later the earlier they are asked for. */
let reverseArrival = false;

function stubFetch(): void {
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('.woff2')) {
      if (reverseArrival) await new Promise((r) => setTimeout(r, Math.max(0, 30 - requests.length * 5)));
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
    }
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const answer = key === undefined ? 404 : routes[key]!;
    if (answer instanceof Error) throw answer;
    if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => answer, text: async () => String(answer) };
  });
}

const fontsource = (id: string) => `https://api.fontsource.org/v1/fonts/${id}`;
const google = (family: string) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}`;
const fileOf = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

class FakeFace implements FontFaceLike {
  status = 'unloaded';
  weight: string;
  style: string;
  unicodeRange?: string;
  constructor(readonly family: string, readonly source: string, d: { weight?: string; style?: string; unicodeRange?: string } = {}) {
    this.weight = d.weight ?? '400';
    this.style = d.style ?? 'normal';
    this.unicodeRange = d.unicodeRange;
  }
}

/** `document.fonts`, as far as the loader uses it. */
class FakeFontSet {
  faces: FakeFace[] = [];
  loads: string[] = [];
  readonly ready = Promise.resolve();
  [Symbol.iterator](): Iterator<FontFaceLike> {
    return this.faces[Symbol.iterator]();
  }
  add(face: FakeFace): this {
    this.faces.push(face);
    return this;
  }
  check(): boolean {
    return true;
  }
  /** Loads the faces of the family, weight and slant asked (no matching
   *  beyond a face whose range holds the weight). */
  async load(font: string): Promise<FontFaceLike[]> {
    this.loads.push(font);
    const m = /^(italic )?(\d+) 16px "(.+)"$/.exec(font);
    if (!m) return [];
    const hit = this.faces.filter((f) => {
      const [lo, hi = lo] = f.weight.split(' ').map(Number) as [number, number?];
      return f.family === m[3] && (f.style === 'italic') === !!m[1] && Number(m[2]) >= lo && Number(m[2]) <= hi;
    });
    for (const f of hit) f.status = 'loaded';
    return hit;
  }
  declared(family: string): string[] {
    return this.faces.filter((f) => f.family === family).map((f) => `${f.weight} ${f.style}`);
  }
}

const globals = globalThis as { document?: unknown; FontFace?: unknown };
let previous: { document?: unknown; FontFace?: unknown };
let fonts: FakeFontSet;
let loader: Loader;

beforeEach(async () => {
  routes = {};
  requests = [];
  reverseArrival = false;
  stubFetch();
  previous = { document: globals.document, FontFace: globals.FontFace };
  fonts = new FakeFontSet();
  // No `createElement`: a style sheet link would throw.
  globals.document = { fonts };
  globals.FontFace = FakeFace;
  vi.resetModules();
  loader = await import('./fontLoader');
});

afterEach(() => {
  globals.document = previous.document;
  globals.FontFace = previous.FontFace;
  vi.unstubAllGlobals();
});

const face = (weight: string, style = 'normal', unicodeRange = LATIN) => ({ weight, style, unicodeRange });

describe('standInFaces (#688)', () => {
  it('gives a family with one weight its own file for 600 to 900, slice by slice', async () => {
    const own = [face('400', 'normal', VIETNAMESE), face('400', 'normal', LATIN_EXT), face('400')];
    expect(loader.standInFaces(own)).toEqual([face('600 900', 'normal', VIETNAMESE), face('600 900', 'normal', LATIN_EXT), face('600 900')]);
  });

  it('gives a family with no italic the upright cut of each italic asked', () => {
    expect(loader.standInFaces([face('400')], [400, 700])).toEqual([face('600 900'), face('400', 'italic'), face('600 900', 'italic')]);
    // A variable upright answers both italics with one face.
    expect(loader.standInFaces([face('200 900')], [400, 700])).toEqual([face('200 900', 'italic')]);
    // None asked, none declared.
    expect(loader.standInFaces([face('200 900')])).toEqual([]);
  });

  it('declares nothing for a family with a bold and an italic of its own', () => {
    const own = [face('400'), face('700'), face('400', 'italic'), face('700', 'italic')];
    expect(loader.standInFaces(own, [400, 700])).toEqual([]);
  });

  it('takes the heaviest cut for the bold, in each slant', () => {
    const own = [face('300'), face('400'), face('300', 'italic'), face('400', 'italic')];
    expect(loader.standInFaces(own, [700])).toEqual([face('600 900'), face('600 900', 'italic')]);
  });

  it('leaves a weight another real face answers to the browser: the italic keeps the weight of its cut', () => {
    // An italic 600 of an upright 400 and 700 is the 700 set upright: a
    // neighbour, which the engine still reports (#650).
    const standIns = loader.standInFaces([face('400'), face('700')], [600]);
    expect(standIns).toEqual([face('700', 'italic')]);
  });

  it('answers the engine: no fontFallback for the bold and the italic of a one-weight family, a neighbour still reported', () => {
    const loaded = (f: { weight: string; style: string }): FontFaceLike => ({ family: 'Bangers', weight: f.weight, style: f.style, status: 'loaded' });
    const own = [face('400')];
    const asked = [
      { family: 'Bangers', weight: 700, style: 'normal' as const },
      { family: 'Bangers', weight: 400, style: 'italic' as const },
      { family: 'Bangers', weight: 700, style: 'italic' as const },
    ];
    expect(fontFallbacks(asked, own.map(loaded), { measureWidth: null }).map((f) => f.reason)).toEqual(['synthesized', 'synthesized', 'synthesized']);
    const set = [...own, ...loader.standInFaces(own, [400, 700])].map(loaded);
    expect(fontFallbacks(asked, set, { measureWidth: null })).toEqual([]);
    expect(fontFallbacks([{ family: 'Bangers', weight: 500, style: 'normal' }], set, { measureWidth: null })).toEqual([
      { family: 'Bangers', weight: 500, style: 'normal', reason: 'synthesized' },
    ]);
  });
});

describe('askedItalics (#688)', () => {
  it('asks the italics of the faces comic pages are lettered in', () => {
    const asked = loader.askedItalics({ locale: 'en' }, ':::page\n::panel\nhana{inner}: I can see it.\n:::');
    expect(asked.get('Comic Neue')).toEqual([400, 700]);
    expect(asked.get('Bangers')).toEqual([400, 700]);
  });

  it('asks the italics the configuration sets, and no others', () => {
    const config: PostextConfig = { bodyText: { fontFamily: 'Oswald' }, headings: { fontFamily: 'Bebas Neue' } };
    const asked = loader.askedItalics(config, 'Some *emphasis*.');
    expect(asked.get('Oswald')).toEqual([400, 700]);
    expect(asked.has('Bebas Neue')).toBe(false);
  });
});

const COMIC = ':::page\n::panel\nsfx: WHAM\n:::';
const COMIC_CONFIG: PostextConfig = { locale: 'en', comics: { lettering: { fontFamily: 'Bangers' } }, bodyText: { fontFamily: 'Bangers' }, headings: { fontFamily: 'Bangers' } };

describe('the stand-ins of a build (#688)', () => {
  beforeEach(() => {
    routes[fontsource('bangers')] = { type: 'google', variable: false, weights: [400], styles: ['normal'] };
    routes[google('Bangers')] = BANGERS_CSS;
  });

  it('sends the worker the family\'s own files as its bold and its italics, for the characters of the text', async () => {
    const payloads = await loader.collectStandInPayloads(COMIC_CONFIG, { markdown: COMIC });
    const bangers = payloads.filter((p) => p.family === 'Bangers');
    // The text is ASCII: the latin file, under the three faces the family lacks.
    expect(bangers.map((p) => `${p.weight} ${p.style} ${fileOf(p.buffer)}`)).toEqual([
      '600 900 normal https://fonts.gstatic.com/s/bangers/latin.woff2',
      '400 italic https://fonts.gstatic.com/s/bangers/latin.woff2',
      '600 900 italic https://fonts.gstatic.com/s/bangers/latin.woff2',
    ]);
    expect(bangers.every((p) => p.unicodeRange === LATIN)).toBe(true);
    // Each payload has a buffer of its own (they are transferred together).
    expect(new Set(bangers.map((p) => p.buffer)).size).toBe(3);
  });

  it('sends a face once, and the file of a character the text gains', async () => {
    const first = await loader.collectStandInPayloads(COMIC_CONFIG, { markdown: COMIC });
    const sent = new Set(first.map(loader.fontPayloadKey));
    expect(await loader.collectStandInPayloads(COMIC_CONFIG, { markdown: COMIC }, sent)).toEqual([]);
    const more = await loader.collectStandInPayloads(COMIC_CONFIG, { markdown: COMIC.replace('WHAM', 'Ầ') }, sent);
    expect(more.map((p) => `${p.weight} ${p.style} ${p.unicodeRange}`)).toEqual([
      `600 900 normal ${VIETNAMESE}`, `400 italic ${VIETNAMESE}`, `600 900 italic ${VIETNAMESE}`,
    ]);
  });

  it('declares them on the page beside the family\'s faces, and loads them', async () => {
    expect(loader.standInsSettled(COMIC_CONFIG, COMIC)).toBe(false);
    expect(await loader.declareStandIns(COMIC_CONFIG, COMIC)).toBe(true);
    expect(fonts.declared('Bangers')).toEqual([
      '600 900 normal', '600 900 normal', '600 900 normal',
      '400 italic', '400 italic', '400 italic',
      '600 900 italic', '600 900 italic', '600 900 italic',
    ]);
    expect(fonts.faces[2]!.source).toBe('url("https://fonts.gstatic.com/s/bangers/latin.woff2") format(\'woff2\')');
    expect(fonts.faces[2]!.unicodeRange).toBe(LATIN);
    expect(fonts.loads).toEqual(expect.arrayContaining(['600 16px "Bangers"', 'italic 400 16px "Bangers"', 'italic 600 16px "Bangers"']));
    expect(fonts.faces.every((f) => f.status === 'loaded')).toBe(true);
    // Once: nothing is declared twice.
    expect(loader.standInsSettled(COMIC_CONFIG, COMIC)).toBe(true);
    expect(await loader.declareStandIns(COMIC_CONFIG, COMIC)).toBe(false);
    expect(fonts.faces).toHaveLength(9);
  });

  it('is declared by the wait of the previews before their faces are checked', async () => {
    await loader.ensureConfigFontsLoaded(COMIC_CONFIG, COMIC);
    expect(fonts.declared('Bangers')).toContain('600 900 normal');
    expect(loader.standInsSettled(COMIC_CONFIG, COMIC)).toBe(true);
  });

  it('settles a family whose faces cannot be had, with nothing declared', async () => {
    routes[google('Bangers')] = new TypeError('Failed to fetch');
    expect(await loader.declareStandIns(COMIC_CONFIG, COMIC)).toBe(false);
    expect(fonts.faces).toEqual([]);
    expect(loader.standInsSettled(COMIC_CONFIG, COMIC)).toBe(true);
  });
});

describe('a family Google Fonts does not serve (#689)', () => {
  beforeEach(() => {
    routes[fontsource('host-grotesk')] = { type: 'google', variable: true, weights: [300, 400, 500, 600, 700, 800], styles: ['italic', 'normal'] };
    routes[google('Host Grotesk')] = HOST_CSS;
  });

  it('costs the other families of the build none of their faces when its request rejects', async () => {
    // Fontsource down for this family: Google is asked, and its 400 has no CORS headers.
    routes[fontsource('commit-mono')] = 503;
    routes[google('Commit Mono')] = new TypeError('Failed to fetch');
    const payloads = await loader.collectFontPayloadsForFamilies(['Host Grotesk', 'Commit Mono']);
    expect(payloads.map((p) => `${p.family} ${p.weight} ${p.style}`)).toEqual([
      'Host Grotesk 300 800 normal', 'Host Grotesk 300 800 normal', 'Host Grotesk 300 800 italic',
    ]);
  });

  it('is loaded from Fontsource, and Google is not asked for it', async () => {
    routes[fontsource('commit-mono')] = COMMIT_MONO;
    routes[google('Commit Mono')] = new TypeError('Failed to fetch');
    const payloads = await loader.collectFontPayloadsForFamilies(['Host Grotesk', 'Commit Mono']);
    expect(payloads.filter((p) => p.family === 'Commit Mono').map((p) => `${p.weight} ${p.style} ${fileOf(p.buffer)}`)).toEqual([
      '400 normal https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-400-normal.woff2',
      '400 italic https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-400-italic.woff2',
      '700 normal https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-700-normal.woff2',
      '700 italic https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-700-italic.woff2',
    ]);
    expect(payloads.filter((p) => p.family === 'Host Grotesk')).toHaveLength(3);
    expect(requests.some((u) => u.startsWith(google('Commit Mono')))).toBe(false);
  });

  it('is declared on the page as faces of its own, with no style sheet', async () => {
    routes[fontsource('commit-mono')] = COMMIT_MONO;
    await loader.loadFont('Commit Mono');
    expect(fonts.declared('Commit Mono')).toEqual(['400 normal', '400 italic', '700 normal', '700 italic']);
    expect(fonts.faces.every((f) => f.status === 'loaded')).toBe(true);
    expect(requests.some((u) => u.includes('fonts.googleapis.com'))).toBe(false);
  });

  it('is not asked for again at every build while it cannot be had', async () => {
    routes[fontsource('commit-mono')] = 404;
    routes[google('Commit Mono')] = new TypeError('Failed to fetch');
    await loader.collectFontPayloadsForFamilies(['Commit Mono']);
    await loader.collectFontPayloadsForFamilies(['Commit Mono']);
    await loader.collectStandInPayloads({ bodyText: { fontFamily: 'Commit Mono' } }, { markdown: 'Text.' });
    expect(requests.filter((u) => u.startsWith(google('Commit Mono')))).toHaveLength(1);
  });
});

describe('the files of a family sent to the worker (#689)', () => {
  it('keep the order of the style sheet, whatever order they arrive in', async () => {
    routes[fontsource('bangers')] = { type: 'google', variable: false, weights: [400], styles: ['normal'] };
    routes[google('Bangers')] = BANGERS_CSS;
    reverseArrival = true;
    const payloads = await loader.collectFontPayloadsForFamilies(['Bangers']);
    expect(payloads.map((p) => p.unicodeRange)).toEqual([VIETNAMESE, LATIN_EXT, LATIN]);
  });
});
