import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { loadHarfBuzz } from '../harfbuzz';
import { loadComplexShaper, shapeRun } from '../complexShaping';
import { openTypeLanguagesOf } from '../otLanguages';
import { OT_LANGUAGES_HARFBUZZ, OT_LANGUAGE_DATA } from '../otLanguageData';

// #764: the OpenType language systems of a language are HarfBuzz's, read
// out of the build this package ships (`scripts/make-ot-languages.mjs`).

const fixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const ALEGREYA = fixture('latin/alegreya-language.ttf');
const SONG = fixture('cjk/noto-serif-sc-language.ttf');
const MING = fixture('cjk/noto-serif-tc-language.ttf');
const MINCHO = fixture('cjk/noto-serif-jp-vertical.ttf');

beforeAll(async () => {
  await loadComplexShaper();
});

describe('the table of OpenType language tags (#764)', () => {
  it('was read from the HarfBuzz this package shapes with', async () => {
    // A harfbuzzjs update brings another HarfBuzz, and may bring another
    // table: `node scripts/make-ot-languages.mjs` writes it again.
    expect((await loadHarfBuzz()).version()).toBe(OT_LANGUAGES_HARFBUZZ);
  });

  it('is small', () => {
    expect(OT_LANGUAGE_DATA.length).toBeLessThan(12_000);
  });

  it('gives a language its tags, in HarfBuzz\u2019s order', () => {
    const cases: [string, string[]][] = [
      ['ca', ['CAT']], ['tr', ['TRK']], ['ro', ['ROM']], ['ro-MD', ['MOL', 'ROM']], ['nl', ['NLD']], ['pl', ['PLK']],
      ['sr', ['SRB']], ['mk', ['MKD']], ['en', ['ENG']], ['en-US', ['ENG']], ['es-ES', ['ESP']], ['ja', ['JAN']], ['ja-JP', ['JAN']],
      ['ko', ['KOR', 'KOH']], ['ar', ['ARA']], ['fa', ['FAR']], ['ur', ['URD']], ['he', ['IWR']], ['ga', ['IRI', 'IRT']],
      // Chinese goes by its script and its region.
      ['zh', ['ZHS']], ['zh-Hans', ['ZHS']], ['zh-CN', ['ZHS']], ['zh-SG', ['ZHS']], ['zh-Hans-HK', ['ZHS']],
      ['zh-Hant', ['ZHT']], ['zh-TW', ['ZHT']], ['zh-Hant-TW', ['ZHT']], ['zh-HK', ['ZHH']], ['zh-Hant-HK', ['ZHH']],
      ['zh-MO', ['ZHTM', 'ZHH']], ['zh-Hant-MO', ['ZHTM', 'ZHH']], ['yue', ['ZHH']], ['yue-Hans', ['ZHS']],
      // A variant or a script that decides in any language.
      ['el', ['ELL']], ['el-polyton', ['PGR']], ['en-fonipa', ['IPPH']], ['ga-Latg', ['IRT']], ['syr-Syre', ['SYRE']],
    ];
    for (const [tag, tags] of cases) expect(openTypeLanguagesOf(tag), tag).toEqual(tags);
  });

  it('reads a tag in any spelling, and knows no tags for what is no language', () => {
    expect(openTypeLanguagesOf('ZH_hant_hk')).toEqual(['ZHH']);
    expect(openTypeLanguagesOf('zh-hant-TW-u-nu-hanidec')).toEqual(['ZHT']);
    // A deprecated code is read as the one that replaced it.
    expect(openTypeLanguagesOf('iw')).toEqual(['IWR']);
    for (const tag of [undefined, '', 'xx', 'not a tag!', 'i-']) expect(openTypeLanguagesOf(tag), String(tag)).toEqual([]);
  });

  it('gives a language of three letters out of the table its own letters, as HarfBuzz does', () => {
    expect(openTypeLanguagesOf('qqq')).toEqual(['QQQ']);
    // Unless they are the tag of another language: `TRK` is Turkish, and
    // `trk` the Turkic languages.
    expect(openTypeLanguagesOf('trk')).toEqual([]);
    expect(openTypeLanguagesOf('jan')).toEqual([]);
  });
});

