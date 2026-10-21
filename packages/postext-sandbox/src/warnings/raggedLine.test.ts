import { describe, expect, it } from 'vitest';
import { buildDocument } from 'postext';
import type { PostextConfig } from 'postext';
import { computeWarnings } from './compute.js';
import { warningCategory } from './categories.js';
import { detailFor, titleFor } from '../sidebar/WarningsPanel.js';
import { DEFAULT_LABELS } from '../types/defaultLabels.js';

// #732: a justified line the engine sets ragged (its word spaces would
// stretch past 3×) is a row of the warnings panel, beside the loose lines,
// with the line's text and the stretch it would have needed. A click goes
// to the line: the row carries its source range.

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 5 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const config: PostextConfig = {
  page: { width: pt(160), height: pt(400), dpi: 72, margins: { top: pt(10), bottom: pt(10), left: pt(10), right: pt(10) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontSize: pt(10), lineHeight: pt(14), firstLineIndent: pt(0), textAlign: 'justify', hyphenation: { enabled: false } },
};
// 28 characters to a line: the first cannot take the long word.
const markdown = 'First words.\n\nThe Marrowick Harbourboardcommissioner decided today that the ferry is to make all its crossings.';

describe('raggedLine in the warnings panel (#732)', () => {
  const doc = buildDocument({ markdown }, config);
  const rows = computeWarnings({ markdown, config, doc }).filter((w) => w.payload.kind === 'raggedLine');

  it('lists the line with its text, its ratio and where it is in the text', () => {
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.payload).toMatchObject({ kind: 'raggedLine', text: 'The Marrowick' });
    expect((row!.payload as { ratio: number }).ratio).toBeGreaterThan(3);
    expect(markdown.slice(row!.sourceStart, row!.sourceEnd)).toBe('The Marrowick');
    expect(row!.line).toBe(3);
  });

  it('files it with the loose lines and prints its title and detail', () => {
    expect(warningCategory('raggedLine')).toBe(warningCategory('looseLine'));
    expect(warningCategory('raggedLine')).toBe(warningCategory('cjkLooseLine'));
    const payload = { kind: 'raggedLine' as const, text: 'Marrow Mutual will pay ', ratio: 4.12 };
    expect(titleFor(payload, DEFAULT_LABELS)).toBe('Justified line set ragged');
    expect(detailFor(payload, DEFAULT_LABELS)).toBe('“Marrow Mutual will pay”: reaching the measure would stretch its word spaces to 4.1× their width, so the line is set ragged. Reword it, or give it a place to break.');
  });

  it('says nothing of a text whose lines fill their measure', () => {
    const plain = 'it is so and we go on to the end of it all as one and all do in the way we know it is to be so.';
    const rows = computeWarnings({ markdown: plain, config, doc: buildDocument({ markdown: plain }, config) });
    expect(rows.filter((w) => w.payload.kind === 'raggedLine')).toEqual([]);
  });
});
