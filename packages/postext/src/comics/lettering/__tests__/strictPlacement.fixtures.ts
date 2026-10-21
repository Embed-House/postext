// The panel the strictPlacement tests letter (#728), shared by the files
// they are split in so the workers share the minute they take (#1118).

import { letterPanelDetailed } from '../letter';
import { presetLetteringStyles } from '../presets';
import type { LetteringEnv, LetteringItem, LetteringPanel, Point, Rect } from '../types';

export const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
export const corners = (r: Rect): Point[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];

/** Two figures side by side in a panel `w` × `h`, and three balloons. */
export function roof(w: number, h: number, em: number, locale: string, texts: [string, string, string], env: LetteringEnv) {
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

export const ZH: [string, string, string] = ['……其实，我有点害怕', '我也是。明明我又不上场', '噗，你在说什么呀'];
export const JA: [string, string, string] = ['……ほんとはね、ちょっと怖いんだ', '僕も。試合に出ないのに', 'ふふっ、なにそれ'];

