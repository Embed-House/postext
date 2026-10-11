import type { CslItem } from './types';

/**
 * The family names and the `literal` names of every person of `items`
 * (authors, editors, translators and the other name fields of a CSL
 * record): what `citations.hyphenateNames: false` keeps whole (#699).
 */
export function citedNames(items: readonly CslItem[]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    for (const value of Object.values(item)) {
      if (!Array.isArray(value)) continue;
      for (const person of value) {
        if (!person || typeof person !== 'object') continue;
        const { family, literal } = person as { family?: unknown; literal?: unknown };
        if (typeof family === 'string' && family.trim() !== '') out.add(family.trim());
        if (typeof literal === 'string' && literal.trim() !== '') out.add(literal.trim());
      }
    }
  }
  return [...out].sort();
}
