/**
 * The CJK faces of the zh and ja pages (#1050): Noto Sans/Serif SC and JP,
 * cut for the site's own text instead of Google's generic slices. A page
 * downloads the slices its characters fall in: a core every page uses, a
 * middle tier, and clusters of the rarer characters grouped by the section
 * that sets them (`scripts/fonts/cjk.ts plan` measures that on the live
 * pages). Characters the site's sources hold but no page showed when the
 * plan was measured go to extra slices, so nothing the site writes falls to
 * a system face; the test in `cjkFonts.test.ts` holds the sources to that.
 *
 * Node only (reads the sources); run by Node's type stripping too.
 */
import fs from "node:fs";
import path from "node:path";
import { GLOSSARY_TERMS } from "./glossary/terms.ts";

export type CjkFaceKey = "sansSC" | "serifSC" | "sansJP" | "serifJP";

export interface CjkFace {
  key: CjkFaceKey;
  family: string;
  /** Prefix of the slice files. */
  slug: string;
  /** The script the face sets: zh text, or ja text (a ja page, or a part
   *  of another page marked lang="ja"). */
  script: "zh" | "ja";
  /** The variable source in github.com/google/fonts, pinned by
   *  {@link GOOGLE_FONTS_COMMIT} and checked by its SHA-256. */
  source: string;
  sha256: string;
  /** The `wght` axis of the source. */
  weight: string;
}

/** The commit of github.com/google/fonts the sources are taken from: the
 *  same cuts the Google Fonts API serves. */
export const GOOGLE_FONTS_COMMIT = "47d54ca1ebb14fd864695f1d39dc734f39017c33";

export const CJK_FACES: readonly CjkFace[] = [
  { key: "sansSC", family: "Noto Sans SC", slug: "sans-sc", script: "zh", source: "ofl/notosanssc/NotoSansSC[wght].ttf", sha256: "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da", weight: "100 900" },
  { key: "serifSC", family: "Noto Serif SC", slug: "serif-sc", script: "zh", source: "ofl/notoserifsc/NotoSerifSC[wght].ttf", sha256: "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9", weight: "200 900" },
  { key: "sansJP", family: "Noto Sans JP", slug: "sans-jp", script: "ja", source: "ofl/notosansjp/NotoSansJP[wght].ttf", sha256: "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f", weight: "100 900" },
  { key: "serifJP", family: "Noto Serif JP", slug: "serif-jp", script: "ja", source: "ofl/notoserifjp/NotoSerifJP[wght].ttf", sha256: "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc", weight: "200 900" },
];

/** One slice: a file and the characters it covers. */
export interface CjkSlice {
  id: string;
  chars: string;
}

/** `cjk.json`: what the generator cut, per face. */
export interface CjkManifest {
  commit: string;
  faces: Record<CjkFaceKey, {
    slices: CjkSlice[];
    /** Characters the sources hold that the face has no glyph for: they
     *  fall to the system faces, as they would with any cut. */
    absent: string;
  }>;
}

/** Where the slices, `cjk.css` and `cjk.json` live. */
export function cjkDir(webDir: string): string {
  return path.join(webDir, "src", "components", "fonts", "cjk");
}

export function readCjkManifest(webDir: string): CjkManifest {
  return JSON.parse(fs.readFileSync(path.join(cjkDir(webDir), "cjk.json"), "utf8")) as CjkManifest;
}

/** Whether a character is one the CJK faces are there for: from General
 *  Punctuation up (CJK, kana, fullwidth forms, circled numbers, arrows and
 *  the symbols the Latin faces in front of them may lack), not Latin.
 *  Noto has glyphs for some of them that the Latin faces also have; those
 *  are set in the Latin face, as before, whatever the slices hold. */
export function isCjkFontChar(cp: number): boolean {
  if (cp < 0x2000) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if (cp >= 0xe000 && cp <= 0xf8ff) return false; // private use
  if (cp >= 0xfe00 && cp <= 0xfe0f) return false; // variation selectors
  if (cp >= 0x1f000) return cp >= 0x20000 && cp <= 0x3ffff; // emoji no, Han extensions yes
  return !(cp >= 0x2000 && cp <= 0x200f) && !(cp >= 0x2028 && cp <= 0x202f) && !(cp >= 0x2060 && cp <= 0x206f);
}

/** The CJK-face characters of a text, in code point order. */
export function cjkChars(text: string, into = new Set<string>()): Set<string> {
  for (const ch of text) if (isCjkFontChar(ch.codePointAt(0)!)) into.add(ch);
  return into;
}

export function sortChars(chars: Iterable<string>): string {
  return [...new Set(chars)].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join("");
}

/** A CSS `unicode-range` for a set of characters, runs merged. */
export function unicodeRange(chars: string): string {
  const cps = [...new Set([...chars].map((c) => c.codePointAt(0)!))].sort((a, b) => a - b);
  const parts: string[] = [];
  const hex = (n: number) => n.toString(16).toUpperCase();
  for (let i = 0; i < cps.length; i++) {
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j++;
    parts.push(j === i ? `U+${hex(cps[i])}` : `U+${hex(cps[i])}-${hex(cps[j])}`);
    i = j;
  }
  return parts.join(",");
}

function filesIn(dir: string, test: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(test).sort().map((f) => path.join(dir, f));
}

/** Source files whose text the zh or ja pages set: the messages, the docs,
 *  the Cookbook pages, and the components that hold literal text (the docs
 *  illustrations draw Han and kana samples on every locale). */
export function cjkSourceFiles(webDir: string, script: "zh" | "ja"): string[] {
  const repo = path.resolve(webDir, "../..");
  const files = [
    path.join(webDir, "messages", `${script}.json`),
    ...filesIn(path.join(repo, "docs"), (f) => f.endsWith(`-${script}.mdx`)),
    ...filesIn(path.join(repo, "cookbook"), (f) => !f.startsWith("_") && !f.includes("."))
      .map((d) => path.join(d, `${script}.mdx`))
      .filter((f) => fs.existsSync(f)),
  ];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(webDir, "src", "components"));
  return files;
}

/** Every character the site's sources set in a face: what its slices must
 *  cover. The glossary gives each locale's terms plus the native names a
 *  page marks in the face's language (a Japanese term on a Chinese page). */
export function cjkCorpus(webDir: string, face: CjkFace): Set<string> {
  const set = new Set<string>();
  for (const f of cjkSourceFiles(webDir, face.script)) cjkChars(fs.readFileSync(f, "utf8"), set);
  const nativeLang = face.script === "zh" ? "zh-Hans" : "ja";
  for (const t of GLOSSARY_TERMS) {
    for (const s of t.text[face.script]) if (s) cjkChars(s, set);
    if (t.native && t.nativeLang === nativeLang) cjkChars(t.native, set);
  }
  return set;
}

/** The characters a face's slices cover, and the ones it has no glyph for. */
export function coveredChars(manifest: CjkManifest, key: CjkFaceKey): Set<string> {
  const face = manifest.faces[key];
  return new Set([...face.slices.flatMap((s) => [...s.chars]), ...face.absent]);
}
