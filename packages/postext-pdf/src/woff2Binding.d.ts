/** wawoff2's WOFF2 decoder as a module of this package, written by
 *  scripts/woff2-binding.mjs (into dist on build, into src for the tests). */
export interface Woff2Module {
  /** Raw TTF/OTF bytes (a view into the decoder's heap), or false. */
  decompress(input: Uint8Array): Uint8Array | false;
}

export default function instantiateWoff2(): Promise<Woff2Module>;
