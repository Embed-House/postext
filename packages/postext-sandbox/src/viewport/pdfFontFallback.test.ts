import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PdfFontAnswer } from 'postext-pdf';

// #978: the PDF sets the faces a family has no file of in the fallback the
// bundle names for it, as the previews do.

const CUT = [{ family: 'Source Serif 4', weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', url: 'https://fonts.test/serif-latin.woff2' }];
const FAMILIES: Record<string, { name: string; variants: { weight: number; style: 'normal' | 'italic'; fileId: string; format: 'ttf' }[]; fallback?: string }> = {
  'Licensed Serif': { name: 'Licensed Serif', variants: [], fallback: 'Source Serif 4' },
  'Half Licensed': { name: 'Half Licensed', variants: [{ weight: 400, style: 'normal', fileId: 'own', format: 'ttf' }], fallback: 'Source Serif 4' },
};

vi.mock('../controls/fontLoader', () => ({
  getCustomFontFamily: (name: string) => FAMILIES[name],
  fontFamilyWeights: async () => [400],
  isUncataloguedFontFamily: () => false,
  staticFaceFiles: async (family: string) => (family === 'Source Serif 4' ? CUT : null),
  fontsourcePackageVersion: () => null,
  facesForCodePoints: (faces: typeof CUT) => faces,
}));
vi.mock('../storage/fontStorage', () => ({ getFontFile: async (id: string) => (id === 'own' ? { buffer: new TextEncoder().encode('own-file').buffer } : null) }));
vi.mock('postext-pdf', () => ({ decompressWoff2: async (bytes: Uint8Array) => bytes }));

const filesOf = (answer: PdfFontAnswer): Uint8Array[] => (Array.isArray(answer) ? answer : [answer]);
const name = (file: Uint8Array): string => new TextDecoder().decode(file);

describe('createPdfFontProvider: a family with a fallback (#978)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string) => new Response(new TextEncoder().encode(url.slice(url.lastIndexOf('/') + 1))));
  });

  it('embeds the fallback\'s files for a family that has none', async () => {
    const { createPdfFontProvider } = await import('./pdfFontProvider');
    const provider = createPdfFontProvider();
    expect(filesOf(await provider('Licensed Serif', 400, 'normal')).map(name)).toEqual(['serif-latin.woff2']);
    expect(filesOf(await provider('Licensed Serif', 700, 'italic')).map(name)).toEqual(['serif-latin.woff2']);
  });

  it('keeps the family\'s own file for the slant it has, the fallback\'s for the one it lacks', async () => {
    const { createPdfFontProvider } = await import('./pdfFontProvider');
    const provider = createPdfFontProvider();
    expect(filesOf(await provider('Half Licensed', 700, 'normal')).map(name)).toEqual(['own-file']);
    expect(filesOf(await provider('Half Licensed', 400, 'italic')).map(name)).toEqual(['serif-latin.woff2']);
  });
});