/** The language systems of a font's `GSUB`, under any script. */
function languageSystems(bytes: Uint8Array): Set<string> {
  const face = fontkit.create(Buffer.from(bytes)) as unknown as { GSUB?: { scriptList?: { script: { langSysRecords?: { tag: string }[] } }[] } };
  return new Set((face.GSUB?.scriptList ?? []).flatMap((entry) => (entry.script.langSysRecords ?? []).map((record) => record.tag.trim())));
}

describe('a font shaped by HarfBuzz in a language and by fontkit in its tag (#764)', () => {
  // HarfBuzz is told the BCP 47 tag; fontkit the first of the tags the
  // table gives for it that the font has. Glyph for glyph the same.
  const samples: [string, Uint8Array, string, string[]][] = [
    ['Alegreya', ALEGREYA, 'l\u00B7l', ['ca', 'ca-ES', 'es', 'en', 'fr']],
    ['Alegreya', ALEGREYA, 'fil', ['tr', 'tr-TR', 'az', 'crh', 'kk', 'tt', 'en', 'de']],
    ['Alegreya', ALEGREYA, '\u015F\u0163', ['ro', 'ro-RO', 'ro-MD', 'en', 'tr']],
    ['Alegreya', ALEGREYA, '\u00EDj', ['nl', 'nl-BE', 'en']],
    ['Alegreya', ALEGREYA, '\u0430\u0431', ['sr', 'sr-Cyrl-RS', 'mk', 'ru', 'bg']],
    ['Noto Serif SC', SONG, 'n\u2014"1', ['zh', 'zh-Hans', 'zh-CN', 'zh-SG', 'zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'yue', 'ja', 'ko', 'en']],
    ['Noto Serif TC', MING, 'n\u2014"1', ['zh', 'zh-Hans', 'zh-CN', 'zh-Hant', 'zh-TW', 'zh-Hant-TW', 'zh-HK', 'zh-MO', 'yue', 'ja', 'en']],
    ['Noto Serif JP', MINCHO, 'n\u2014"1', ['ja', 'ja-JP', 'zh', 'zh-Hant', 'ko', 'en']],
  ];

  it('gives the same glyphs and advances', () => {
    const differing = new Set<string>();
    for (const [name, bytes, text, tags] of samples) {
      const face = fontkit.create(Buffer.from(bytes));
      const layout = face.layout as unknown as (text: string, features?: unknown, script?: string, language?: string) => ReturnType<typeof face.layout>;
      const systems = languageSystems(bytes);
      const plain = face.layout(text).glyphs.map((g) => g.id).join(',');
      for (const tag of tags) {
        const system = openTypeLanguagesOf(tag).find((t) => systems.has(t));
        const run = layout.call(face, text, undefined, undefined, system);
        const shaped = shapeRun(bytes, text, { direction: 'ltr', language: tag })!;
        const label = `${name} ${JSON.stringify(text)} ${tag}`;
        expect(run.glyphs.map((g) => g.id), label).toEqual(shaped.glyphs.map((g) => g.gid));
        expect(run.positions.map((p) => p.xAdvance), label).toEqual(shaped.glyphs.map((g) => g.xAdvance));
        if (run.glyphs.map((g) => g.id).join(',') !== plain) differing.add(`${name} ${tag}`);
      }
    }
    // The sample does set other glyphs in the languages each face has
    // forms for, and in no other.
    expect([...differing].sort()).toEqual([
      'Alegreya az', 'Alegreya ca', 'Alegreya ca-ES', 'Alegreya crh', 'Alegreya kk', 'Alegreya nl', 'Alegreya nl-BE',
      'Alegreya ro', 'Alegreya ro-MD', 'Alegreya ro-RO', 'Alegreya sr', 'Alegreya sr-Cyrl-RS', 'Alegreya tr', 'Alegreya tr-TR', 'Alegreya tt',
      'Noto Serif JP ja', 'Noto Serif JP ja-JP',
      'Noto Serif SC zh', 'Noto Serif SC zh-CN', 'Noto Serif SC zh-Hans', 'Noto Serif SC zh-SG',
      'Noto Serif TC zh-Hant', 'Noto Serif TC zh-Hant-TW', 'Noto Serif TC zh-TW',
    ]);
  });
});
