"use client";

import dynamic from "next/dynamic";

// Split into their own chunks: `next/dynamic` renders a chunk's stylesheet
// only where the component renders, while a face declared in the layout
// would put its `@font-face` rules in front of every page.
const CjkFonts = dynamic(() => import("./CjkFonts"));
const ArabicFonts = dynamic(() => import("./ArabicFonts"));

/** The web fonts for the non-Latin scripts a locale is written in. Other
 *  pages set Han or Arabic snippets in the system faces globals.css lists. */
export function ScriptFonts({ locale }: { locale: string }) {
  if (locale === "zh" || locale === "ja") return <CjkFonts />;
  if (locale === "ar") return <ArabicFonts />;
  return null;
}
