import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TTF = new Uint8Array(fs.readFileSync(path.join(here, 'fixtures/arabic/amiri-latin-slice.ttf')));

/** The fixture as WOFF2, compressed by wawoff2 itself (Node). */
async function woff2Fixture(): Promise<Uint8Array> {
  const { compress } = await import('wawoff2');
  return compress(TTF);
}

/** A promise that settles in `ms` or says it did not. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)),
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('decompressWoff2', () => {
  it('turns a WOFF2 back into the TrueType it was made from', async () => {
    const woff2 = await woff2Fixture();
    expect(String.fromCharCode(...woff2.slice(0, 4))).toBe('wOF2');
    const { decompressWoff2 } = await import('../woff2.js');
    const ttf = await within(decompressWoff2(woff2), 20_000);
    expect(Array.from(ttf.slice(0, 4))).toEqual([0, 1, 0, 0]);
    expect(ttf.length).toBeGreaterThan(woff2.length);
  });

  // A page, as a CDN or a bundler builds the decoder for it: `window` and
  // `document` are there, and esm.sh's `process` polyfill names no Node
  // version. wawoff2's own glue then took its web branch, never handed its
  // runtime to wawoff2, and every PDF asking for a WOFF2 font waited for
  // ever (the Cookbook's PDFs, 2026-10). The decoder must not look.
  it('answers in a page as it does in Node', async () => {
    const woff2 = await woff2Fixture();
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', { currentScript: { src: 'https://example.test/pen.js' } });
    vi.stubGlobal('importScripts', () => { throw new Error('not a worker'); });
    const versions = Object.getOwnPropertyDescriptor(process, 'versions')!;
    Object.defineProperty(process, 'versions', { value: {}, configurable: true });
    try {
      const { decompressWoff2 } = await import('../woff2.js');
      const ttf = await within(decompressWoff2(woff2), 20_000);
      expect(Array.from(ttf.slice(0, 4))).toEqual([0, 1, 0, 0]);
    } finally {
      Object.defineProperty(process, 'versions', versions);
    }
  });

  it('serializes calls and keeps each answer its own', async () => {
    const woff2 = await woff2Fixture();
    const { decompressWoff2 } = await import('../woff2.js');
    const [a, b] = await within(Promise.all([decompressWoff2(woff2), decompressWoff2(woff2)]), 20_000);
    expect(a).not.toBe(b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('rejects bytes that are no WOFF2', async () => {
    const { decompressWoff2 } = await import('../woff2.js');
    await expect(within(decompressWoff2(new Uint8Array([1, 2, 3, 4])), 20_000)).rejects.toThrow(/WOFF2/);
  });

  // The package must not reach wawoff2 at run time: wawoff2 works only with
  // a patch this repository applies and no CDN or user install has.
  it('imports no wawoff2 outside its tests', () => {
    const src = path.join(here, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(file); continue; }
        if (!/\.ts$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
        if (/['"]wawoff2['"]/.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(src, file));
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
