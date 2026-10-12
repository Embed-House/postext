import { describe, expect, it, vi } from "vitest";
import { readKit } from "./sources.ts";

// The fonts and pdf kit blocks in Node: Fontsource's API from fixtures, the
// woff2 "bytes" are their URLs (#541), kept as bytes: the provider marks
// them (#770).

const LORA = { subsets: ["latin", "latin-ext", "math"], weights: [400, 700], styles: ["normal", "italic"] };
const NOTO = { subsets: ["greek", "latin", "latin-ext", "math"], weights: [400, 700], styles: ["normal"] };
const FILES = "https://cdn.jsdelivr.net/npm/@fontsource";

const response = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
  arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer,
});

function kit() {
  const blocks = readKit();
  const meta: Record<string, unknown> = { lora: LORA, "noto-serif": NOTO };
  const fetch = vi.fn(async (url: string) => {
    const api = /api\.fontsource\.org\/v1\/fonts\/(.+)$/.exec(url);
    if (api) return response(meta[api[1]] ?? {}, meta[api[1]] ? 200 : 404);
    return response(url);
  });
  const decompressWoff2 = (bytes: Uint8Array) => bytes;
  const run = new Function("fetch", "decompressWoff2", "document", "kitStatus", "kitFail",
    `${blocks.fonts}\n${blocks.pdf}\nreturn { fontsourceProvider, kitSubsetsFor };`) as (...args: unknown[]) => {
    fontsourceProvider: (family: string, weight: number, style: string, request?: { codePoints: Set<number> }) => Promise<unknown>;
    kitSubsetsFor: (text: string, meta?: unknown) => string[];
  };
  return run(fetch, decompressWoff2, {}, () => {}, () => {});
}

const codePoints = (text: string) => ({ codePoints: new Set([...text].map((ch) => ch.codePointAt(0)!)) });

/** A font file as the kit hands it: its bytes, marked with the
 *  unicode-range and the place the screen declared it with (#770). */
type Marked = Uint8Array & { unicodeRange?: string; order?: number };
/** What a file is (the tests' "bytes" are the file's name). */
const named = (file: unknown) => new TextDecoder().decode(file as Uint8Array);
/** The files of an answer of several: what each is, the first code points
 *  of its unicode-range and its place among the files of the screen. */
const described = (files: unknown) => (files as Marked[]).map((file) => [named(file), file.unicodeRange?.split(",")[0], file.order]);

describe("kit block pdf: fontsourceProvider", () => {
  it("embeds the latin file alone for Latin-1 text, as before", async () => {
    expect(named(await kit().fontsourceProvider("Lora", 400, "normal", codePoints("Abc é")))).toBe(`${FILES}/lora@5/files/lora-latin-400-normal.woff2`);
    expect(named(await kit().fontsourceProvider("Lora", 700, "italic"))).toBe(`${FILES}/lora@5/files/lora-latin-700-italic.woff2`);
  });

  it("adds latin-ext, then greek, when the family ships them, each marked with its range and its place on screen", async () => {
    // postext-pdf sets a character two files hold (the combining macron of
    // latin and latin-ext) in the one the screen declared last (#770). Each
    // file is still its bytes, which an engine that reads no mark embeds as
    // it did.
    const files = (await kit().fontsourceProvider("Noto Serif", 400, "normal", codePoints("Žídek Cα"))) as Marked[];
    expect(files.every((file) => file instanceof Uint8Array)).toBe(true);
    expect(described(await kit().fontsourceProvider("Noto Serif", 400, "normal", codePoints("Žídek Cα")))).toEqual([
      [`${FILES}/noto-serif@5/files/noto-serif-latin-400-normal.woff2`, "U+0000-00FF", 0],
      [`${FILES}/noto-serif@5/files/noto-serif-latin-ext-400-normal.woff2`, "U+0100-02BA", 1],
      [`${FILES}/noto-serif@5/files/noto-serif-greek-400-normal.woff2`, "U+0370-03FF", 2],
    ]);
    // Greek alone comes after latin too (no range of the two overlaps).
    expect(described(await kit().fontsourceProvider("Noto Serif", 400, "normal", codePoints("Cα")))).toEqual([
      [`${FILES}/noto-serif@5/files/noto-serif-latin-400-normal.woff2`, "U+0000-00FF", 0],
      [`${FILES}/noto-serif@5/files/noto-serif-greek-400-normal.woff2`, "U+0370-03FF", 1],
    ]);
    // Lora ships no greek file: its χ is left to the fallback (C25 names it).
    expect(described(await kit().fontsourceProvider("Lora", 400, "normal", codePoints("χ² †")))).toEqual([
      [`${FILES}/lora@5/files/lora-latin-400-normal.woff2`, "U+0000-00FF", 0],
      [`${FILES}/lora@5/files/lora-latin-ext-400-normal.woff2`, "U+0100-02BA", 1],
    ]);
  });

  it("names the files a text needs that the family ships", () => {
    expect(kit().kitSubsetsFor("plain café", NOTO)).toEqual([]);
    expect(kit().kitSubsetsFor("ō", NOTO)).toEqual(["latin-ext"]);
    expect(kit().kitSubsetsFor("χ", NOTO)).toEqual(["greek"]);
    expect(kit().kitSubsetsFor("χ", LORA)).toEqual([]);
    expect(kit().kitSubsetsFor("χ ō", { subsets: ["latin"] })).toEqual([]);
    expect(kit().kitSubsetsFor("ō", null)).toEqual([]);
  });
});
