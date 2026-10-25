import { describe, it, expect } from 'vitest';
import { lowerCaseFor, upperCaseFor } from '../textCase.js';
import { uppercasePreservingLength } from '../pipeline/buildBlockKind.js';
import { buildDocument } from '../pipeline/index.js';
import type { DesignElement, Dimension, PostextConfig } from '../types.js';
import type { VDTDesignTextBlock, VDTDocument } from '../vdt.js';

// Deterministic text measurement stub (no DOM in the node test env).
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

const pt = (value: number): Dimension => ({ value, unit: 'pt' });

describe('upperCaseFor / lowerCaseFor', () => {
  it('follow the Turkish rules for the dotted and dotless i', () => {
    expect(upperCaseFor('ilim', 'tr')).toBe('İLİM');
    expect(lowerCaseFor('ISLAH', 'tr')).toBe('ıslah');
    expect(upperCaseFor('İstanbul', 'tr')).toBe('İSTANBUL');
    expect(upperCaseFor('Birinci Bölüm', 'tr')).toBe('BİRİNCİ BÖLÜM');
    expect(lowerCaseFor('İSTANBUL', 'tr')).toBe('istanbul');
  });

  it('read the language of any Turkish or Azerbaijani tag', () => {
    expect(upperCaseFor('ilim', 'tr-TR')).toBe('İLİM');
    expect(upperCaseFor('ilim', 'TR_tr')).toBe('İLİM');
    expect(upperCaseFor('ilim', 'az')).toBe('İLİM');
  });

  it('keep the default rules for every other language', () => {
    expect(upperCaseFor('ilim', 'en')).toBe('ilim'.toLocaleUpperCase());
    expect(lowerCaseFor('ISLAH', 'de')).toBe('ISLAH'.toLocaleLowerCase());
    expect(upperCaseFor('ilim', undefined)).toBe('ilim'.toLocaleUpperCase());
  });

  it('uppercasePreservingLength keeps the length in Turkish', () => {
    const up = uppercasePreservingLength('ilim ve fıkıh', 'tr');
    expect(up).toBe('İLİM VE FIKIH');
    expect(up.length).toBe('ilim ve fıkıh'.length);
  });
});

const headText = (content: string): DesignElement => ({
  kind: 'text', id: 'head', content, fontSize: pt(10), overflow: 'wrap', textTransform: 'uppercase',
  placement: { anchor: { to: 'container', edge: 'top-left' } },
} as unknown as DesignElement);

const config = (locale: string, extra: Partial<PostextConfig> = {}): PostextConfig => ({
  locale,
  page: { width: pt(400), height: pt(300), dpi: 72, margins: { top: pt(40), right: pt(20), bottom: pt(40), left: pt(20) } },
  layout: { layoutType: 'single' },
  header: { elements: [headText('{chapterTitle}')] },
  footer: { elements: [] },
  headings: { levels: [{ level: 1, breakBefore: { enabled: false } }, { level: 2, textTransform: 'uppercase' }] } as PostextConfig['headings'],
  ...extra,
});

const MD = '# ilim ve fıkıh\n\n' + 'Metin. '.repeat(200) + '\n\n## iki ışık\n\nMetin.\n';

const heads = (doc: VDTDocument): string[] => doc.pages
  .flatMap((p) => p.header?.blocks ?? [])
  .filter((b): b is VDTDesignTextBlock => b.kind === 'text')
  .map((b) => b.lines.map((l) => l.text).join(' '));

const headingLines = (doc: VDTDocument, level: number): string[] => doc.blocks
  .filter((b) => b.type === 'heading' && b.headingLevel === level)
  .map((b) => b.lines.map((l) => l.text).join(' '));

describe('a Turkish document sets its capitals with İ and I', () => {
  it('in the running head', () => {
    expect(heads(buildDocument({ markdown: MD }, config('tr')))).toContain('İLİM VE FIKIH');
    expect(heads(buildDocument({ markdown: MD }, config('en')))).toContain('ILIM VE FIKIH');
  });

  it('in a heading set in capitals, its title as written kept for the bookmarks', () => {
    const doc = buildDocument({ markdown: MD }, config('tr'));
    expect(headingLines(doc, 2).join(' ')).toContain('İKİ IŞIK');
    expect(doc.blocks.find((b) => b.type === 'heading' && b.headingLevel === 2)!.sourceTitle).toBe('iki ışık');
  });

  it('in small capitals, also when the text is shaped in the host language', () => {
    const md = ':smallcaps[ilim] ve fıkıh.';
    const first = (c: PostextConfig) => buildDocument({ markdown: md }, c).blocks.find((b) => b.type === 'paragraph')!.lines[0]!.text;
    expect(first(config('tr'))).toMatch(/^İLİM ve fıkıh/);
    expect(first(config('tr', { bodyText: { shapingLanguage: 'host' } }))).toMatch(/^İLİM ve fıkıh/);
    expect(first(config('en'))).toMatch(/^ILIM ve fıkıh/);
  });
});
