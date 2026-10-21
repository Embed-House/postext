// The fixes of a frame that does not fit, one click each (#868), on P4's
// p. 8 stand-in laid out by the engine, its first box held to 36 mm and
// given four more paragraphs: every proposal of the reflow ladder (#858)
// carried out makes the box fit, each is one step of the undo history
// (#899) and undoing it gives the book back; a shorter text is only
// selected; a proposal the book no longer matches is refused.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { FrameOverflowProposal, PostextConfig, Resource, VDTDocument } from 'postext';
import { sandboxReducer, type SandboxAction, type SandboxState } from '../context/SandboxContext.js';
import { composeBook } from '../book/compose.js';
import { resetViewerEdits } from '../editor/viewerEdits.js';
import { createSandboxHistory, setActiveHistory } from '../history/sandboxHistory.js';
import { state as baseState } from '../webmcp/tools/testHarness.js';
import { DEFAULT_LABELS } from '../types/index.js';
import { computeComposedWarnings } from './compute.js';
import {
  applyProposalPlan, getAtPointer, planProposal, pointerInWords, pointerSteps, proposalContextOf, proposalLeaves, setAtPointer, valueInWords,
} from './proposalActions.js';
import { proposalQuestion, runProposal } from './ProposalButtons.js';
import type { Warning } from './types.js';

type Fixture = (locale: 'es' | 'en') => { markdown: string; config: PostextConfig; resources: Resource[] };
const FIXTURES = '../../../postext/src/__tests__/composed/fixtures/';
let page8Fixture: Fixture;
beforeAll(async () => {
  page8Fixture = ((await import(/* @vite-ignore */ new URL(`${FIXTURES}page8.ts`, import.meta.url).href)) as { page8Fixture: Fixture }).page8Fixture;
});
afterEach(() => {
  setActiveHistory(null);
  resetViewerEdits();
});

