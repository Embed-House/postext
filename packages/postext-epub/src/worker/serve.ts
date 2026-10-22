// The worker side of `createEpubWorker`: answers render requests on a
// message port (the worker's global scope, or a MessagePort in tests).

import { evictFontFamilies } from 'postext';
import { renderToEpub } from '../index.js';
import type { EpubFontFile } from '../types.js';
import type { EpubRequestMessage, EpubResponseMessage } from './protocol.js';

/** The faces already in this worker's set, by family, weight, slant and
 *  range: a book written again does not add them twice. */
const registered = new Set<string>();

/**
 * Give the worker's own `FontFaceSet` the book's faces before its pages
 * are written.
 *
 * A worker has none of the page's fonts, and the pages' markup measures
 * text again as it writes it: the words of a design text go in a box
 * each, at the width the measurer gives them (`wordBoxesHtml`), and the
 * pieces of a word are joined at theirs (`wordSegmentsOf`). Without the
 * faces every one of those is measured in the worker's fallback, which
 * pulls the words of a contents heading apart and runs its leader over
 * them. The bytes are already here to be embedded, so the set takes them
 * from the same files.
 *
 * Widths measured before the faces landed were measured in the fallback:
 * `evictFontFamilies` drops them, with pretext's glyph cache. A face the
 * set will not take is skipped and the writer falls back on its own
 * (`measuresOwnFace`).
 */
async function registerWorkerFonts(fonts: readonly EpubFontFile[] | undefined): Promise<void> {
  const set = (globalThis as { fonts?: FontFaceSet }).fonts;
  if (!set || typeof FontFace === 'undefined' || !fonts || fonts.length === 0) return;
  const loaded = await Promise.all(fonts.map(async (f) => {
    const key = `${f.family}\u0000${f.weight}\u0000${f.style}\u0000${f.unicodeRange ?? ''}`;
    if (registered.has(key)) return null;
    try {
      const face = new FontFace(f.family, f.bytes as BufferSource, {
        weight: String(f.weight),
        style: f.style,
        ...(f.unicodeRange !== undefined ? { unicodeRange: f.unicodeRange } : {}),
      });
      await face.load();
      return { key, face, family: f.family };
    } catch (err) {
      console.warn('[postext-epub/worker] failed to register font', f.family, err);
      return null;
    }
  }));
  const added = new Set<string>();
  for (const entry of loaded) {
    if (!entry || registered.has(entry.key)) continue;
    set.add(entry.face);
    registered.add(entry.key);
    added.add(entry.family);
  }
  if (added.size > 0) evictFontFamilies(added);
}

/** What the worker needs of its scope. */
export interface EpubWorkerPort {
  postMessage(message: EpubResponseMessage, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<EpubRequestMessage>) => void): void;
  close(): void;
}

/** Write the books asked for on `port`, one `renderToEpub` per request,
 *  with progress and warnings posted as they happen. */
export function serveEpubRequests(port: EpubWorkerPort): void {
  const running = new Map<number, AbortController>();
  const post = (msg: EpubResponseMessage, transfer: Transferable[] = []): void => port.postMessage(msg, transfer);

  port.addEventListener('message', async (event) => {
    const msg = event.data;
    switch (msg.kind) {
      case 'render': {
        const controller = new AbortController();
        running.set(msg.id, controller);
        const bytesById = new Map(msg.resourceBytes);
        try {
          // The faces first: the pages are measured as they are written.
          await registerWorkerFonts(msg.settings.fonts);
          const bytes = await renderToEpub(msg.docs, {
            ...msg.settings,
            resourceBytes: (fileId) => bytesById.get(fileId),
            onProgress: (progress) => post({ kind: 'progress', id: msg.id, progress }),
            onWarning: (warning) => post({ kind: 'warning', id: msg.id, warning }),
            signal: controller.signal,
          });
          post({ kind: 'rendered', id: msg.id, bytes }, [bytes.buffer]);
        } catch (err) {
          post({
            kind: 'error',
            id: msg.id,
            message: err instanceof Error ? err.message : String(err),
            ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
            ...(controller.signal.aborted ? { aborted: true } : {}),
          });
        } finally {
          running.delete(msg.id);
        }
        return;
      }
      case 'cancel': {
        running.get(msg.id)?.abort();
        return;
      }
      case 'dispose': {
        for (const controller of running.values()) controller.abort();
        port.close();
        return;
      }
    }
  });
}
