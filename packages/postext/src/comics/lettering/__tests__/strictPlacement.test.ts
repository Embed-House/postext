// #728: with `strictPlacement`, a balloon reshaped to fit its panel pays
// for every Chinese word its new lines part that its preferred shape
// leaves whole, more than a balloon read out of order does: the search no
// longer cuts 其|实 to keep the order. Japanese lettering, broken by
// phrases, is not touched, and without the setting a panel is lettered as
// postext 1.27 lettered it.

import { describe, it, expect, beforeAll } from 'vitest';
import { installStubMeasure } from './stubMeasure';
import { letterPanelDetailed } from '../letter';
import { presetLetteringStyles } from '../presets';
import { prepareText, readLetteringText, breakPoints } from '../text';
import { shapeText } from '../shape-text';
import { buildDocument } from '../../../pipeline';
import type { LetteringEnv, LetteringItem, LetteringPanel, Point, Rect } from '../types';
import type { PostextConfig, Resource } from '../../../types';

beforeAll(() => installStubMeasure());

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const corners = (r: Rect): Point[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];

/** Two figures side by side in a panel `w` × `h`, and three balloons. */
function roof(w: number, h: number, em: number, locale: string, texts: [string, string, string], env: LetteringEnv) {
  const st = presetLetteringStyles({ fontSizePx: em, locale, fontFamily: 'Test' });
  const cell = rect(0, 0, w, h);
  const anchors = [
    { id: 'hana', mouth: { x: w * 0.36, y: h * 0.62 }, face: rect(w * 0.28, h * 0.42, w * 0.16, h * 0.4), visible: true },
    { id: 'sora', mouth: { x: w * 0.64, y: h * 0.62 }, face: rect(w * 0.56, h * 0.42, w * 0.16, h * 0.4), visible: true },
  ];
  const panel: LetteringPanel = { index: 0, polygon: corners(cell), bbox: cell, insetPx: 5, direction: 'ltr', writingMode: 'horizontal', locale, anchors, dpi: 96 };
  const item = (id: string, order: number, speaker: string, text: string): LetteringItem =>
    ({ id, order, kind: 'balloon', speaker, text, sourceStart: order * 100, sourceEnd: order * 100 + 10, style: st.speech! });
  const r = letterPanelDetailed(panel, [item('a', 0, 'hana', texts[0]), item('b', 1, 'sora', texts[1]), item('c', 2, 'hana', texts[2])], env);
  return { lines: r.balloons.map((b) => b.text[0]!.lines.map((l) => l.text).join('/')), boxes: r.balloons.map((b) => b.bbox), diagnostics: r.diagnostics };
}

const ZH: [string, string, string] = ['……其实，我有点害怕', '我也是。明明我又不上场', '噗，你在说什么呀'];
const JA: [string, string, string] = ['……ほんとはね、ちょっと怖いんだ', '僕も。試合に出ないのに', 'ふふっ、なにそれ'];

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

describe('strictPlacement (#728)', () => {
  // Panels whose lettering is clean either way (no diagnostic): what
  // changes is the shape the first balloon is given.
  for (const [w, h, em] of [[300, 130, 12], [340, 150, 14], [380, 170, 16]] as const) {
    it(`a ${w} × ${h} panel: 其实 is cut without it, whole with it`, () => {
      const lax = roof(w, h, em, 'zh-Hans', ZH, {});
      const strict = roof(w, h, em, 'zh-Hans', ZH, { strictPlacement: true });
      expect(lax.diagnostics).toEqual([]);
      expect(strict.diagnostics).toEqual([]);
      expect(lax.lines[0]).toContain('其/实');
      expect(strict.lines[0]).not.toContain('其/实');
      expect(strict.lines[0]).toContain('其实，');
      // The other two balloons keep their lines.
      expect(strict.lines.slice(1)).toEqual(lax.lines.slice(1));
    });
  }

  it('false, or unset, letters a panel as before', () => {
    const unset = roof(300, 130, 12, 'zh-Hans', ZH, {});
    const off = roof(300, 130, 12, 'zh-Hans', ZH, { strictPlacement: false });
    expect(off).toEqual(unset);
  });

  it('does not touch Japanese lettering', () => {
    for (const [w, h, em] of [[300, 130, 12], [340, 150, 14], [380, 170, 16]] as const) {
      expect(roof(w, h, em, 'ja', JA, { strictPlacement: true })).toEqual(roof(w, h, em, 'ja', JA, {}));
    }
  });

  it('does not touch Latin lettering', () => {
    const en: [string, string, string] = ['Honestly, I am a little scared.', 'Me too. And I am not even playing.', 'Pff, what are you on about?'];
    expect(roof(300, 130, 12, 'en', en, { strictPlacement: true })).toEqual(roof(300, 130, 12, 'en', en, {}));
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