const mm = (value: number) => ({ value, unit: 'mm' as const });
const moreMoney = (n: number) => (md: string): string =>
  md.replace(/(:::frame\{slot="dinero"[^\n]*\n)/, `$1${Array.from({ length: n }, (_, i) => `Más dinero ${i} `.repeat(30).trim()).join('\n\n')}\n\n`);

/** The same page with a box that grows with its text (a roomier
 *  template, where the box fits). */
const roomy = (tpl: NonNullable<PostextConfig['pageTemplates']>[number]) => ({ ...tpl, id: 'tema-amplio' });

/** A two-chapter book (the composed page second, so its offsets in the
 *  book are not the chapter's), the box overflowing; the Sandbox's store
 *  over the reducer with its history. */
function setUp() {
  const fixture = page8Fixture('es');
  const tpl = fixture.config.pageTemplates![0]!;
  const config: PostextConfig = {
    ...fixture.config,
    pageTemplates: [{ ...tpl, frames: tpl.frames!.map((f) => (f.name === 'dinero' ? { ...f, height: mm(36), minHeight: undefined } : f)) }, roomy(tpl)],
  };
  const chapters = [
    { id: 'intro', title: 'Intro', markdown: '# Intro\n\nUnas palabras antes.\n', createdAt: 1, updatedAt: 1 },
    { id: 'p8', title: 'Página 8', markdown: moreMoney(4)(fixture.markdown), createdAt: 1, updatedAt: 1 },
  ];
  let current: SandboxState = { ...baseState(), chapters, activeChapterId: 'intro', markdown: chapters[0]!.markdown, config, resources: fixture.resources };
  const history = createSandboxHistory({
    dispatch: (a: SandboxAction) => { current = sandboxReducer(current, a); },
    getState: () => current,
    editorStates: (() => { const m = new Map<string, unknown>(); return () => m; })(),
  });
  setActiveHistory(history);
  const layout = () => {
    const book = composeBook(current.chapters);
    const doc: VDTDocument = buildDocument({ markdown: book.markdown, resources: current.resources }, current.config, createMeasurementCache());
    const warnings = computeComposedWarnings({ markdown: book.markdown, config: current.config, doc, resources: current.resources, book });
    return { doc, warnings, overflow: warnings.find((w) => w.payload.kind === 'frameOverflow' && w.payload.frame === 'dinero') };
  };
  return { history, layout, get: () => current };
}

const proposalOf = (w: Warning, kind: FrameOverflowProposal['kind']): FrameOverflowProposal => {
  if (w.payload.kind !== 'frameOverflow') throw new Error('not an overflow');
  const p = w.payload.proposals.find((x) => x.kind === kind);
  if (!p) throw new Error(`no ${kind} among ${w.payload.proposals.map((x) => x.kind).join(', ')}`);
  return p;
};

describe('one-click fixes of a frame that does not fit (#868)', () => {
  it('the box overflows with every kind of proposal, in the chapter it is in', () => {
    const { layout } = setUp();
    const { overflow } = layout();
    expect(overflow).toBeDefined();
    expect(overflow!.chapterId).toBe('p8');
    expect((overflow!.payload as { proposals: FrameOverflowProposal[] }).proposals.map((p) => p.kind).sort())
      .toEqual(['allowShrink', 'continueNextPage', 'raiseMax', 'shortenText', 'useTemplate']);
  });

  for (const kind of ['allowShrink', 'raiseMax', 'continueNextPage'] as const) {
    it(`${kind}: the configuration value at its pointer, one undo step, and the box fits`, () => {
      const { layout, history, get } = setUp();
      const before = get().config;
      const w = layout().overflow!;
      const p = proposalOf(w, kind);
      const plan = planProposal(w, p, proposalContextOf(get()));
      expect(plan.kind).toBe('config');
      if (plan.kind !== 'config') return;
      expect(plan.settings[0]).toMatch(/^tema-cajas › dinero › /);
      expect(proposalQuestion(plan, w, DEFAULT_LABELS, 'en')).toMatch(/^Change the design: tema-cajas › dinero › /);
      const said = runProposal(plan, w, DEFAULT_LABELS, history.dispatch);
      expect(said).toMatch(/^Done: /);
      for (const leaf of plan.leaves) expect(getAtPointer(get().config, leaf.pointer)).toEqual(leaf.value);
      // The other templates and the frame's other fields are as they were.
      expect(get().config.pageTemplates![1]).toBe(before.pageTemplates![1]);
      const after = layout();
      expect(after.overflow).toBeUndefined();
      if (kind === 'continueNextPage') {
        const dinero = after.doc.pages.find((pg) => pg.composed)!.composed!.frames.find((f) => f.name === 'dinero')!;
        expect(dinero.continuesTo).toBe('cp0:dinero~1');
      }
      // One step: undone, the book's design is the one it was.
      expect(history.peek()).toMatchObject({ kind: 'config' });
      history.undo();
      expect(get().config).toEqual(before);
      expect(history.canUndo()).toBe(false);
      expect(layout().overflow).toBeDefined();
    });
  }

  it('useTemplate: the fence’s template attribute in the chapter’s text, one undo step', () => {
    const { layout, history, get } = setUp();
    const text = get().chapters[1]!.markdown;
    const w = layout().overflow!;
    const plan = planProposal(w, proposalOf(w, 'useTemplate'), proposalContextOf(get()));
    expect(plan).toMatchObject({ kind: 'text', chapterId: 'p8', template: 'tema-amplio' });
    if (plan.kind !== 'text') return;
    // The range the engine gave, in the chapter's own offsets.
    expect(text.slice(plan.changes[0]!.from, plan.changes[0]!.to)).toBe('tema-cajas');
    expect(proposalQuestion(plan, w, DEFAULT_LABELS)).toBe('Change the text: set this page with template "tema-amplio" instead of "tema-cajas"? Cmd/Ctrl+Z takes it back.');
    expect(applyProposalPlan(plan, history.dispatch)).toBe(true);
    expect(get().chapters[1]!.markdown).toBe(text.replace('template="tema-cajas"', 'template="tema-amplio"'));
    expect(layout().overflow).toBeUndefined();
    history.undo();
    expect(get().chapters[1]!.markdown).toBe(text);
  });

  it('shortenText: nothing changes; the box’s text is selected and the reader told how much to cut', () => {
    const { layout, history, get } = setUp();
    const w = layout().overflow!;
    const p = proposalOf(w, 'shortenText');
    const plan = planProposal(w, p, proposalContextOf(get()));
    expect(plan.kind).toBe('select');
    if (plan.kind !== 'select') return;
    const text = get().chapters[1]!.markdown;
    expect(text.slice(plan.from, plan.to)).toContain('Más dinero 0');
    expect(text.slice(plan.from, plan.to)).toContain('efectivo');
    const said = runProposal(plan, w, DEFAULT_LABELS, history.dispatch);
    expect(said).toBe(`The text of dinero is selected: cut about ${(p as { value: number }).value} characters.`);
    expect(get().pendingEditorFocus).toMatchObject({ chapterId: 'p8', anchor: plan.from, head: plan.to });
    expect(get().activePanel).toBe('markdown');
    expect(history.canUndo()).toBe(false);
  });

  it('refuses a proposal the book no longer matches', () => {
    const { layout, get } = setUp();
    const w = layout().overflow!;
    // The templates are gone: no config proposal applies.
    const noTemplates = { ...proposalContextOf(get()), config: { ...get().config, pageTemplates: [] } };
    expect(planProposal(w, proposalOf(w, 'allowShrink'), noTemplates).kind).toBe('stale');
    // The fence names another template by now.
    const ctx = proposalContextOf(get());
    const moved = { ...ctx, chapters: ctx.chapters.map((c) => (c.id === 'p8' ? { ...c, markdown: c.markdown.replace('template="tema-cajas"', 'template="otra"') } : c)) };
    expect(planProposal(w, proposalOf(w, 'useTemplate'), moved).kind).toBe('stale');
    // The text moved under the range: the fence is found again by its ordinal.
    const shifted = { ...ctx, chapters: ctx.chapters.map((c) => (c.id === 'p8' ? { ...c, markdown: `Una línea más.\n\n${c.markdown}` } : c)) };
    const again = planProposal(w, proposalOf(w, 'useTemplate'), shifted);
    expect(again.kind).toBe('text');
    if (again.kind === 'text') expect(shifted.chapters[1]!.markdown.slice(again.changes[0]!.from, again.changes[0]!.to)).toBe('tema-cajas');
  });
});

describe('JSON pointers into the configuration', () => {
  const config = {
    pageTemplates: [
      { id: 'tema', frames: [{ name: 'a' }, { name: 'dinero', fit: { minScale: 0.9 } }], variants: { verso: { frames: [{ name: 'dinero' }] } } },
    ],
  } as unknown as PostextConfig;

  it('reads, writes (making what is missing) and names a setting', () => {
    expect(pointerSteps('/a~1b/c~0d/0')).toEqual(['a/b', 'c~d', '0']);
    expect(getAtPointer(config, '/pageTemplates/0/frames/1/fit/minScale')).toBe(0.9);
    const next = setAtPointer(config, '/pageTemplates/0/frames/0/overflow/continueIn', 'next-page');
    expect(getAtPointer(next, '/pageTemplates/0/frames/0/overflow')).toEqual({ continueIn: 'next-page' });
    // Copied on the way, the rest shared.
    expect(next).not.toBe(config);
    expect(getAtPointer(next, '/pageTemplates/0/frames/1')).toBe(getAtPointer(config, '/pageTemplates/0/frames/1'));
    expect(getAtPointer(config, '/pageTemplates/0/frames/0/overflow')).toBeUndefined();
    expect(() => setAtPointer(config, '/pageTemplates/3/frames/0/x', 1)).toThrow();
    expect(pointerInWords(config, '/pageTemplates/0/frames/1/fit/minScale')).toBe('tema › dinero › fit.minScale');
    expect(pointerInWords(config, '/pageTemplates/0/variants/verso/frames/0/maxHeight')).toBe('tema › verso › dinero › maxHeight');
    expect(valueInWords(mm(74))).toBe('74 mm');
    expect(valueInWords(0.875, 'es')).toBe('0,875');
    expect(valueInWords('next-page')).toBe('"next-page"');
    expect(proposalLeaves({ kind: 'allowShrink', path: '/x/fit/minScale', value: 0.85, also: [{ path: '/x/fit/shrinkText', value: true }] }))
      .toEqual([{ pointer: '/x/fit/minScale', value: 0.85 }, { pointer: '/x/fit/shrinkText', value: true }]);
  });
});
