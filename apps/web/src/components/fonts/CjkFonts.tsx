"use client";

import { Noto_Sans_JP, Noto_Sans_SC, Noto_Serif_JP, Noto_Serif_SC } from "next/font/google";

// Han fallbacks behind the Latin faces (globals.css `--cjk-*`): SC on
// Chinese pages, JP on text marked lang="ja", whose kanji would otherwise
// take the Chinese forms. Google serves them in unicode-range slices, so a
// page downloads only the slices its characters need.
const notoSansSc = Noto_Sans_SC({ preload: false });
const notoSerifSc = Noto_Serif_SC({ preload: false });
const notoSansJp = Noto_Sans_JP({ preload: false });
const notoSerifJp = Noto_Serif_JP({ preload: false });

/** The CJK faces of the zh and ja pages. Loaded through `ScriptFonts`, so
 *  their stylesheet (hundreds of `@font-face` slices) blocks only the pages
 *  that use them. */
export default function CjkFonts() {
  return (
    <style>{`:root{--font-noto-sans-sc:${notoSansSc.style.fontFamily};--font-noto-serif-sc:${notoSerifSc.style.fontFamily};--font-noto-sans-jp:${notoSansJp.style.fontFamily};--font-noto-serif-jp:${notoSerifJp.style.fontFamily}}`}</style>
  );
}
