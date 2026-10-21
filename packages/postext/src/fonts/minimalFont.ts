// A TrueType file of two empty glyphs (#1105): `.notdef` and one glyph of
// a chosen advance that a format 13 `cmap` maps every listed character to.
// The glyph probe declares one that covers all of Unicode with an advance
// no text face has, so a character measured in a face with the probe
// behind it comes out at that advance exactly when the face lacks it.

import type { CodePointRanges } from './cmap.js';

const UNITS_PER_EM = 1000;

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = Math.ceil(bytes.byteLength / 4);
  for (let i = 0; i < words; i++) {
    const at = i * 4;
    let word = 0;
    for (let k = 0; k < 4; k++) word = (word << 8) | (at + k < bytes.byteLength ? view.getUint8(at + k) : 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

class Writer {
  private readonly bytes: number[] = [];
  u8(v: number): this { this.bytes.push(v & 0xff); return this; }
  u16(v: number): this { return this.u8(v >> 8).u8(v); }
  i16(v: number): this { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number): this { return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff); }
  zeros(n: number): this { for (let i = 0; i < n; i++) this.u8(0); return this; }
  text(s: string): this { for (const ch of s) this.u8(ch.charCodeAt(0)); return this; }
  done(): Uint8Array { return Uint8Array.from(this.bytes); }
}

export interface MinimalFontOptions {
  /** The family the `name` table gives. */
  family: string;
  /** The characters mapped to the glyph. */
  ranges: CodePointRanges;
  /** The glyph's advance, in em. */
  advanceEm: number;
}

/** The bytes of a {@link MinimalFontOptions} font (see the module
 *  comment). */
export function minimalFont(options: MinimalFontOptions): Uint8Array {
  const advance = Math.max(1, Math.min(0xffff, Math.round(options.advanceEm * UNITS_PER_EM)));
  const ranges = options.ranges.filter(([lo, hi]) => hi >= lo && lo <= 0x10ffff);
  const head = new Writer()
    .u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5)
    .u16(0x000b).u16(UNITS_PER_EM)
    .zeros(16)
    .i16(0).i16(-200).i16(advance).i16(800)
    .u16(0).u16(8).i16(2).i16(0).i16(0)
    .done();
  const hhea = new Writer()
    .u32(0x00010000).i16(800).i16(-200).i16(0)
    .u16(advance).i16(0).i16(0).i16(0)
    .i16(1).i16(0).i16(0)
    .zeros(8).i16(0).u16(2)
    .done();
  const maxp = new Writer().u32(0x00010000).u16(2).zeros(26).done();
  const hmtx = new Writer().u16(Math.round(UNITS_PER_EM / 2)).i16(0).u16(advance).i16(0).done();
  const loca = new Writer().u16(0).u16(0).u16(0).done();
  const glyf = new Writer().zeros(4).done();
  const sub = new Writer().u16(13).u16(0).u32(16 + ranges.length * 12).u32(0).u32(ranges.length);
  for (const [lo, hi] of ranges) sub.u32(lo).u32(Math.min(hi, 0x10ffff)).u32(1);
  const subBytes = sub.done();
  const cmap = new Writer().u16(0).u16(1).u16(3).u16(10).u32(12).done();
  const cmapAll = new Uint8Array(cmap.byteLength + subBytes.byteLength);
  cmapAll.set(cmap, 0);
  cmapAll.set(subBytes, cmap.byteLength);
  const records: [number, string][] = [[1, options.family], [2, 'Regular'], [3, `${options.family} Regular`], [4, options.family], [6, options.family.replace(/[^A-Za-z0-9-]/g, '')]];
  const name = new Writer().u16(0).u16(records.length).u16(6 + records.length * 12);
  let offset = 0;
  const strings = new Writer();
  for (const [id, value] of records) {
    name.u16(3).u16(1).u16(0x0409).u16(id).u16(value.length * 2).u16(offset);
    for (const ch of value) strings.u16(ch.charCodeAt(0));
    offset += value.length * 2;
  }
  const nameHead = name.done();
  const nameStrings = strings.done();
  const nameAll = new Uint8Array(nameHead.byteLength + nameStrings.byteLength);
  nameAll.set(nameHead, 0);
  nameAll.set(nameStrings, nameHead.byteLength);
  const os2 = new Writer()
    .u16(4).i16(Math.round(UNITS_PER_EM / 2)).u16(400).u16(5).u16(0)
    .i16(650).i16(700).i16(0).i16(140).i16(650).i16(700).i16(0).i16(480).i16(50).i16(250)
    .i16(0)
    .zeros(10)
    .zeros(16)
    .text('NONE')
    .u16(0x40).u16(0).u16(0xffff)
    .i16(800).i16(-200).i16(0).u16(800).u16(200)
    .zeros(8)
    .i16(500).i16(700).u16(0).u16(32).u16(0)
    .done();
  const post = new Writer().u32(0x00030000).u32(0).i16(-100).i16(50).zeros(20).done();
  const tables: [string, Uint8Array][] = ([
    ['OS/2', os2], ['cmap', cmapAll], ['glyf', glyf], ['head', head], ['hhea', hhea],
    ['hmtx', hmtx], ['loca', loca], ['maxp', maxp], ['name', nameAll], ['post', post],
  ] as [string, Uint8Array][]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const n = tables.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= n) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const dirSize = 12 + n * 16;
  let size = dirSize;
  const offsets: number[] = [];
  for (const [, data] of tables) {
    offsets.push(size);
    size += (data.byteLength + 3) & ~3;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, n);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, n * 16 - searchRange);
  tables.forEach(([t, data], i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) view.setUint8(rec + k, t.charCodeAt(k));
    view.setUint32(rec + 4, checksum(data));
    view.setUint32(rec + 8, offsets[i]!);
    view.setUint32(rec + 12, data.byteLength);
    out.set(data, offsets[i]!);
  });
  const headAt = offsets[tables.findIndex(([t]) => t === 'head')]!;
  view.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
