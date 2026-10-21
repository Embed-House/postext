type DecompressFn = (input: Uint8Array) => Uint8Array | false;

let decoderPromise: Promise<DecompressFn> | null = null;

/** The WOFF2 decoder, imported and built once, on first use. It is
 *  wawoff2's emscripten decoder written as a module of this package
 *  (scripts/woff2-binding.mjs), not wawoff2 itself: wawoff2 waits on an export its glue assigns only when
 *  it believes it runs in Node, so a CDN or bundler that builds it as a web
 *  module (esm.sh does) gets a decoder that never answers. */
function loadDecoder(): Promise<DecompressFn> {
  if (!decoderPromise) {
    decoderPromise = import('./woff2Binding.js').then((binding) => binding.default()).then((mod) => {
      if (typeof mod.decompress !== 'function') throw new Error('WOFF2 decoder: no decompress export');
      return (input: Uint8Array) => mod.decompress(input);
    });
    decoderPromise.catch(() => { decoderPromise = null; });
  }
  return decoderPromise;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Decompress a WOFF2 (RFC 8844) binary to raw TTF/OTF bytes. The WASM
 * decoder weighs ~300 KB and is loaded lazily on first use.
 *
 * Calls are serialized and the output is copied out of WASM memory: the
 * emscripten-generated module keeps a single shared heap, so concurrent
 * invocations corrupt each other, and the returned Uint8Array is a live
 * view that a subsequent call would overwrite.
 */
export async function decompressWoff2(input: Uint8Array): Promise<Uint8Array> {
  const run = async (): Promise<Uint8Array> => {
    const decompress = await loadDecoder();
    const out = decompress(input);
    if (out === false) throw new Error('WOFF2 decoder: ConvertWOFF2ToTTF failed');
    const view = out instanceof Uint8Array ? out : new Uint8Array(out);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
