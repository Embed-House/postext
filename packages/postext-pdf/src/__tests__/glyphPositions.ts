/**
 * Where a PDF paints its glyphs, read from its own content streams (postext
 * #770): the tests' way to say that a glyph stands where the layout put
 * it, without a reader's guess at word boxes.
 *
 * A page's streams are decoded and their text operators followed (`q` `Q`
 * `cm`, `BT` `ET`, `Tf` `Tm` `Td` `TD` `T*`, `Tc` `Tw` `Tz` `TL` `Ts`,
 * `Tj` `TJ` `'` `"`), each glyph advancing by its width in the embedded
 * font's `/W`. Fonts are the composite ones pdf-lib embeds (two bytes a
 * glyph); form XObjects are not entered.
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFObject } from 'pdf-lib';

/** A glyph as a page shows it. */
export interface PaintedGlyph {
  /** The text object (`BT` … `ET`) it is shown in, counted from 0 on its page. */
  object: number;
  /** The resource name of its font, and the font's `/BaseFont`. */
  font: string;
  baseFont: string;
  /** Its code: the glyph id in the embedded file. */
  code: number;
  /** What `/ToUnicode` reads it as (empty with no entry). */
  text: string;
  /** Its origin and the pen after it, character spacing included (pt). */
  x: number;
  y: number;
  end: number;
  /** Its own advance (its `/W` width at the font size), pt. */
  advance: number;
  /** The font size, pt. */
  size: number;
  /** Its outline's box in the embedded file, thousandths of the em: `left right bottom top`. */
  box: string;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** `a` then `b`. */
function mul(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
}

type Token = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'hex'; v: number[] } | { t: 'arr'; v: Token[] } | { t: 'op'; v: string } | { t: 'other' };

/** The tokens of a content stream pdf-lib wrote: numbers, names, hex
 *  strings, arrays, operators; a dictionary or a literal string is one
 *  token of no interest. */
function tokenize(src: string): Token[] {
  let p = 0;
  const n = src.length;
  const space = (c: string): boolean => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
  const read = (): Token | undefined => {
    while (p < n && space(src[p]!)) p++;
    if (p >= n) return undefined;
    const c = src[p]!;
    if (c === '[') {
      p++;
      const v: Token[] = [];
      for (;;) {
        while (p < n && space(src[p]!)) p++;
        if (p >= n || src[p] === ']') break;
        const tok = read();
        if (!tok) break;
        v.push(tok);
      }
      p++;
      return { t: 'arr', v };
    }
    if (c === '<' && src[p + 1] === '<') {
      let depth = 0;
      do {
        if (src.startsWith('<<', p)) { depth++; p += 2; } else if (src.startsWith('>>', p)) { depth--; p += 2; } else p++;
      } while (depth > 0 && p < n);
      return { t: 'other' };
    }
    if (c === '<') {
      const end = src.indexOf('>', p);
      const hex = src.slice(p + 1, end).replace(/\s/g, '');
      p = end + 1;
      const v: number[] = [];
      for (let i = 0; i + 1 < hex.length; i += 2) v.push(parseInt(hex.slice(i, i + 2), 16));
      return { t: 'hex', v };
    }
    if (c === '(') {
      let depth = 0;
      do {
        if (src[p] === '\\') p++;
        else if (src[p] === '(') depth++;
        else if (src[p] === ')') depth--;
        p++;
      } while (depth > 0 && p < n);
      return { t: 'other' };
    }
    let s = '';
    if (c === '/') {
      p++;
      while (p < n && !space(src[p]!) && !'()<>[]/'.includes(src[p]!)) s += src[p++];
      return { t: 'name', v: s };
    }
    while (p < n && !space(src[p]!) && !'()<>[]/'.includes(src[p]!)) s += src[p++];
    if (s === '') {
      p++;
      return { t: 'other' };
    }
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? { t: 'num', v: parseFloat(s) } : { t: 'op', v: s };
  };
  const out: Token[] = [];
  for (let tok = read(); tok; tok = read()) out.push(tok);
  return out;
}

interface Face {
  baseFont: string;
  widths: Map<number, number>;
  toUnicode: Map<number, string>;
  file?: ReturnType<typeof fontkit.create>;
}

function streamText(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()) : undefined;
}

function faceOf(pdf: PDFDocument, dict: PDFDict): Face {
  const ctx = pdf.context;
  const face: Face = { baseFont: dict.lookup(PDFName.of('BaseFont'))?.toString() ?? '', widths: new Map(), toUnicode: new Map() };
  const map = streamText(dict.lookup(PDFName.of('ToUnicode')));
  if (map) {
    const utf16 = (hex: string): string => {
      let s = '';
      for (let i = 0; i + 3 < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      return s;
    };
    for (const section of map.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of section[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) face.toUnicode.set(parseInt(m[1]!, 16), utf16(m[2]!));
    }
    for (const section of map.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of section[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const lo = parseInt(m[1]!, 16);
        const base = utf16(m[3]!);
        for (let c = lo; c <= parseInt(m[2]!, 16); c++) face.toUnicode.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - lo));
      }
    }
  }
  const descendants = dict.lookup(PDFName.of('DescendantFonts'));
  const cid = descendants instanceof PDFArray ? descendants.lookup(0, PDFDict) : undefined;
  const w = cid?.lookup(PDFName.of('W'));
  if (w instanceof PDFArray) {
    const items = w.asArray().map((o) => ctx.lookup(o));
    for (let i = 0; i < items.length;) {
      const first = (items[i] as PDFNumber).asNumber();
      const next = items[i + 1];
      if (next instanceof PDFArray) {
        next.asArray().forEach((o, k) => face.widths.set(first + k, (ctx.lookup(o) as PDFNumber).asNumber()));
        i += 2;
      } else {
        for (let c = first; c <= (next as PDFNumber).asNumber(); c++) face.widths.set(c, (items[i + 2] as PDFNumber).asNumber());
        i += 3;
      }
    }
  }
  const descriptor = cid?.lookup(PDFName.of('FontDescriptor'));
  const file = descriptor instanceof PDFDict ? descriptor.lookup(PDFName.of('FontFile2')) ?? descriptor.lookup(PDFName.of('FontFile3')) : undefined;
  if (file instanceof PDFRawStream) face.file = fontkit.create(Buffer.from(decodePDFRawStream(file).decode()));
  return face;
}

