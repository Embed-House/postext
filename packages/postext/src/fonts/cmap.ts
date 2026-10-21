// The characters a font file has glyphs for (#1105), read from its `cmap`
// table: a TrueType or OpenType file, or the first face of a collection.
// WOFF and WOFF2 files are compressed and answer null here; a host that
// can decompress them passes the sfnt bytes.

/** Code point intervals `[lo, hi]`, sorted and apart. */
export type CodePointRanges = readonly (readonly [number, number])[];

const tag = (view: DataView, at: number): string =>
  String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/** Whether `bytes` is a TrueType or OpenType file (or a collection of
 *  them), the kind {@link sfntCodePointRanges} reads. */
export function isSfnt(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tag(view, 0);
  return t === 'ttcf' || t === 'OTTO' || t === 'true' || view.getUint32(0) === 0x00010000;
}

/** Sort and merge intervals. */
function merged(ranges: [number, number][]): [number, number][] {
  ranges.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The characters one subtable maps to a glyph other than `.notdef`, or
 *  null for a format this reader leaves alone (2, 8, 10, 14). */
function subtableRanges(view: DataView, at: number): [number, number][] | null {
  const format = view.getUint16(at);
  const out: [number, number][] = [];
  const add = (lo: number, hi: number): void => {
    if (hi >= lo) out.push([lo, hi]);
  };
  if (format === 0) {
    for (let c = 0; c < 256; c++) if (view.getUint8(at + 6 + c) !== 0) add(c, c);
    return out;
  }
  if (format === 6) {
    const first = view.getUint16(at + 6);
    const count = view.getUint16(at + 8);
    for (let k = 0; k < count; k++) if (view.getUint16(at + 10 + k * 2) !== 0) add(first + k, first + k);
    return out;
  }
  if (format === 4) {
    const segX2 = view.getUint16(at + 6);
    const ends = at + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const offsets = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const end = view.getUint16(ends + s);
      const start = view.getUint16(starts + s);
      const delta = view.getInt16(deltas + s);
      const offset = view.getUint16(offsets + s);
      if (start > end || start === 0xffff) continue;
      if (offset === 0) {
        // Every code of the segment maps to (code + delta) mod 65536: the
        // one that lands on 0 is `.notdef`.
        const zero = (0x10000 - delta) & 0xffff;
        if (zero >= start && zero <= end) {
          add(start, zero - 1);
          add(zero + 1, end);
        } else add(start, end);
        continue;
      }
      let runFrom = -1;
      for (let c = start; c <= end; c++) {
        const p = offsets + s + offset + (c - start) * 2;
        const raw = p + 2 <= view.byteLength ? view.getUint16(p) : 0;
        const glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        if (glyph !== 0) {
          if (runFrom < 0) runFrom = c;
        } else if (runFrom >= 0) {
          add(runFrom, c - 1);
          runFrom = -1;
        }
      }
      if (runFrom >= 0) add(runFrom, end);
    }
    return out;
  }
  if (format === 12 || format === 13) {
    const groups = view.getUint32(at + 12);
    for (let g = 0; g < groups; g++) {
      const p = at + 16 + g * 12;
      if (p + 12 > view.byteLength) break;
      const start = view.getUint32(p);
      const end = Math.min(view.getUint32(p + 4), 0x10ffff);
      const glyph = view.getUint32(p + 8);
      // Format 12 counts up from `glyph`, format 13 maps the whole group
      // to it.
      if (format === 13) {
        if (glyph !== 0) add(start, end);
      } else add(glyph === 0 ? start + 1 : start, end);
    }
    return out;
  }
  return null;
}

/**
 * The characters a TrueType or OpenType file (the first face of a
 * collection) maps to a glyph, as sorted intervals: the Unicode subtable a
 * browser reads (a full-repertoire one, format 12 or 13, else the BMP's
 * format 4), or, in a symbol font, its private-use codes and the Latin-1
 * codes they stand for. Null when the bytes are not such a file or have no
 * Unicode `cmap` (a WOFF or WOFF2 file, a damaged one).
 */
export function sfntCodePointRanges(bytes: Uint8Array): CodePointRanges | null {
  if (!isSfnt(bytes)) return null;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let base = 0;
    if (tag(view, 0) === 'ttcf') base = view.getUint32(12);
    const numTables = view.getUint16(base + 4);
    let cmap = -1;
    for (let t = 0; t < numTables; t++) {
      const rec = base + 12 + t * 16;
      if (tag(view, rec) === 'cmap') {
        cmap = view.getUint32(rec + 8);
        break;
      }
    }
    if (cmap < 0) return null;
    const count = view.getUint16(cmap + 2);
    let full: number | undefined;
    let bmp: number | undefined;
    let symbol: number | undefined;
    for (let k = 0; k < count; k++) {
      const rec = cmap + 4 + k * 8;
      const platform = view.getUint16(rec);
      const encoding = view.getUint16(rec + 2);
      const at = cmap + view.getUint32(rec + 4);
      const format = view.getUint16(at);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (unicode && (format === 12 || format === 13)) full ??= at;
      else if (unicode && (format === 4 || format === 6 || format === 0)) bmp ??= at;
      else if (platform === 3 && encoding === 0) symbol ??= at;
    }
    const chosen = full ?? bmp;
    if (chosen !== undefined) {
      const ranges = subtableRanges(view, chosen);
      return ranges ? merged(ranges) : null;
    }
    if (symbol !== undefined) {
      const ranges = subtableRanges(view, symbol);
      if (!ranges) return null;
      const latin: [number, number][] = [];
      for (const [lo, hi] of ranges) {
        const a = Math.max(lo, 0xf000);
        const b = Math.min(hi, 0xf0ff);
        if (a <= b) latin.push([a - 0xf000, b - 0xf000]);
      }
      return merged([...ranges, ...latin]);
    }
    return null;
  } catch {
    return null;
  }
}

/** Whether `ranges` hold `cp` (a binary search). */
export function rangesHave(ranges: CodePointRanges, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The part of `ranges` inside `within` (a slice's `unicode-range`). */
export function intersectRanges(ranges: CodePointRanges, within: CodePointRanges): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of ranges) {
    for (const [c, d] of within) {
      const lo = Math.max(a, c);
      const hi = Math.min(b, d);
      if (lo <= hi) out.push([lo, hi]);
    }
  }
  return merged(out);
}

/** The union of several interval lists. */
export function unionRanges(lists: readonly CodePointRanges[]): [number, number][] {
  return merged(lists.flatMap((l) => l.map(([a, b]) => [a, b] as [number, number])));
}
