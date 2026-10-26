import { languageOf } from '../locale.js';

const BREAKING_LANGUAGES = new Set(['tr', 'az']);
const AFTER_F = new Set(['i', 'ı', 'î']);

export function ligatureBreaksOf(config: { locale?: string; bodyText?: { turkishLigatures?: 'break' | 'keep' } } | undefined): boolean {
  return BREAKING_LANGUAGES.has(languageOf(config?.locale)) && config?.bodyText?.turkishLigatures !== 'keep';
}

export function hasBreakableLigature(text: string): boolean {
  return /f[iıî]/.test(text);
}

export function ligatureParts(text: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (let i = 1; i < text.length; i++) {
    if (text[i - 1] === 'f' && AFTER_F.has(text[i]!)) {
      parts.push(text.slice(from, i));
      from = i;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

export function partsMetrics(parts: readonly string[], measure: (part: string) => TextMetrics): TextMetrics {
  const joined: Record<string, number> = {};
  let width = 0;
  for (const part of parts) {
    const m = measure(part) as unknown as Record<string, number>;
    for (const key in m) {
      const v = m[key]!;
      joined[key] = key === 'actualBoundingBoxLeft'
        ? joined[key] ?? v
        : Math.max(joined[key] ?? -Infinity, key === 'actualBoundingBoxRight' ? width + v : v);
    }
    width += m.width!;
  }
  joined.width = width;
  return joined as unknown as TextMetrics;
}

let paintBreaks = false;

export function setPaintLigatureBreaks(on: boolean): void {
  paintBreaks = on;
}

export function getPaintLigatureBreaks(): boolean {
  return paintBreaks;
}
