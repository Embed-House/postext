import { languageOf } from './locale.js';

const DOTTED_I_LANGUAGES: ReadonlySet<string> = new Set(['tr', 'az']);

let documentCaseLocale: string | undefined;

export function setCaseLocale(locale: string | undefined): void {
  documentCaseLocale = locale;
}

export function getCaseLocale(): string | undefined {
  return documentCaseLocale;
}

function caseTag(locale: unknown): string | undefined {
  const lang = languageOf(locale);
  return DOTTED_I_LANGUAGES.has(lang) ? lang : undefined;
}

export function upperCaseFor(text: string, locale: unknown): string {
  return text.toLocaleUpperCase(caseTag(locale));
}

export function lowerCaseFor(text: string, locale: unknown): string {
  return text.toLocaleLowerCase(caseTag(locale));
}
