import { buildFixedPublication } from './fixed/index.js';
import { buildReflowablePublication } from './reflowable/index.js';
import { packEpub } from './package/pack.js';
import type { VDTDocument } from 'postext';
import type { EpubSource, RenderToEpubOptions } from './types.js';

/**
 * Write a laid-out book as an EPUB 3 file, entirely in memory (browser or
 * Node). `input` is the book's print documents, one per chapter in order —
 * the chain `renderToPdf` takes — or one document, as `renderToPdf` takes
 * it too. `layout: 'fixed'` reproduces every printed page
 * (pre-paginated); `'reflowable'` writes semantic XHTML whose text
 * reflows to the reader's screen.
 */
export async function renderToEpub(input: EpubSource | VDTDocument, options: RenderToEpubOptions): Promise<Uint8Array> {
  const docs: EpubSource = Array.isArray(input) ? input : [input as VDTDocument];
  if (docs.length === 0) throw new Error('renderToEpub: no documents');
  const publication = options.layout === 'fixed'
    ? await buildFixedPublication(docs, options)
    : await buildReflowablePublication(docs, options);
  options.signal?.throwIfAborted();
  options.onProgress?.({ phase: 'package', done: 0, total: 1 });
  const bytes = packEpub(publication);
  options.onProgress?.({ phase: 'package', done: 1, total: 1 });
  return bytes;
}

export { packEpub } from './package/pack.js';
export { readEpub, resolveHref, dirOf } from './package/read.js';
export { bookIdentifier, epubFontProvider } from './shared/assets.js';
export { uuidV5 } from './shared/uuid.js';
export { buildFixedPublication } from './fixed/index.js';
export { buildReflowablePublication } from './reflowable/index.js';
export type {
  EpubLayout,
  EpubMetadata,
  EpubFontFile,
  EpubSvgFontOptions,
  EpubResourceBytes,
  EpubCover,
  EpubProgress,
  EpubWarning,
  RenderToEpubOptions,
  EpubSource,
  EpubItem,
  EpubSpineEntry,
  EpubNavPoint,
  EpubPageTarget,
  EpubLandmark,
  EpubAccessibility,
  EpubPublication,
  ReadEpubResult,
} from './types.js';
