/**
 * The contrast pairs of the open book (#748), for the colour fields: the
 * provider publishes them when the Checks are recomputed, the fields read
 * them through {@link useContrastSnapshot}.
 */

import { useSyncExternalStore } from 'react';
import {
  authoredCmykColors,
  contrastMedia,
  contrastPairs,
  resolveContrastConfig,
  resolvePdfGenerationConfig,
  resolvePrintConfig,
  type ContrastMedium,
  type ContrastPair,
  type OutputTransform,
  type PostextConfig,
  type ResolvedContrastConfig,
  type VDTDocument,
} from 'postext';
import type { ContrastSnapshot } from './fieldContrast.js';

const EMPTY: ContrastSnapshot = { pairs: [], level: 'AA', media: ['screen'], enabled: true };

let snapshot: ContrastSnapshot = EMPTY;
let signature = '';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => snapshot;

export function useContrastSnapshot(): ContrastSnapshot {
  return useSyncExternalStore(subscribe, read, read);
}

/** The snapshot as last published (for code outside React). */
export function contrastSnapshot(): ContrastSnapshot {
  return snapshot;
}

const transformIds = new WeakMap<OutputTransform, number>();
let nextTransformId = 1;
function transformId(transform: OutputTransform | undefined): number {
  if (!transform) return 0;
  let id = transformIds.get(transform);
  if (!id) transformIds.set(transform, (id = nextTransformId++));
  return id;
}

/** The renditions a book is checked in. The laid-out document does not
 *  follow the print or contrast settings (they are out of the layout key),
 *  so they are read from the book's configuration. */
export function contrastMediaFor(config: PostextConfig, doc: VDTDocument, contrast: ResolvedContrastConfig = resolveContrastConfig(config.contrast)): ContrastMedium[] {
  return contrastMedia({
    ...doc.config,
    print: resolvePrintConfig(config.print),
    pdfGeneration: resolvePdfGenerationConfig(config.pdfGeneration),
  }, contrast);
}

const pairCache = new WeakMap<VDTDocument, { key: string; pairs: ContrastPair[] }>();

/** The pairs of one document, walked once per settings and separation. */
export function documentContrastPairs(doc: VDTDocument, contrast: ResolvedContrastConfig, transform: OutputTransform | undefined): ContrastPair[] {
  const key = `${contrast.level}|${JSON.stringify(contrast.reversedText)}|${transformId(transform)}`;
  const hit = pairCache.get(doc);
  if (hit && hit.key === key) return hit.pairs;
  const pairs = contrastPairs(doc, { contrast, ...(transform ? { transform } : {}) });
  pairCache.set(doc, { key, pairs });
  return pairs;
}

/** Publish the pairs of the documents laid out so far. A snapshot equal
 *  to the last one is dropped, so the fields do not render again. */
export function publishContrast(laidOut: readonly VDTDocument[], config: PostextConfig, transform: OutputTransform | undefined): void {
  const contrast = resolveContrastConfig(config.contrast);
  const docs = laidOut.filter((doc) => !!doc.config?.page?.backgroundColor && !!doc.config.page.cutLines);
  const first = docs[0];
  const media = first ? contrastMediaFor(config, first, contrast) : EMPTY.media;
  const pairs = docs.flatMap((doc) => documentContrastPairs(doc, contrast, transform));
  const next = [
    contrast.enabled, contrast.level, media.join('+'), transformId(transform),
    ...pairs.map((p) => `${p.textColor}>${p.groundColor}>${p.color}>${p.background}>${p.sizePt}>${p.weight}>${p.count}`),
  ].join('|');
  if (next === signature) return;
  signature = next;
  snapshot = {
    pairs,
    level: contrast.level,
    media,
    enabled: contrast.enabled,
    ...(transform && first ? { print: { transform, authored: authoredCmykColors(first.config) } } : {}),
  };
  // After the caller's own work: a selector may be asking for the warnings
  // while React renders.
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
}
