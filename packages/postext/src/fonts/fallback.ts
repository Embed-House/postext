// The open family a custom family's missing faces are set in (#978).
//
// A licensed face a bundle may not hand on is left out of it, and the pages
// laid out with the reader's fallback break lines elsewhere: frames overflow
// that do not with the face. A custom family that names a `fallback` (a
// family of about the same width) has the faces it has no file for set in
// that one under its own name, by every host that loads fonts: all of them
// when it has no file, a slant it has no file of otherwise.

import type { CustomFontFamily } from '../types';
import { primaryFontFamily } from '../measure/font';

/** The family that stands in for `family`'s faces without a file, by its
 *  name (case-insensitive), or undefined. A family never stands in for
 *  itself. */
export function fontFallbackOf(
  customFonts: readonly Pick<CustomFontFamily, 'name' | 'fallback'>[] | undefined,
  family: string,
): string | undefined {
  const key = primaryFontFamily(family).trim().toLowerCase();
  for (const f of customFonts ?? []) {
    if (f.name.trim().toLowerCase() !== key) continue;
    const fallback = f.fallback?.trim();
    return fallback && fallback.toLowerCase() !== key ? fallback : undefined;
  }
  return undefined;
}

/** The families of `customFonts` that name a fallback, as `{ family,
 *  fallback, variants }` (the faces the family has files for, which are
 *  not set in the fallback). */
export function fontFallbackFamilies(
  customFonts: readonly Pick<CustomFontFamily, 'name' | 'fallback' | 'variants'>[] | undefined,
): { family: string; fallback: string; variants: readonly { weight: number; style: 'normal' | 'italic' }[] }[] {
  const out: { family: string; fallback: string; variants: readonly { weight: number; style: 'normal' | 'italic' }[] }[] = [];
  for (const f of customFonts ?? []) {
    const fallback = fontFallbackOf([f], f.name);
    if (fallback) out.push({ family: f.name, fallback, variants: f.variants });
  }
  return out;
}

/** Whether the family has a file of this slant. A family with files only
 *  sets in its fallback the slant it has none of (an italic it lacks); a
 *  family with no file at all sets every face in it. A weight between the
 *  family's own files is left to the browser's matching, as it is for any
 *  family. */
export function hasOwnStyle(
  variants: readonly { weight: number; style: 'normal' | 'italic' }[],
  style: 'normal' | 'italic',
): boolean {
  return variants.some((v) => v.style === style);
}
