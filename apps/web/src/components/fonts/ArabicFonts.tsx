"use client";

import { Noto_Kufi_Arabic, Noto_Naskh_Arabic, Noto_Sans_Arabic } from "next/font/google";

// Arabic fallbacks behind the Latin faces (globals.css `--ar-*`): Naskh
// behind the serifs (display and reading), Kufi behind the section heads'
// grotesque, Noto Sans Arabic behind the UI sans and the mono.
const notoNaskhArabic = Noto_Naskh_Arabic({ subsets: ["arabic"], preload: false });
const notoSansArabic = Noto_Sans_Arabic({ subsets: ["arabic"], preload: false });
const notoKufiArabic = Noto_Kufi_Arabic({ subsets: ["arabic"], preload: false });

/** The Arabic faces of the ar pages, loaded through `ScriptFonts`. */
export default function ArabicFonts() {
  return (
    <style>{`:root{--font-noto-naskh-arabic:${notoNaskhArabic.style.fontFamily};--font-noto-sans-arabic:${notoSansArabic.style.fontFamily};--font-noto-kufi-arabic:${notoKufiArabic.style.fontFamily}}`}</style>
  );
}
