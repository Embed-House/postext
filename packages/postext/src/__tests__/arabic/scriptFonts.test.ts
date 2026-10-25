import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/index.js';
import { resolveBodyTextConfig } from '../../defaults/bodyText.js';
import { stripConfigDefaults } from '../../defaults/index.js';
import { configFontFamilies } from '../../fonts/usage.js';
import { documentFontTexts } from '../../fonts/glyphFallback.js';
import { scriptFontSpans, setMeasureScriptFonts } from '../../measure/scriptFonts.js';
import type { PostextConfig } from '../../types.js';
import type { VDTBlock, VDTDocument, VDTLineSegment } from '../../vdt.js';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * (this.font.includes('Amiri') ? 5 : 7) };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const ARABIC_RE = /\p{Script=Arabic}/u;

function config(bodyText: PostextConfig['bodyText'] = {}, extra: Partial<PostextConfig> = {}): PostextConfig {
  return {
    locale: 'tr',
    page: { width: pt(300), height: pt(400), margins: { top: pt(30), bottom: pt(30), left: pt(30), right: pt(30) } },
    layout: { layoutType: 'single' },
    ...extra,
    bodyText: { fontFamily: 'Libertinus Serif', ...bodyText },
  };
}

const MD = [
  'Hadiste :rtl[إنما الأعمال بالنيات]{lang=ar} buyrulur.[^n1]',
  '',
  'Gövdede çıplak Arapça kelime علم da geçer.',
  '',
  ':::paragraphs{dir=rtl lang=ar style="ayet"}',
  'اقرأ باسم ربك الذي خلق',
  ':::',
  '',
  '[^n1]: Buhârî, :rtl[صحيح البخاري]{lang=ar}, I, 2.',
].join('\n');

const segmentsOf = (blocks: readonly VDTBlock[]): VDTLineSegment[] => blocks.flatMap((b) => b.lines.flatMap((l) => l.segments ?? []));
const textSegments = (doc: VDTDocument, pick: (b: VDTBlock) => boolean) => segmentsOf(doc.blocks.filter(pick)).filter((s) => s.kind === 'text' && s.text.trim() !== '');
const body = (b: VDTBlock) => b.type === 'paragraph' && b.footnoteNote === undefined && b.paragraphStyleId !== 'ayet';

describe('bodyText.scriptFonts: resolution', () => {
  it('is absent unless set and kept when saving', () => {
    expect('scriptFonts' in resolveBodyTextConfig({}, 'tr')).toBe(false);
    expect('scriptFonts' in resolveBodyTextConfig({ scriptFonts: {} }, 'tr')).toBe(false);
    expect(resolveBodyTextConfig({ scriptFonts: { arab: 'Amiri' } }, 'tr').scriptFonts).toEqual({ arab: 'Amiri' });
    expect(stripConfigDefaults({ locale: 'tr', bodyText: { scriptFonts: { arab: 'Amiri' } } }).bodyText).toEqual({ scriptFonts: { arab: 'Amiri' } });
  });

  it('loads the family it names', () => {
    expect(configFontFamilies(config({ scriptFonts: { arab: 'Amiri' } }))).toContain('Amiri');
  });
});

describe('scriptFontSpans', () => {
  it('cuts a span where the script changes and leaves Latin text alone', () => {
    setMeasureScriptFonts({ arab: 'Amiri' });
    try {
      const spans = scriptFontSpans([{ text: 'ilim علم ve', bold: false, italic: false }], '400 16px "Libertinus Serif"');
      expect(spans.map((s) => [s.text, s.scriptFace])).toEqual([['ilim ', undefined], ['علم ', 'Amiri'], ['ve', undefined]]);
      const latin = [{ text: 'fikir', bold: false, italic: false }];
      expect(scriptFontSpans(latin, '400 16px "Libertinus Serif"')).toBe(latin);
      const arabicFace = [{ text: 'علم', bold: false, italic: false }];
      expect(scriptFontSpans(arabicFace, '400 16px Amiri')[0]!.scriptFace).toBeUndefined();
    } finally {
      setMeasureScriptFonts(undefined);
    }
  });
});

describe('a Turkish book quoting Arabic', () => {
  const withFonts = buildDocument({ markdown: MD }, config({ scriptFonts: { arab: 'Amiri' } }, { paragraphStyles: [{ id: 'ayet', fontFamily: 'Amiri' }] }));
  const without = buildDocument({ markdown: MD }, config({}, { paragraphStyles: [{ id: 'ayet', fontFamily: 'Amiri' }] }));

  it('measures and paints the Arabic of an inline run, a bare word and a note in the script face', () => {
    const arabic = textSegments(withFonts, (b) => b.type === 'paragraph' && b.paragraphStyleId !== 'ayet').filter((s) => ARABIC_RE.test(s.text));
    expect(arabic.length).toBeGreaterThan(3);
    for (const seg of arabic) expect(seg.fontString).toContain('Amiri');
    const latin = textSegments(withFonts, body).filter((s) => !ARABIC_RE.test(s.text));
    for (const seg of latin) expect(seg.fontString ?? '').not.toContain('Amiri');
    const note = textSegments(withFonts, (b) => b.footnoteNote !== undefined).filter((s) => ARABIC_RE.test(s.text));
    expect(note.length).toBeGreaterThan(0);
    for (const seg of note) expect(seg.fontString).toContain('Amiri');
  });

  it('leaves a block whose style already sets the face as it was', () => {
    const block = (doc: VDTDocument) => textSegments(doc, (b) => b.paragraphStyleId === 'ayet');
    expect(block(withFonts).length).toBeGreaterThan(0);
    expect(block(withFonts).map((s) => s.fontString)).toEqual(block(without).map((s) => s.fontString));
  });

  it('sets the Arabic in the body face without it, as before', () => {
    const arabic = textSegments(without, body).filter((s) => ARABIC_RE.test(s.text));
    for (const seg of arabic) expect(seg.fontString ?? '').not.toContain('Amiri');
  });

  it('gives the body face no Arabic character to fall back for', () => {
    const libertinusArabic = (doc: VDTDocument) => [...documentFontTexts(doc)]
      .filter(([font]) => font.includes('Libertinus'))
      .flatMap(([, chars]) => [...chars].filter((c) => ARABIC_RE.test(c)));
    expect(libertinusArabic(withFonts)).toEqual([]);
    expect(libertinusArabic(without).length).toBeGreaterThan(0);
  });
});
