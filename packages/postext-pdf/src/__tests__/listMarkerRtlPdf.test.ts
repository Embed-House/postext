import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDocument } from 'postext';
import type { PostextConfig, VDTDocument } from 'postext';
import fontkit from '@pdf-lib/fontkit';
import { renderToPdf } from '../pdf-backend/index.js';
import { parseFontString } from '../fontString.js';

// postext #664: the marker of a right-to-left list item reads in its
// item's direction in the PDF, as on the canvas and in HTML: `1-` with the
// hyphen on the number's left, between the number and the text; #665: a
// compound number of an Arabic-script book orders from the right.

const fontBytes = fs.readFileSync(new URL('../../../../apps/web/public/fonts/Lora-Regular.ttf', import.meta.url));
const fontProvider = async () => new Uint8Array(fontBytes);
const face = fontkit.create(Buffer.from(fontBytes));

class StubCtx {
  font = '';
  letterSpacing = '0px';
  measureText(s: string): { width: number } {
    const sizePx = parseFontString(this.font)?.sizePx ?? 16;
    return { width: (face.layout(s).advanceWidth / face.unitsPerEm) * sizePx };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const MD = Array.from({ length: 12 }, (_, i) => `${i + 1}. Item${String.fromCharCode(97 + i)} alpha beta`).join('\n');

function config(extra: PostextConfig): PostextConfig {
  return {
    page: { width: pt(300), height: pt(420), dpi: 72, margins: { top: pt(30), bottom: pt(30), left: pt(30), right: pt(30) } },
    layout: { layoutType: 'single' },
    header: { elements: [] },
    footer: { elements: [] },
    numerals: 'latn',
    bodyText: { fontFamily: 'Lora', fontSize: pt(11), lineHeight: pt(16), textAlign: 'left', hyphenation: { enabled: false } },
    orderedLists: { levels: [{ level: 1, numberFormat: 'arabic', separator: '-' }] } as unknown as PostextConfig['orderedLists'],
    ...extra,
  };
}

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

interface Word { text: string; xMin: number; xMax: number; yMin: number }

/** The words of the first page with their boxes (`pdftotext -bbox`), and
 *  the page's text in content-stream order (`-raw`). */
async function read(doc: VDTDocument, tag: string): Promise<{ words: Word[]; raw: string }> {
  const bytes = await renderToPdf(doc, { fontProvider });
  const file = path.join(os.tmpdir(), `postext-marker-${process.pid}-${tag}.pdf`);
  fs.writeFileSync(file, bytes);
  try {
    const xml = execFileSync('pdftotext', ['-enc', 'UTF-8', '-bbox', file, '-'], { encoding: 'utf8' });
    const words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)]
      .map((m) => ({ text: m[4]!, xMin: Number(m[1]), yMin: Number(m[2]), xMax: Number(m[3]) }));
    const raw = execFileSync('pdftotext', ['-enc', 'UTF-8', '-raw', file, '-'], { encoding: 'utf8' });
    return { words, raw };
  } finally {
    fs.unlinkSync(file);
  }
}

/** The marker's characters on the line of `word`, from the sheet's left. */
function markerOf(words: Word[], word: string): string {
  const w = words.find((x) => x.text === word)!;
  return words.filter((x) => Math.abs(x.yMin - w.yMin) < 4 && /^[-\d().]+$/.test(x.text)).sort((a, b) => a.xMin - b.xMin).map((x) => x.text).join('');
}

describe.skipIf(!hasPdftotext)('the marker of a right-to-left list item in the PDF', () => {
  it('has its hyphen on the number\'s left, the digits in order', async () => {
    const doc = buildDocument({ markdown: MD }, config({ locale: 'ar-MA' }));
    expect(doc.blocks.filter((b) => b.type === 'listItem')[11]!.bulletDirection).toBe('rtl-arabic');
    const { words, raw } = await read(doc, 'rtl');
    expect(markerOf(words, 'Itema')).toBe('-1');
    expect(markerOf(words, 'Iteml')).toBe('-12');
    // On the right of its item's text.
    const text = words.find((w) => w.text === 'Itema')!;
    const marker = words.filter((w) => Math.abs(w.yMin - text.yMin) < 4 && /^[-\d]+$/.test(w.text));
    for (const m of marker) expect(m.xMin).toBeGreaterThan(text.xMax);
    // Drawn in reading order: the number, then its hyphen.
    expect(raw).toMatch(/1\s*-/);
    expect(raw).toMatch(/12\s*-/);
    expect(raw).not.toMatch(/-\s*12/);
  });

  it('mirrors a pair of brackets', async () => {
    const doc = buildDocument({ markdown: MD }, config({
      locale: 'ar-MA',
      orderedLists: { levels: [{ level: 1, numberFormat: 'arabic', prefix: '(', separator: ')' }] } as unknown as PostextConfig['orderedLists'],
    }));
    const { words } = await read(doc, 'brackets');
    // Read back as characters, from the sheet's left: the closing bracket
    // stands on the left (its glyph mirrored to `(`), the opening one on
    // the right.
    expect(markerOf(words, 'Iteml')).toBe(')12(');
  });

  it('a left-to-right list is painted as before', async () => {
    const doc = buildDocument({ markdown: MD }, config({ locale: 'en' }));
    expect(doc.blocks.filter((b) => b.type === 'listItem')[0]!.bulletDirection).toBeUndefined();
    const { words } = await read(doc, 'ltr');
    expect(markerOf(words, 'Itema')).toBe('1-');
    expect(markerOf(words, 'Iteml')).toBe('12-');
  });

  it('a compound contents number orders from the right in an Arabic-script book (#665)', async () => {
    const md = ['# Contents {style="front"}', ':::toc', '# Gates {startAt=3}', 'Text here', '## Great gates', 'Text here'].join('\n\n');
    const extra: PostextConfig = {
      headings: { levels: [{ level: 1, numberingTemplate: '{1}', breakBefore: { enabled: false } }, { level: 2, numberingTemplate: '{1}-{2}' }] } as unknown as PostextConfig['headings'],
      headingStyles: [{ id: 'front', numbered: false, toc: false }] as unknown as PostextConfig['headingStyles'],
      toc: { levels: [{ level: 1, fontSize: pt(10), numberFontSize: pt(10) }, { level: 2, fontSize: pt(10), numberFontSize: pt(10), numberWidth: pt(30) }] } as unknown as PostextConfig['toc'],
    };
    const maghreb = buildDocument({ markdown: md }, config({ locale: 'ar-MA', ...extra }));
    const entry = maghreb.blocks.find((b) => b.tocEntry !== undefined && b.bulletText === '3-1')!;
    expect(entry.bulletDirection).toBe('rtl-arabic');
    const { words } = await read(maghreb, 'toc');
    // The contents number on the entry's line: the chapter on the right.
    expect(markerOf(words, 'Great')).toBe('11-3');
    const three = words.filter((w) => w.text === '3').sort((a, b) => b.xMin - a.xMin)[0]!;
    const hyphen = words.find((w) => w.text === '-' && Math.abs(w.xMax - three.xMin) < 0.01)!;
    expect(hyphen).toBeDefined();
    expect(words.some((w) => w.text === '1' && Math.abs(w.xMax - hyphen.xMin) < 0.01)).toBe(true);
  });
});
