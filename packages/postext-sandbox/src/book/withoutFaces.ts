/**
 * The documents laid out while the layout worker lacked a file their faces
 * asked for (#757): a font request the network did not answer, or files
 * still on their way past the longest a build waits. Their text is set in
 * a fallback, so what they say of a chapter (how many pages, where its
 * headings fall) is not the book's: a record made from one is marked
 * (`ChapterLayout.withoutFaces`), kept out of the stored records and of a
 * bundle, and dropped when the faces arrive so the chapter is laid out
 * again.
 */
const documents = new WeakSet<object>();

/** Say of `doc` that it was laid out without a face it asked for. */
export function markBuiltWithoutFaces(doc: object): void {
  documents.add(doc);
}

/** True for a document the layout service built without a face it asked
 *  for. */
export function builtWithoutFaces(doc: object | null | undefined): boolean {
  return !!doc && documents.has(doc);
}
