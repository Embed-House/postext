import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { emptyTemplate, parseTemplate, postextToDocx, readDocx } from 'postext/word';
import { DEFAULT_LABELS } from '../types';
import { trackingText, wordImportActions, wordTrackingPlan } from './sandboxImport';

const em = (value: number) => ({ value, unit: 'em' as const });

/** A book that tracks its styles, written out as Word and read back. */
const MD = ['# One', '', '# The lantern {style="portada"}', '', ':::paragraphs{style="firma"}', 'Signed', ':::', ''].join('\n');
const TRACKED = {
  headings: { levels: [{ level: 1, letterSpacing: em(0.02) }] },
  headingStyles: [{ id: 'portada', name: 'Portada', letterSpacing: em(0.1) }],
  paragraphStyles: [{ id: 'firma', name: 'Firma', letterSpacing: em(0.05) }],
} as unknown as PostextConfig;

function wordDoc() {
  const doc = readDocx(postextToDocx([{ title: 'One', markdown: MD }], { template: emptyTemplate(), config: TRACKED, book: false }));
  return { doc, template: parseTemplate(doc.embeddedTemplate)! };
}

describe('the character spacing of Word styles in the Sandbox import (#951)', () => {
  it('plans the tracking onto the book\'s styles that set none, as the CLI does', () => {
    const { doc, template } = wordDoc();
    const book = {
      headingStyles: [{ id: 'portada', name: 'Portada' }],
      paragraphStyles: [{ id: 'firma', name: 'Firma', letterSpacing: em(0.2) }],
    } as unknown as PostextConfig;
    const plan = wordTrackingPlan(doc, template, book);
    expect(plan.applied.map((t) => [t.style, t.letterSpacing.value])).toEqual(expect.arrayContaining([['heading 1', 0.02], ['Portada', 0.1]]));
    // The paragraph style already tracks: it stays as it is.
    expect(plan.skipped.map((t) => t.style)).toEqual(['Firma']);
    // Only the settings that change are in the patch, whole.
    expect(Object.keys(plan.patch).sort()).toEqual(['headingStyles', 'headings']);
    expect(plan.patch.headingStyles).toEqual([{ id: 'portada', name: 'Portada', letterSpacing: em(0.1) }]);
    expect(plan.patch.headings?.levels).toEqual([{ level: 1, letterSpacing: em(0.02) }]);
    expect(book.headingStyles![0]).toEqual({ id: 'portada', name: 'Portada' });
  });

  it('plans nothing for a document whose styles carry no spacing', () => {
    const doc = readDocx(postextToDocx([{ title: 'One', markdown: MD }], { template: emptyTemplate(), config: {}, book: false }));
    expect(wordTrackingPlan(doc, emptyTemplate(), {})).toEqual({ applied: [], skipped: [], patch: {} });
  });

  it('puts the patch before the text in the import\'s changes, in every destination', () => {
    const { doc, template } = wordDoc();
    const plan = wordTrackingPlan(doc, template, { headingStyles: [{ id: 'portada', name: 'Portada' }] } as unknown as PostextConfig);
    const result = { chapters: [{ title: 'One', markdown: '# One\n' }] };
    const book = { chapters: [], activeChapterId: '' };
    for (const destination of ['chapter', 'append', 'book'] as const) {
      const actions = wordImportActions(result, destination, book, plan.patch);
      expect(actions[0]).toEqual({ type: 'UPDATE_CONFIG', payload: plan.patch });
      expect(actions).toHaveLength(2);
      // Without it the changes are what they were.
      expect(wordImportActions(result, destination, book).some((a) => a.type === 'UPDATE_CONFIG')).toBe(false);
      expect(wordImportActions(result, destination, book, {})).toHaveLength(1);
    }
  });

  it('lists the styles with where each goes, set apart for the bidi algorithm', () => {
    const { doc, template } = wordDoc();
    const book = { headingStyles: [{ id: 'portada', name: 'Portada' }], paragraphStyles: [{ id: 'firma', name: 'Firma' }] } as unknown as PostextConfig;
    const plan = wordTrackingPlan(doc, template, book);
    const text = trackingText(plan.applied, book, DEFAULT_LABELS);
    expect(text).toContain('⁨Portada⁩ → ⁨Portada⁩: 0.1 em');
    expect(text).toContain('⁨Firma⁩ → ⁨Firma⁩: 0.05 em');
    expect(text).toMatch(/→ ⁨Heading Level 1⁩: 0\.02 em/);
  });
});
