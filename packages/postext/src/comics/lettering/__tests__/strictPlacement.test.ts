// #728: with `strictPlacement`, a balloon reshaped to fit its panel pays
// for every Chinese word its new lines part that its preferred shape
// leaves whole, more than a balloon read out of order does: the search no
// longer cuts 其|实 to keep the order. Japanese lettering, broken by
// phrases, is not touched, and without the setting a panel is lettered as
// postext 1.27 lettered it.

import { describe, it, expect, beforeAll } from 'vitest';
import { installStubMeasure } from './stubMeasure.js';
import { presetLetteringStyles } from '../presets.js';
import { prepareText, readLetteringText, breakPoints } from '../text.js';
import { shapeText } from '../shape-text.js';
import { buildDocument } from '../../../pipeline/index.js';
import type { PostextConfig, Resource } from '../../../types.js';
import { ZH } from './strictPlacement.fixtures.js';

// The panel tests are in strictPlacement.{zh,off,ja}.test.ts (#1118).

beforeAll(() => installStubMeasure());

describe('the words a text may be cut in', () => {
  const cuts = (text: string, locale: string): number[] => {
    const style = presetLetteringStyles({ fontSizePx: 12, locale, fontFamily: 'Test' }).speech!;
    const p = prepareText(readLetteringText(text, undefined), style, { locale, vertical: false });
    return breakPoints(p, 'gb', locale === 'ja').filter((b) => b.inWord).map((b) => b.end);
  };

  it('marks the breaks inside a Chinese word', () => {
    // 其|实, 有|点, 害|怕: inside a word of the segmenter.
    const text = '……其实，我有点害怕';
    const marked = cuts(text, 'zh-Hans').map((k) => `${text[k - 1]}|${text[k]}`);
    expect(marked).toEqual(['其|实', '有|点', '害|怕']);
  });

  it('marks none in Japanese text, in a Japanese book or in any other', () => {
    expect(cuts('……ほんとはね、ちょっと怖いんだ', 'ja')).toEqual([]);
    expect(cuts('……ほんとはね、ちょっと怖いんだ', 'en')).toEqual([]);
    expect(cuts('Nothing to cut here', 'en')).toEqual([]);
  });

  it('a shaped text counts the words it parts', () => {
    const style = presetLetteringStyles({ fontSizePx: 12, locale: 'zh-Hans', fontFamily: 'Test' }).speech!;
    const p = prepareText(readLetteringText('……其实，我有点害怕', undefined), style, { locale: 'zh-Hans', vertical: false });
    const preferred = shapeText(p, style, { locale: 'zh-Hans', vertical: false, dpi: 96 });
    expect(preferred.block.lines.map((l) => l.text)).toEqual(['……其实，', '我有点害怕']);
    expect(preferred.wordCuts).toBe(0);
    // The spare shape the placement tries first, 0.7 of that length: it
    // parts 其实.
    const narrow = shapeText(p, style, { locale: 'zh-Hans', vertical: false, dpi: 96, maxLength: 3.5 * 12 });
    expect(narrow.block.lines.map((l) => l.text)).toEqual(['……其', '实，我', '有点', '害怕']);
    expect(narrow.wordCuts).toBe(1);
  });
});

describe('comics.lettering.strictPlacement in the build (#728)', () => {
  // One panel that fills a page of 340 × 154 px: two figures, three lines.
  const picture: Resource = {
    id: 'roof', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0, bitmap: { fileId: 'roof', format: 'png', width: 3000, height: 1300 },
    anchors: [
      { id: 'hana', x: 0.36, y: 0.62, face: { x: 0.28, y: 0.42, width: 0.16, height: 0.4 } },
      { id: 'sora', x: 0.64, y: 0.62, face: { x: 0.56, y: 0.42, width: 0.16, height: 0.4 } },
    ],
  };
  const markdown = `:::page\n::panel{art=roof}\nhana: ${ZH[0]}\nsora: ${ZH[1]}\nhana: ${ZH[2]}\n:::\n`;
  const px = (value: number) => ({ value, unit: 'px' as const });
  const build = (lettering: NonNullable<PostextConfig['comics']>['lettering']) => {
    const doc = buildDocument({ markdown, resources: [picture] }, {
      page: { sizePreset: 'custom', width: px(340), height: px(154), dpi: 96, margins: { top: px(0), bottom: px(0), left: px(0), right: px(0) } },
      locale: 'zh-Hans',
      comics: { lettering: { fontSize: { value: 12, unit: 'pt' }, inset: px(5), ...lettering } },
    });
    return {
      lines: doc.pages.find((p) => p.comic)!.comic!.balloons.map((b) => b.text[0]!.lines.map((l) => l.text).join('/')),
      warnings: (doc.contentWarnings ?? []).filter((w) => w.kind === 'comicBalloonOverflow').length,
    };
  };

  it('is on by default: the reply keeps 明明 whole', () => {
    const byDefault = build({});
    expect(byDefault.warnings).toBe(0);
    expect(byDefault.lines[1]).toBe('我也是。/明明我又/不上场');
    expect(build({ strictPlacement: true })).toEqual(byDefault);
  });

  it('false letters the page as postext 1.27 did, the word cut', () => {
    const off = build({ strictPlacement: false });
    expect(off.warnings).toBe(0);
    expect(off.lines[1]).toBe('我也/是。明/明我又/不上场');
    // The other two balloons are the same either way.
    const on = build({});
    expect([off.lines[0], off.lines[2]]).toEqual([on.lines[0], on.lines[2]]);
  });
});
