"use client";

// Noto Sans/Serif SC and JP cut for the site's own text (#1050,
// scripts/fonts/cjk.ts): a core slice every page uses, then slices of the
// rarer characters grouped by the section that sets them, so a page
// downloads a handful of files instead of dozens of Google's generic
// slices. The families keep their names, which globals.css `--cjk-*` and the
// docs illustrations ask for: SC on Chinese pages, JP on text marked
// lang="ja", whose kanji would otherwise take the Chinese forms.
import "./cjk/cjk.css";

/** The CJK faces of the zh and ja pages. Loaded through `ScriptFonts`, so
 *  their stylesheet blocks only the pages that use them. */
export default function CjkFonts() {
  return null;
}