/** The glyphs of each page of `bytes`, in the order they are shown. */
export async function paintedGlyphs(bytes: Uint8Array): Promise<PaintedGlyph[][]> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const faces = new Map<string, Face>();
  return pdf.getPages().map((page) => {
    const fonts = new Map<string, Face>();
    const dict = page.node.Resources()?.lookup(PDFName.of('Font'));
    if (dict instanceof PDFDict) {
      for (const [key, ref] of dict.entries()) {
        const id = ref instanceof PDFRef ? ref.toString() : key.toString();
        let face = faces.get(id);
        if (!face) {
          face = faceOf(pdf, pdf.context.lookup(ref, PDFDict));
          faces.set(id, face);
        }
        fonts.set(key.decodeText(), face);
      }
    }
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    return interpret(tokenize(refs.map((ref) => streamText(pdf.context.lookup(ref)) ?? '').join('\n')), fonts);
  });
}

interface TextState {
  font: string;
  size: number;
  tc: number;
  tz: number;
  tl: number;
}

function interpret(tokens: Token[], fonts: Map<string, Face>): PaintedGlyph[] {
  const glyphs: PaintedGlyph[] = [];
  let ctm = IDENTITY;
  let ts: TextState = { font: '', size: 0, tc: 0, tz: 1, tl: 0 };
  const stack: Array<{ ctm: Matrix; ts: TextState }> = [];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  let object = -1;
  const operands: Token[] = [];
  const num = (k: number): number => {
    const tok = operands[k];
    return tok && tok.t === 'num' ? tok.v : 0;
  };
  const move = (x: number, y: number): void => {
    tlm = mul([1, 0, 0, 1, x, y], tlm);
    tm = tlm;
  };
  const show = (bytes: number[]): void => {
    const face = fonts.get(ts.font);
    for (let k = 0; k + 1 < bytes.length; k += 2) {
      const code = (bytes[k]! << 8) | bytes[k + 1]!;
      const advance = ((face?.widths.get(code) ?? 1000) / 1000) * ts.size * ts.tz;
      const m = mul(tm, ctm);
      const step = advance + ts.tc * ts.tz;
      let box = '';
      try {
        const b = face?.file?.getGlyph(code).bbox;
        const k1000 = 1000 / (face?.file?.unitsPerEm ?? 1000);
        if (b) box = [b.minX, b.maxX, b.minY, b.maxY].map((v) => Math.round(v * k1000)).join(' ');
      } catch {
        // A glyph the embedded file cannot decode: no box.
      }
      glyphs.push({ object, font: ts.font, baseFont: face?.baseFont ?? '', code, text: face?.toUnicode.get(code) ?? '', x: m[4], y: m[5], end: m[0] * step + m[4], advance, size: ts.size * Math.hypot(m[2], m[3]), box });
      tm = mul([1, 0, 0, 1, step, 0], tm);
    }
  };
  for (const tok of tokens) {
    if (tok.t !== 'op') {
      operands.push(tok);
      continue;
    }
    const first = operands[0];
    switch (tok.v) {
      case 'q': stack.push({ ctm, ts: { ...ts } }); break;
      case 'Q': {
        const saved = stack.pop();
        if (saved) ({ ctm, ts } = saved);
        break;
      }
      case 'cm': ctm = mul([num(0), num(1), num(2), num(3), num(4), num(5)], ctm); break;
      case 'BT': tm = tlm = IDENTITY; object++; break;
      case 'Tf': ts.font = first?.t === 'name' ? first.v : ''; ts.size = num(1); break;
      case 'Tc': ts.tc = num(0); break;
      case 'Tz': ts.tz = num(0) / 100; break;
      case 'TL': ts.tl = num(0); break;
      case 'Tm': tm = tlm = [num(0), num(1), num(2), num(3), num(4), num(5)]; break;
      case 'Td': move(num(0), num(1)); break;
      case 'TD': ts.tl = -num(1); move(num(0), num(1)); break;
      case 'T*': move(0, -ts.tl); break;
      case 'Tj': if (first?.t === 'hex') show(first.v); break;
      case 'TJ':
        if (first?.t === 'arr') {
          for (const part of first.v) {
            if (part.t === 'hex') show(part.v);
            else if (part.t === 'num') tm = mul([1, 0, 0, 1, (-part.v / 1000) * ts.size * ts.tz, 0], tm);
          }
        }
        break;
      default: break;
    }
    operands.length = 0;
  }
  return glyphs;
}
