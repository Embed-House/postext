import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { shapedBySkia } from '../layout';

// #764: a browser shapes a document in its own language (`ctx.lang`).
// Skia's canvas has the attribute and shapes without it, so the command
// line measures the forms of each font's default language, and lays its
// books out with `bodyText.shapingLanguage: 'host'` so that its outputs
// paint those forms too.

const SONG = fileURLToPath(new URL('../../../postext-pdf/src/__tests__/fixtures/cjk/noto-serif-sc-vertical.ttf', import.meta.url));

describe('the language of the text on the command line (#764)', () => {
  it('a book is laid out with the host\'s language, whatever it asks for', () => {
    expect(shapedBySkia({ locale: 'ca' })).toEqual({ locale: 'ca', bodyText: { shapingLanguage: 'host' } });
    expect(shapedBySkia({ bodyText: { fontFamily: 'Serif', shapingLanguage: 'document' } })).toEqual({ bodyText: { fontFamily: 'Serif', shapingLanguage: 'host' } });
    // The book's own configuration is left as it was read.
    const config = { bodyText: { fontFamily: 'Serif' } };
    shapedBySkia(config);
    expect(config).toEqual({ bodyText: { fontFamily: 'Serif' } });
  });

  it('Skia takes a language and measures the same under every one', () => {
    expect(GlobalFonts.registerFromPath(SONG, 'Song Shaping Test')).toBeTruthy();
    const ctx = createCanvas(10, 10).getContext('2d');
    expect('lang' in ctx).toBe(true);
    ctx.font = '100px "Song Shaping Test"';
    const widths = (lang: string): number[] => {
      ctx.lang = lang;
      return ['1', '2026', '……'].map((text) => Math.round(ctx.measureText(text).width * 10) / 10);
    };
    // The forms a browser gives this face in Chinese: a digit 0.471 em
    // wide. In any other language a browser sets it 0.55 em wide; when
    // this fails Skia has started to shape by language, and the command
    // line can lay out in the document's.
    const chinese = widths('zh-Hans');
    expect(chinese).toEqual([47.1, 223.1, 200]);
    for (const lang of ['inherit', 'en', 'ja', 'ca', '']) expect(widths(lang)).toEqual(chinese);
  });
});
