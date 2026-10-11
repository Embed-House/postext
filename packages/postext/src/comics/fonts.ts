/**
 * The faces a document's comic pages are lettered in (#559), for hosts
 * that load fonts before a build: the lettering face, every balloon
 * style's own face (the sound-effect face among them) and the cast's. The
 * defaults follow the document language (`Comic Neue`, `Zen Antique` for
 * Japanese, `Bangers` for sound effects…), so a book that never names them
 * still needs them as soon as it has a `:::page`.
 */

import type { PostextConfig } from '../types';
import { presentTag } from '../locale';
import { resolveComicsConfig } from '../defaults/comics';
import { parseComicFence } from './page';

/** A line that opens a comic block (`:::page`, `:::strip`). */
const COMIC_FENCE_LINE = /^[ \t]*:::(?:page|strip)(?=[\s{]|$)/m;

/** Whether a Markdown text (or any of several, the chapters of a book)
 *  holds a comic page or strip. */
export function markdownHasComics(markdown: string | readonly string[] | undefined): boolean {
  if (markdown === undefined) return false;
  const texts = typeof markdown === 'string' ? [markdown] : markdown;
  return texts.some((t) => COMIC_FENCE_LINE.test(t));
}

/** A `font=` attribute somewhere in a text: only then is it parsed. */
const LINE_FONT_HINT = /\bfont\s*=/;
/** Every line that opens a comic block. */
const COMIC_FENCE_LINES = /^[ \t]*:::(?:page|strip)(?=[\s{]|$)/gm;

/**
 * The families the comic script lines of a text name themselves (#696):
 * `sfx{font="Dela Gothic One"}: ドン` sets that line in a face the
 * configuration never mentions (`comicLetteringStyle` takes it before the
 * cast's and the style's). Read with the comic parser, so a commented
 * line, or a `font=` outside a comic block, counts for nothing. First
 * seen first.
 */
export function comicLineFontFamilies(markdown: string | readonly string[] | undefined): string[] {
  if (markdown === undefined) return [];
  const out = new Set<string>();
  for (const text of typeof markdown === 'string' ? [markdown] : markdown) {
    if (!LINE_FONT_HINT.test(text)) continue;
    let from = 0;
    for (const fence of text.matchAll(COMIC_FENCE_LINES)) {
      // A fence line inside the block before it is that block's text.
      if (fence.index < from) continue;
      const block = parseComicFence(text, fence.index);
      if (!block) continue;
      from = block.end;
      for (const panel of block.source.panels) {
        for (const item of panel.items) if (item.font) out.add(item.font);
      }
    }
  }
  return [...out];
}

/**
 * The families the comic pages of a document letter with: none when the
 * config has no `comics` section and no text given holds a comic block;
 * else the lettering face, each balloon style's and each cast member's
 * (defaults resolved for the document language), then the ones the script
 * lines name themselves ({@link comicLineFontFamilies}), first seen first.
 */
export function comicFontFamilies(config: PostextConfig, markdown?: string | readonly string[]): string[] {
  if (!config.comics && !markdownHasComics(markdown)) return [];
  const locale = presentTag(config.locale) ?? presentTag(config.bodyText?.hyphenation?.locale);
  const comics = resolveComicsConfig(config.comics, locale);
  const out = new Set<string>();
  out.add(comics.lettering.fontFamily);
  for (const s of comics.balloonStyles) if (s.fontFamily) out.add(s.fontFamily);
  for (const c of comics.cast) if (c.fontFamily) out.add(c.fontFamily);
  for (const family of comicLineFontFamilies(markdown)) out.add(family);
  return [...out];
}
