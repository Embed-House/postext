import { languageOf } from '../locale.js';

export const ZWNJ = '\u200C';

const LIGATURE_RE = /f(?=[iıî])/g;
const BREAKING_LANGUAGES = new Set(['tr', 'az']);

export function ligatureBreaksOf(config: { locale?: string; bodyText?: { turkishLigatures?: 'break' | 'keep' } } | undefined): boolean {
  return BREAKING_LANGUAGES.has(languageOf(config?.locale)) && config?.bodyText?.turkishLigatures !== 'keep';
}

export function hasBreakableLigature(text: string): boolean {
  return /f[iıî]/.test(text);
}

export function breakLigatures(text: string): string {
  return text.includes('f') ? text.replace(LIGATURE_RE, `f${ZWNJ}`) : text;
}

let paintBreaks = false;

export function setPaintLigatureBreaks(on: boolean): void {
  paintBreaks = on;
}

export function getPaintLigatureBreaks(): boolean {
  return paintBreaks;
}

export function paintLigatureText(text: string): string {
  return paintBreaks ? breakLigatures(text) : text;
}

export function ligatureParts(text: string): string[] {
  return breakLigatures(text).split(ZWNJ);
}
