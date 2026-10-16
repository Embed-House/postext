/**
 * The alpha channel of a PNG, read synchronously (#883): the shape a
 * contour wrap runs round is traced from it in any host, the browser's
 * layout worker and Node alike, with no canvas. Only what the trace needs
 * is decoded: the opacity of every pixel.
 */
import { unzlibSync } from 'fflate';

/** One byte of opacity per pixel, row by row (0 transparent, 255 opaque). */
export interface AlphaRaster {
  width: number;
  height: number;
  alpha: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Channels per pixel by colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Whether `bytes` start as a PNG file. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return false;
  return true;
}

/**
 * The opacity of every pixel of a PNG. `null` when the picture has no
 * transparency at all (no alpha channel and no `tRNS` chunk: every pixel
 * is opaque); `undefined` when the file cannot be read here (not a PNG,
 * damaged, interlaced).
 */
export function decodePngAlpha(input: ArrayBuffer | Uint8Array): AlphaRaster | null | undefined {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isPng(bytes)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at);
    const name = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const data = bytes.subarray(at + 8, at + 8 + len);
    if (data.length < len) return undefined;
    if (name === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = bytes[at + 16]!;
      type = bytes[at + 17]!;
      interlace = bytes[at + 20]!;
    } else if (name === 'tRNS') {
      trns = data;
    } else if (name === 'IDAT') {
      idat.push(data);
    } else if (name === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  const channels = CHANNELS[type];
  if (!channels || width <= 0 || height <= 0 || idat.length === 0 || interlace !== 0) return undefined;
  if (![1, 2, 4, 8, 16].includes(depth)) return undefined;
  const hasAlpha = type === 4 || type === 6;
  if (!hasAlpha && !trns) return null;

  let total = 0;
  for (const d of idat) total += d.length;
  const packed = new Uint8Array(total);
  let off = 0;
  for (const d of idat) {
    packed.set(d, off);
    off += d.length;
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(packed);
  } catch {
    return undefined;
  }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) return undefined;

  const alpha = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const sample = (row: Uint8Array, index: number): number => {
    // The `index`-th sample of the row, at the file's bit depth.
    if (depth === 8) return row[index]!;
    if (depth === 16) return (row[index * 2]! << 8) | row[index * 2 + 1]!;
    const bit = index * depth;
    const byte = row[bit >> 3]!;
    const shift = 8 - depth - (bit & 7);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const max = (1 << depth) - 1;
  const keyOf = (i: number): number => (trns && trns.length >= (i + 1) * 2 ? (trns[i * 2]! << 8) | trns[i * 2 + 1]! : -1);
  const key = type === 0 ? keyOf(0) : -1;
  const keyRgb = type === 2 ? [keyOf(0), keyOf(1), keyOf(2)] : undefined;
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i]!;
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return undefined;
      }
      cur[i] = v & 0xff;
    }
    const row = y * width;
    for (let px = 0; px < width; px++) {
      let o: number;
      if (type === 6) o = sample(cur, px * 4 + 3);
      else if (type === 4) o = sample(cur, px * 2 + 1);
      else if (type === 3) {
        const idx = sample(cur, px);
        alpha[row + px] = trns && idx < trns.length ? trns[idx]! : 255;
        continue;
      } else if (type === 0) {
        o = sample(cur, px) === key ? 0 : max;
      } else {
        const r = sample(cur, px * 3);
        const g = sample(cur, px * 3 + 1);
        const bl = sample(cur, px * 3 + 2);
        o = keyRgb && r === keyRgb[0] && g === keyRgb[1] && bl === keyRgb[2] ? 0 : max;
      }
      alpha[row + px] = depth === 8 ? o : Math.round((o / max) * 255);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return { width, height, alpha };
}
