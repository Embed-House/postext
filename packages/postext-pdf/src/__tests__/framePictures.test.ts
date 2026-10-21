import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { buildDocument } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { renderToPdf } from '../pdf-backend/index.js';

// Pictures in a frame set in its own writing mode (#960): a vertical frame is
// turned a quarter turn on its page, and a picture in it is laid out
// counter-rotated, so it stands upright on the sheet, on a left-to-right and
// on a right-to-left page.

const TC = new Uint8Array(fs.readFileSync(new URL('./fixtures/cjk/noto-serif-tc-vertical.ttf', import.meta.url)));
const fontProvider = async () => TC;

class StubCtx {
  font = '';
  letterSpacing = '0px';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const chunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  let c = 0xffffffff;
  for (const b of body) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crc]);
};
/** A wide RGB PNG, a red block on the left (so a turn shows). */
function png(width: number, height: number): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      const red = x < width / 4;
      raw[o] = red ? 200 : 235;
      raw[o + 1] = red ? 40 : 235;
      raw[o + 2] = red ? 40 : 220;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]));
}

const pt = (value: number) => ({ value, unit: 'pt' as const });
const relief: Resource = { id: 'relief', typeId: 'figure', kind: 'bitmap', altText: 'A relief', createdAt: 0, updatedAt: 0, bitmap: { fileId: 'relief.png', format: 'png', width: 200, height: 100 } } as Resource;
const config = (extra: Partial<PostextConfig> = {}): PostextConfig => ({
  locale: 'zh-Hant',
  page: { width: pt(400), height: pt(500), dpi: 72, margins: { top: pt(40), bottom: pt(40), left: pt(40), right: pt(40) } },
  bodyText: { fontFamily: 'Noto Serif TC', fontSize: pt(10), lineHeight: pt(20), textAlign: 'left', hyphenation: { enabled: false } },
  header: { elements: [] },
  footer: { elements: [] },
  pageTemplates: [{
    id: 'sheet',
    frames: [
      { name: 'main', flow: true, width: pt(100), height: pt(100), placement: { anchor: { to: 'container', edge: 'top-left' } } },
      { name: 'side', writingMode: 'vertical-rl', width: pt(150), height: pt(300), placement: { anchor: { to: 'container', edge: 'top-right' } } },
    ],
  }],
  ...extra,
} as PostextConfig);
const md = '::::page{template="sheet"}\n此開卷。\n\n:::frame{slot="side"}\n第一回\n\n:::figure{resource="relief"}\n:::\n::::\n';

/** The matrices images are drawn with: `cm` operators in force at each `Do`. */
async function imageMatrices(extra: Partial<PostextConfig>): Promise<number[][]> {
  const doc = buildDocument({ markdown: md, resources: [relief] }, config(extra));
  const pdf = await PDFDocument.load(await renderToPdf(doc, { fontProvider, resourceBytes: () => png(200, 100), accessible: false }));
  const contents = pdf.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const ops = refs.map((r) => {
    const s = pdf.context.lookup(r);
    return s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '';
  }).join('\n');
  type M = number[];
  const mul = (m: M, n: M): M => [
    m[0]! * n[0]! + m[1]! * n[2]!, m[0]! * n[1]! + m[1]! * n[3]!,
    m[2]! * n[0]! + m[3]! * n[2]!, m[2]! * n[1]! + m[3]! * n[3]!,
    m[4]! * n[0]! + m[5]! * n[2]! + n[4]!, m[4]! * n[1]! + m[5]! * n[3]! + n[5]!,
  ];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const out: M[] = [];
  for (const line of ops.split('\n')) {
    if (line === 'q') stack.push(ctm);
    else if (line === 'Q') ctm = stack.pop() ?? ctm;
    const cm = /^([-\d. e]+) cm$/.exec(line);
    if (cm) ctm = mul(cm[1]!.trim().split(/\s+/).map(Number), ctm);
    if (/^\/\S+ Do$/.test(line)) out.push(ctm);
  }
  return out;
}

describe('a picture in a vertical frame, in the PDF (#960)', () => {
  for (const [name, extra] of [['left-to-right', {}], ['right-to-left', { direction: 'rtl' }]] as const) {
    it(`stands upright on a ${name} page: the frame's turn and the picture's cancel`, async () => {
      const drawn = await imageMatrices(extra as Partial<PostextConfig>);
      expect(drawn.length).toBe(1);
      const m = drawn[0]!;
      // No turn left: the picture's width runs along x, its height along y.
      expect(Math.abs(m[1]!)).toBeLessThan(1e-6);
      expect(Math.abs(m[2]!)).toBeLessThan(1e-6);
      expect(Math.abs(m[0]!)).toBeGreaterThan(10);
      expect(Math.abs(m[3]!)).toBeGreaterThan(10);
      // Not turned over either.
      expect(m[0]!).toBeGreaterThan(0);
    });
  }
});
