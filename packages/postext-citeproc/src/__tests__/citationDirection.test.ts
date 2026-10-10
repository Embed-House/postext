import { describe, expect, it } from 'vitest';
import { buildDocument, type PostextConfig, type VDTBlock, type VDTDocument, type VDTLine } from 'postext';
import '../register';

// postext #667: a citation set against the direction of the text it joins
// is a bidi isolate of its own first strong letter's direction, so its
// closing punctuation stays where the reference ends. Found on Cookbook
// Nº 107 (#660): the notes of an Arabic article printed
// `./W3C, "…", https://www.w3.org/TR/alreq`, the URL's last solidus and the
// full stop at the far left of the line.

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const base: PostextConfig = {
  page: { width: pt(900), height: pt(600), dpi: 72, margins: { top: pt(20), bottom: pt(20), left: pt(20), right: pt(20) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { textAlign: 'left', hyphenation: { enabled: false } },
};

const FRONT = `---
references:
  - id: w3c
    type: webpage
    author: [{literal: W3C}]
    title: Arabic & Persian Layout Requirements
    URL: https://www.w3.org/TR/alreq/
    language: en
  - id: nemeth
    type: book
    author: [{family: Nemeth, given: Titus}]
    title: Arabic Type-Making in the Machine Age
    publisher: Brill
    issued: 2017
    language: en
  - id: hashimi
    type: book
    author: [{family: الهاشمي, given: منى}]
    title: الحرف العربي على الشاشة
    publisher: دار المثال
    issued: 2019
    language: ar
---
`;

/** A line's pieces from the sheet's left to its right. */
function onSheet(doc: VDTDocument, line: VDTLine): string {
  const segs = line.segments ?? [];
  const order = line.order ?? segs.map((_, i) => i);
  const flow = order.map((i) => segs[i]!.text);
  return (doc.config.direction === 'rtl' ? flow.reverse() : flow).join('');
}
const note = (doc: VDTDocument): VDTBlock => doc.blocks.find((b) => b.footnoteNote !== undefined)!;
const entry = (doc: VDTDocument, id: string): VDTBlock => doc.blocks.find((b) => b.bibEntry === id)!;
const logical = (b: VDTBlock): string => b.lines.map((l) => (l.segments ?? []).map((s) => s.text).join('')).join(' ');

describe('a Latin reference in an Arabic document', () => {
  const chicago: PostextConfig = { ...base, locale: 'ar', citations: { style: 'chicago-notes-bibliography', notes: 'footnote', locale: 'ar' } };
  const doc = buildDocument({ markdown: `${FRONT}# عنوان\n\nنص الفقرة.[@w3c]\n` }, chicago);

  it('a note keeps the last solidus of its URL and its full stop after it', () => {
    const n = note(doc);
    const text = logical(n);
    expect(text).toContain('https://www.w3.org/TR/alreq/.');
    const sheet = n.lines.map((l) => onSheet(doc, l)).join('\n');
    // The reference reads from left to right, whole, to its full stop.
    expect(sheet).toContain('W3C, "Arabic & Persian Layout Requirements", https://www.w3.org/TR/alreq/.');
    expect(sheet).not.toMatch(/\.\/W3C/);
    expect(sheet).not.toMatch(/^\./m);
    // The note stays a right-to-left paragraph of the page: its number on
    // the right of the reference.
    expect(n.direction).toBeUndefined();
    const first = onSheet(doc, n.lines[0]!);
    expect(first.indexOf('W3C')).toBeLessThan(first.search(/[١1]/));
  });

  it('a bibliography entry keeps its closing marks', () => {
    const e = entry(doc, 'w3c');
    const sheet = e.lines.map((l) => onSheet(doc, l)).join('\n');
    expect(sheet).toMatch(/https:\/\/www\.w3\.org\/TR\/alreq\/\.$/);
    expect(sheet).not.toMatch(/^\./m);
  });

  it('a title that ends a line keeps its closing quotation mark', () => {
    // Narrow enough to break the note after the title.
    const narrow = buildDocument({ markdown: `${FRONT}# عنوان\n\nنص الفقرة.[@w3c]\n` }, { ...chicago, page: { ...base.page!, width: pt(390) } });
    const lines = note(narrow).lines.map((l) => onSheet(narrow, l));
    expect(lines.length).toBeGreaterThan(1);
    const withTitle = lines.find((l) => l.includes('Requirements'))!;
    expect(withTitle).toContain('Requirements",');
    for (const l of lines) expect(l).not.toMatch(/^[."/]/);
  });

  it('an Arabic work runs with the paragraph, its full stop at the left end', () => {
    const arabic = buildDocument({ markdown: `${FRONT}# عنوان\n\nنص الفقرة.[@hashimi]\n` }, chicago);
    const n = note(arabic);
    expect(n.lines.flatMap((l) => l.segments ?? []).some((s) => s.rtl)).toBe(true);
    const last = onSheet(arabic, n.lines[n.lines.length - 1]!);
    // The segment that ends the sentence (`).`, painted right to left)
    // stands on the left of the publisher and the year.
    expect(last.indexOf(').')).toBe(0);
    expect(last.indexOf(').')).toBeLessThan(last.indexOf('المثال'));
  });

  it('an author-date citation in the sentence keeps its brackets round it', () => {
    const apa = buildDocument({ markdown: `${FRONT}# عنوان\n\nنص الفقرة [@nemeth] وما بعدها.\n` }, { ...base, locale: 'ar', citations: { style: 'apa', locale: 'en' } });
    const para = apa.blocks.find((b) => b.type === 'paragraph' && logical(b).includes('Nemeth'))!;
    expect(onSheet(apa, para.lines[0]!)).toContain('(Nemeth, 2017)');
  });

  it('a numbered marker, which has no letter, is left as it is', () => {
    const ieee = buildDocument({ markdown: `${FRONT}# عنوان\n\nنص الفقرة [@nemeth].\n` }, { ...base, locale: 'ar', citations: { style: 'ieee' } });
    const para = ieee.blocks.find((b) => b.type === 'paragraph' && /\[[١1]\]/.test(logical(b)))!;
    expect(para).toBeDefined();
    expect(para.lines[0]!.segments!.every((s) => s.level === undefined || s.level <= 2)).toBe(true);
  });
});

describe('an Arabic reference in an English document', () => {
  const chicago: PostextConfig = { ...base, locale: 'en', citations: { style: 'chicago-notes-bibliography', notes: 'footnote' } };

  it('reads from right to left inside its note, its full stop at its end', () => {
    const doc = buildDocument({ markdown: `${FRONT}# Title\n\nSome text.[@hashimi]\n` }, chicago);
    const sheet = note(doc).lines.map((l) => onSheet(doc, l)).join('\n');
    // The stop after the last Arabic word stands on the left of the
    // reference, where a right-to-left sentence ends.
    // (The segment `).` is painted right to left: the stop on the far left.)
    expect(sheet.indexOf(').')).toBeGreaterThanOrEqual(0);
    expect(sheet.indexOf(').')).toBeLessThan(sheet.indexOf('الهاشمي'));
    expect(sheet.endsWith('.')).toBe(false);
    expect(sheet.endsWith('منى')).toBe(true);
  });

  it('a document in one direction keeps its spans and its lines', () => {
    const doc = buildDocument({ markdown: `${FRONT}# Title\n\nSome text.[@nemeth] More.[@w3c]\n` }, chicago);
    for (const b of doc.blocks) for (const l of b.lines) {
      expect(l.order).toBeUndefined();
      for (const s of l.segments ?? []) {
        expect(s.rtl).toBeUndefined();
        expect(s.level).toBeUndefined();
      }
    }
  });
});
