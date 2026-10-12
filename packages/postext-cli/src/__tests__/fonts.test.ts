import { describe, expect, it } from 'bun:test';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { EMBEDDED_FACES, readEmbedded } from '../assets';
import { fontsourceFiles, matchedFace, matchedVariants, readFontMeta, resolveFonts, restyleFace, skiaFontShorthand, wantedVariants, type FamilyMeta } from '../fonts';
import type { Book } from '../input';
import type { Reporter } from '../log';

const regular = () => readEmbedded(EMBEDDED_FACES.find((f) => f.family === 'Open Sans' && f.weight === 400 && f.style === 'normal')!.path);

describe('matchedVariants', () => {
  const oneWeight: FamilyMeta = { available: true, weights: [400], styles: ['normal'], checkedAt: 0 };
  it('answers the regular, the bold and their italics of a one-weight family with one file', () => {
    const asked = [{ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' }, { weight: 400, style: 'italic' }, { weight: 700, style: 'italic' }] as const;
    expect(matchedVariants(asked, oneWeight)).toEqual([{ weight: 400, style: 'normal' }]);
  });
  it('keeps the weight of each style a family ships that answers for the one asked', () => {
    const meta: FamilyMeta = { available: true, weights: [300, 400, 700], styles: ['normal', 'italic'], checkedAt: 0 };
    expect(matchedVariants([{ weight: 800, style: 'italic' }, { weight: 700, style: 'italic' }, { weight: 500, style: 'normal' }], meta))
      .toEqual([{ weight: 700, style: 'italic' }, { weight: 400, style: 'normal' }]);
  });
  // #757: the nearest weight was fetched and embedded, where the canvas, a
  // browser, the Sandbox and the PDF writer set the one CSS font matching
  // settles on.
  it('fetches the weight CSS font matching settles on, not the nearest', () => {
    const meta: FamilyMeta = { available: true, weights: [400, 700], styles: ['normal', 'italic'], checkedAt: 0 };
    const answer = (weight: number) => matchedVariants([{ weight, style: 'normal' }], meta)[0]!.weight;
    // Above 500 the heavier cuts first: a 550 is as near the 400, a 510 nearer.
    expect([510, 550, 600, 650].map(answer)).toEqual([700, 700, 700, 700]);
    // From 400 to 500 the cuts up to 500, then the lighter ones.
    expect([450, 500].map(answer)).toEqual([400, 400]);
    // Below 400 the lighter ones first, then the heavier.
    expect([100, 300].map(answer)).toEqual([400, 400]);
    const five: FamilyMeta = { available: true, weights: [300, 400, 500, 900], styles: ['normal'], checkedAt: 0 };
    const of = (weight: number) => matchedVariants([{ weight, style: 'normal' }], five)[0]!.weight;
    expect([350, 420, 450, 600, 950].map(of)).toEqual([300, 500, 500, 900, 900]);
  });
});

describe('matchedFace (#757)', () => {
  const face = (weight: number, style: 'normal' | 'italic' = 'normal') => ({ weight, style });
  it('embeds the face the lines were measured with: the weight CSS font matching settles on, in the style asked', () => {
    const faces = [face(400), face(700), face(400, 'italic'), face(700, 'italic')];
    expect(matchedFace(faces, 550, 'normal')).toEqual(face(700));
    expect(matchedFace(faces, 600, 'italic')).toEqual(face(700, 'italic'));
    expect(matchedFace(faces, 300, 'normal')).toEqual(face(400));
    expect(matchedFace(faces, 700, 'normal')).toEqual(face(700));
  });
  it('takes the upright of a family with no italic, and nothing of a family with no face', () => {
    expect(matchedFace([face(400), face(700)], 550, 'italic')).toEqual(face(700));
    expect(matchedFace([], 400, 'normal')).toBeUndefined();
  });
});

describe('the weight Skia is asked for (#757)', () => {
  // Open Sans, compiled into the executable in 400 and 700, as a book's own
  // family with a 400 and an 800 (the bold's bytes): two cuts no weight
  // between them is nearer to than CSS font matching says.
  const regular400 = readEmbedded(EMBEDDED_FACES.find((f) => f.family === 'Open Sans' && f.weight === 400 && f.style === 'normal')!.path);
  const bold = readEmbedded(EMBEDDED_FACES.find((f) => f.family === 'Open Sans' && f.weight === 700 && f.style === 'normal')!.path);
  const family = 'Probe Sans';
  const book = {
    kind: 'folder', name: 'probe', id: 'probe', locale: 'en', resources: [], files: new Map(), watchPaths: [],
    config: { bodyText: { fontFamily: family } },
    chapters: [{ title: 'One', markdown: 'Text.' }],
    fonts: [
      { family, weight: 400, style: 'normal', file: 'probe-400.ttf', bytes: regular400 },
      { family, weight: 800, style: 'normal', file: 'probe-800.ttf', bytes: restyleFace(bold, 800, 'normal')! },
    ],
  } as unknown as Book;
  const silent = { info: () => {}, warn: () => {}, time: async <T>(_name: string, run: () => T | Promise<T>) => run() } as unknown as Reporter;
  const width = (weight: number) => {
    const ctx = createCanvas(10, 10).getContext('2d');
    ctx.font = `${weight} 40px "${family}"`;
    return ctx.measureText('Hamburgefonstiv 0123').width;
  };

  it('measures a weight between two cuts with the face CSS font matching settles on, the one the PDF embeds', async () => {
    const fonts = await resolveFonts(book, { fontDirs: [], offline: true }, silent);
    const light = width(400);
    const heavy = width(800);
    expect(heavy).toBeGreaterThan(light);
    // The canvas took 550 for the size and measured the text 550 px tall.
    for (const weight of [510, 550, 650]) {
      expect(width(weight)).toBe(heavy);
      expect(fonts.pick(family, weight, 'normal')!.weight).toBe(800);
    }
    // From 400 to 500 the cuts up to 500 first, then the lighter ones: the 400.
    for (const weight of [420, 450]) {
      expect(width(weight)).toBe(light);
      expect(fonts.pick(family, weight, 'normal')!.weight).toBe(400);
    }
    // 600 is as near the 400 as the 800: heavier first above 500, in the canvas and in the PDF.
    expect(width(600)).toBe(heavy);
    expect(fonts.pick(family, 600, 'normal')!.weight).toBe(800);
    expect(width(350)).toBe(light);
  });

  it('writes the hundred that brings Skia to that face, and leaves a whole hundred as it is', async () => {
    await resolveFonts(book, { fontDirs: [], offline: true }, silent);
    expect(skiaFontShorthand(`550 40px "${family}"`)).toBe(`600 40px "${family}"`);
    expect(skiaFontShorthand(`italic 450 12.5px "${family}"`)).toBe(`italic 400 12.5px "${family}"`);
    expect(skiaFontShorthand(`600 40px "${family}"`)).toBe(`600 40px "${family}"`);
    expect(skiaFontShorthand(`40px "${family}"`)).toBe(`40px "${family}"`);
    // A family Skia has no face of: the hundred next to the weight, so the size stays the size.
    expect(skiaFontShorthand('550 40px Nowhere Sans')).toBe('500 40px Nowhere Sans');
  });
});

describe('wantedVariants (#741)', () => {
  const chapters = [{ title: 'One', markdown: '# One\n\nSome **bold** text.' }];
  it('wants the bold weight the book names, upright and italic, beside the standard four', () => {
    const wanted = wantedVariants({ config: { bodyText: { fontFamily: 'Red Hat Text', boldFontWeight: 600 } }, chapters });
    const body = wanted.get('Red Hat Text')!;
    expect(body).toContainEqual({ weight: 600, style: 'normal' });
    expect(body).toContainEqual({ weight: 600, style: 'italic' });
    for (const weight of [400, 700]) for (const style of ['normal', 'italic'] as const) expect(body).toContainEqual({ weight, style });
    // The family ships it, so the nearest file is the file itself.
    const meta: FamilyMeta = { available: true, weights: [300, 400, 500, 600, 700], styles: ['normal', 'italic'], checkedAt: 0 };
    expect(matchedVariants(body, meta)).toContainEqual({ weight: 600, style: 'normal' });
  });
  it('wants nothing more when the bold is 700', () => {
    const wanted = wantedVariants({ config: { bodyText: { fontFamily: 'Red Hat Text' } }, chapters });
    expect(wanted.get('Red Hat Text')!.map((v) => v.weight).every((w) => w === 400 || w === 700)).toBe(true);
  });
});

describe('fontsourceFiles (#689)', () => {
  it('lists the TrueType file of each weight and style of a family Google Fonts does not have', () => {
    const file = (w: number, s: string) => ({ latin: { url: { ttf: `https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-${w}-${s}.ttf` } } });
    expect(fontsourceFiles({ type: 'other', defSubset: 'latin', variants: { 400: { normal: file(400, 'normal'), italic: file(400, 'italic') }, 700: { normal: file(700, 'normal') } } })).toEqual({
      '400-normal': 'https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-400-normal.ttf',
      '400-italic': 'https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-400-italic.ttf',
      '700-normal': 'https://cdn.jsdelivr.net/fontsource/fonts/commit-mono@latest/latin-700-normal.ttf',
    });
    expect(fontsourceFiles({})).toEqual({});
  });
});

describe('restyleFace (#688)', () => {
  it('gives a copy the weight and the slant asked, and leaves the file as it was', async () => {
    const bytes = regular();
    const before = bytes.slice();
    const copy = restyleFace(bytes, 700, 'italic')!;
    expect(await readFontMeta(copy)).toMatchObject({ weight: 700, style: 'italic' });
    expect(await readFontMeta(restyleFace(bytes, 800, 'normal')!)).toMatchObject({ weight: 800, style: 'normal' });
    expect(bytes).toEqual(before);
    expect(copy.byteLength).toBe(bytes.byteLength);
  });

  it('answers nothing for bytes that are not a font', () => {
    expect(restyleFace(new Uint8Array(4), 700, 'normal')).toBeUndefined();
    expect(restyleFace(new Uint8Array(64), 700, 'normal')).toBeUndefined();
  });

  it('makes the canvas paint a bold and an italic the family lacks with its own letters', () => {
    const bytes = regular();
    const ink = (font: string): number => {
      const canvas = createCanvas(700, 140);
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, 700, 140);
      c.fillStyle = '#000';
      c.font = font;
      c.fillText('Hamburg', 10, 100);
      const data = c.getImageData(0, 0, 700, 140).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 255 - data[i]!;
      return sum;
    };
    // A family with a regular alone: its bold is drawn heavier, its italic slanted.
    GlobalFonts.register(Buffer.from(bytes), 'One Weight Probe');
    const own = ink('400 80px "One Weight Probe"');
    expect(ink('700 80px "One Weight Probe"')).toBeGreaterThan(own * 1.05);
    expect(ink('italic 400 80px "One Weight Probe"')).not.toBe(own);
    for (const [weight, style] of [[700, 'normal'], [400, 'italic'], [700, 'italic']] as const) {
      GlobalFonts.register(Buffer.from(restyleFace(bytes, weight, style)!), 'One Weight Probe');
    }
    expect(ink('700 80px "One Weight Probe"')).toBe(own);
    expect(ink('italic 400 80px "One Weight Probe"')).toBe(own);
    expect(ink('italic 700 80px "One Weight Probe"')).toBe(own);
  });
});
