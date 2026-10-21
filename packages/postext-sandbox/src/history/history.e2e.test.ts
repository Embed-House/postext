// One history for the text and the design (#899) on a real book: P4's
// p. 8 stand-in, laid out by the engine. A frame dragged in Design mode
// (the write the frame editor makes on a drop), a word typed on the page,
// a setting typed digit by digit in a panel: undone three times, the book
// is the one it was, step by step, and the pages show it.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { PostextConfig, Resource, VDTDocument, VDTFrame } from 'postext';
import { sandboxReducer, type SandboxAction, type SandboxState } from '../context/SandboxContext.js';
import { applyViewerEdit, resetViewerEdits } from '../editor/viewerEdits.js';
import { changeTemplateFrame } from '../templates/pageEdits.js';
import { state as baseState } from '../webmcp/tools/testHarness.js';
import { COALESCE_MS, createSandboxHistory, setActiveHistory } from './sandboxHistory.js';

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

describe('undo across the text and the design on a composed page', () => {
  it('takes back a frame drag, a word typed and a setting, in that order backwards', () => {
    const fixture = page8Fixture('es');
    const chapter = { id: 'p8', title: 'Página 8', markdown: fixture.markdown, createdAt: 1, updatedAt: 1 };
    let current: SandboxState = { ...baseState(), chapters: [chapter], activeChapterId: 'p8', markdown: fixture.markdown, config: fixture.config, resources: fixture.resources };
    let clock = 0;
    const history = createSandboxHistory({
      dispatch: (a: SandboxAction) => { current = sandboxReducer(current, a); },
      getState: () => current,
      editorStates: (() => { const m = new Map<string, unknown>(); return () => m; })(),
      now: () => clock,
    });
    setActiveHistory(history);
    const layout = (): VDTDocument => buildDocument({ markdown: current.markdown, resources: current.resources }, current.config, createMeasurementCache());
    const frameOf = (doc: VDTDocument, name: string): VDTFrame => doc.pages.find((p) => p.composed)!.composed!.frames.find((f) => f.name === name)!;

    const first = layout();
    const page = first.pages.find((p) => p.composed)!;
    const dinero = frameOf(first, 'dinero');
    const start = { config: current.config, markdown: current.markdown, rect: dinero.rect };

    // 1. Design mode: the frame dragged 20 mm to the right and dropped
    //    (frameEditor's write on a drop).
    const frameConfig = current.config.pageTemplates![0]!.frames!.find((f) => f.name === 'dinero')!;
    const moved = changeTemplateFrame(current.config.pageTemplates!, page.composed!, dinero, {
      placement: { ...frameConfig.placement!, offset: { ...frameConfig.placement?.offset, x: mm(20) } },
    });
    history.dispatch({ type: 'UPDATE_CONFIG', payload: { pageTemplates: moved }, history: { merge: false } });
    const afterDrag = { config: current.config, rect: frameOf(layout(), 'dinero').rect };
    expect(afterDrag.rect.x).toBeGreaterThan(start.rect.x + 50);

    // 2. Content mode: a word typed on the page (a frame field's edit).
    clock += 3000;
    const at = current.markdown.indexOf('dinero');
    expect(at).toBeGreaterThan(0);
    applyViewerEdit(history.dispatch, 'p8', [{ from: at, to: at, insert: 'nuevo ', expect: '' }], current.markdown.length);
    const afterTyping = current.markdown;
    expect(afterTyping).toContain('nuevo dinero');

    // 3. A size typed digit by digit in the Design panel: one step.
    clock += 3000;
    for (const value of [1, 11, 11.5]) {
      history.dispatch({ type: 'UPDATE_CONFIG', payload: { bodyText: { ...current.config.bodyText, fontSize: { value, unit: 'pt' } } } });
      clock += COALESCE_MS / 4;
    }
    expect(current.config.bodyText?.fontSize).toEqual({ value: 11.5, unit: 'pt' });

    // Undo three times: the setting, the word, the frame.
    expect(history.undo()).toMatchObject({ kind: 'config', paths: ['bodyText.fontSize'] });
    expect(current.config).toEqual(afterDrag.config);
    expect(current.markdown).toBe(afterTyping);
    expect(history.undo()).toEqual({ kind: 'text', chapterId: 'p8' });
    expect(current.markdown).toBe(start.markdown);
    expect(current.config).toEqual(afterDrag.config);
    expect(history.undo()).toMatchObject({ kind: 'config', paths: ['pageTemplates[id=tema-cajas].frames[2].placement.offset.x'] });
    expect(current.config).toEqual(start.config);
    expect(history.canUndo()).toBe(false);
    expect(frameOf(layout(), 'dinero').rect).toEqual(start.rect);

    // And back again.
    history.redo();
    history.redo();
    history.redo();
    expect(current.markdown).toBe(afterTyping);
    expect(current.config.bodyText?.fontSize).toEqual({ value: 11.5, unit: 'pt' });
    // The frame is where it was dropped (the larger text above moves it down).
    expect(frameOf(layout(), 'dinero').rect.x).toBe(afterDrag.rect.x);
  });
});
