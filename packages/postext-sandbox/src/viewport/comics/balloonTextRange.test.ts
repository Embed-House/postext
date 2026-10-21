import { describe, expect, it } from 'vitest';
import type { VDTComicBalloon, VDTDesignTextBlock } from 'postext';
import { balloonTextAt, balloonTextRangeRects, type BalloonTextRect, type TextMeasure } from './balloonText.js';
import { fromBalloonFrame } from './balloonDrag.js';

// Nothing measures in the node tests: a run's characters share its advance
// evenly (the Sandbox measures them with the font in the browser).
const even: TextMeasure = () => null;
const opts = { measure: even };

const balloonOf = (text: VDTDesignTextBlock[], extra: Partial<VDTComicBalloon> = {}): VDTComicBalloon => ({
  id: '0:0',
  panelIndex: 0,
  order: 0,
  kind: 'balloon',
  style: 'speech',
  sourceStart: 5,
  sourceEnd: 21,
  group: 0,
  text,
  bbox: { x: 90, y: 90, width: 80, height: 45 },
  ...extra,
});

// `ana: Hello world` set in capitals on two lines, ten px a character:
// HELLO from x 105 to 155 (baseline 110), WORLD under it (baseline 122).
const horizontal: VDTDesignTextBlock = {
  kind: 'text',
  bbox: { x: 100, y: 100, width: 60, height: 26 },
  fontString: '10px Test',
  color: '#000',
  clip: false,
  lines: [
    { text: 'HELLO', xOffset: 5, baselineY: 110, width: 50 },
    { text: 'WORLD', xOffset: 5, baselineY: 122, width: 50 },
  ],
  sourceStart: 5,
  sourceEnd: 21,
  sourceText: 'HELLO\nWORLD',
  sourceMap: [10, 11, 12, 13, 14, 16, 16, 17, 18, 19, 20],
};

// Two columns of Japanese, read from the right.
const vertical: VDTDesignTextBlock = {
  kind: 'text',
  bbox: { x: 200, y: 50, width: 24, height: 30 },
  fontString: '10px Test',
  color: '#000',
  clip: false,
  vertical: { region: 'japan', uprightDigits: 2, centralBaselines: { Test: 0.38 } },
  lines: [
    { text: 'あいう', xOffset: 0, baselineY: 8.8, width: 30 },
    { text: 'えお', xOffset: 0, baselineY: 20.8, width: 20 },
  ],
  sourceStart: 30,
  sourceEnd: 36,
  sourceText: 'あいう\nえお',
  sourceMap: [30, 31, 32, 33, 33, 34],
};

/** The source offset the press tools find at a rect's centre. */
const offsetAtCentre = (b: VDTComicBalloon, r: BalloonTextRect): number | null => {
  const p = fromBalloonFrame(b, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
  return balloonTextAt(b, p.x, p.y, opts);
};

describe('the rects of a selection in a balloon\'s words (#796)', () => {
  it('covers the characters of the range on each line it reaches', () => {
    const b = balloonOf([horizontal]);
    // "LLO WO": from the third letter of HELLO to the second of WORLD.
    const rects = balloonTextRangeRects(b, 12, 18, opts);
    expect(rects).toHaveLength(2);
    const [first, second] = rects;
    expect(first!.x).toBeCloseTo(125);
    expect(first!.width).toBeCloseTo(30);
    expect(second!.x).toBeCloseTo(105);
    expect(second!.width).toBeCloseTo(20);
    // Each spans its line's band, the second below the first.
    expect(first!.y + first!.height).toBeLessThanOrEqual(second!.y + 0.001);
    expect(first!.y).toBeLessThan(110);
    expect(first!.y + first!.height).toBeGreaterThan(110);
  });

  it('is empty when the range misses the words or is collapsed', () => {
    const b = balloonOf([horizontal]);
    expect(balloonTextRangeRects(b, 0, 9, opts)).toEqual([]);
    expect(balloonTextRangeRects(b, 12, 12, opts)).toEqual([]);
    expect(balloonTextRangeRects(b, 30, 40, opts)).toEqual([]);
  });

  it('skips a block whose words do not map back to the script', () => {
    const { sourceMap: _dropped, ...unmapped } = horizontal;
    void _dropped;
    expect(balloonTextRangeRects(balloonOf([unmapped]), 10, 20, opts)).toEqual([]);
  });

  it('runs down a vertical column, the columns from the right', () => {
    const b = balloonOf([vertical], { sourceStart: 28, sourceEnd: 36 });
    // い to え: the last two characters of the first column, the first of
    // the second.
    const rects = balloonTextRangeRects(b, 31, 34, opts);
    expect(rects).toHaveLength(2);
    const [first, second] = rects;
    expect(first!.height).toBeCloseTo(20);
    expect(first!.y).toBeCloseTo(60);
    expect(second!.y).toBeCloseTo(50);
    expect(second!.height).toBeCloseTo(10);
    // The second column lies left of the first.
    expect(second!.x + second!.width).toBeLessThanOrEqual(first!.x + 0.001);
    for (const r of rects) {
      const at = offsetAtCentre(b, r);
      expect(at).not.toBeNull();
      expect(at!).toBeGreaterThanOrEqual(31);
      expect(at!).toBeLessThanOrEqual(34);
    }
  });

  it('lies on the words of a turned and leaned sound effect once put on the sheet', () => {
    const sfx = balloonOf([horizontal], { kind: 'sfx', rotate: -30, skew: 12, bbox: { x: 100, y: 100, width: 60, height: 26 } });
    const rects = balloonTextRangeRects(sfx, 11, 14, opts);
    expect(rects).toHaveLength(1);
    const at = offsetAtCentre(sfx, rects[0]!);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(11);
    expect(at!).toBeLessThanOrEqual(14);
  });
});
