import type { DocEntry } from "@/lib/docs";

/** Chapter numbers of the docs in a language, in reading order: a page with
 *  no `parent` is a chapter ("3"), a page of a chapter is numbered under it
 *  ("3.2"). A page whose parent is missing in that language counts as a
 *  chapter. Pure: shared by the server pages and the client sidebar. */
export function docNumbers(docs: DocEntry[], locale: string): Map<string, string> {
  const available = docs.filter((d) => d.locales[locale]);
  const present = new Set(available.map((d) => d.slug));
  const numbers = new Map<string, string>();
  const children = new Map<string, number>();
  let chapter = 0;
  for (const doc of available) {
    const parent = doc.locales[locale]!.parent;
    if (parent && present.has(parent) && numbers.has(parent)) {
      const n = (children.get(parent) ?? 0) + 1;
      children.set(parent, n);
      numbers.set(doc.slug, `${numbers.get(parent)}.${n}`);
    } else {
      chapter += 1;
      numbers.set(doc.slug, String(chapter));
    }
  }
  return numbers;
}

/** The parent of a page in a language ("" for a chapter). */
export function docParent(doc: DocEntry, locale: string): string {
  return doc.locales[locale]?.parent ?? "";
}
