import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { history as cmHistory, historyField, isolateHistory, undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import { sandboxReducer, type SandboxAction, type SandboxState } from '../context/SandboxContext';
import { minimalChange } from '../book/textChanges';
import { applyViewerEdit, resetViewerEdits } from '../editor/viewerEdits';
import { state as baseState } from '../webmcp/tools/testHarness';
import { COALESCE_MS, createSandboxHistory, setActiveHistory, type SandboxHistory } from './sandboxHistory';

const pt = (value: number) => ({ value, unit: 'pt' as const });

/** The provider's wiring over the real reducer, with a clock the test
 *  moves. */
function setup(initial: Partial<SandboxState> = {}) {
  let current: SandboxState = { ...baseState(), ...initial };
  let clock = 1_000;
  const reduce = (action: SandboxAction) => { current = sandboxReducer(current, action); };
  const editorStates = new Map<string, unknown>();
  const history = createSandboxHistory({ dispatch: reduce, getState: () => current, editorStates: () => editorStates, now: () => clock });
  setActiveHistory(history);
  return {
    history,
    dispatch: history.dispatch,
    get: () => current,
    editorStates,
    tick: (ms: number) => { clock += ms; },
  };
}

/** A chapter's open editor, as MarkdownEditor wires it: its transactions
 *  reported, its text mirrored in the store, the store's text synced
 *  back as one step (as useCodeMirror's external value does). */
function openEditor(env: ReturnType<typeof setup>, chapterId: string) {
  const text = () => {
    const s = env.get();
    return s.activeChapterId === chapterId ? s.markdown : s.chapters.find((c) => c.id === chapterId)!.markdown;
  };
  let state = EditorState.create({ doc: text(), extensions: [cmHistory()] });
  let time = 10_000;
  const apply = (tr: Transaction) => {
    state = tr.state;
    env.history.editorUpdated(chapterId, state, [tr]);
    if (tr.docChanged) env.dispatch({ type: 'SET_MARKDOWN', payload: state.doc.toString() });
  };
  const editor = {
    getState: () => state,
    run: (dir: 'undo' | 'redo') => (dir === 'undo' ? cmUndo : cmRedo)({ state, dispatch: apply }),
  };
  env.history.attachEditor(chapterId, editor);
  return {
    /** Typing, `ms` after the last keystroke. */
    type(at: number, insert: string, ms = 2000) {
      time += ms;
      apply(state.update({ changes: { from: at, insert }, annotations: [Transaction.userEvent.of('input.type'), Transaction.time.of(time)] }));
    },
    /** The store's text taken in, as an edit made on the previews is. */
    sync() {
      const c = minimalChange(state.doc.toString(), text());
      if (c) apply(state.update({ changes: { from: c.from, to: c.to, insert: c.insert }, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.external')] }));
    },
    /** The editor's own undo (not through the history). */
    ownUndo: () => cmUndo({ state, dispatch: apply }),
    /** Unmounted (another chapter shown): its state is saved. */
    close() {
      env.editorStates.set(chapterId, state.toJSON({ history: historyField }));
      env.history.attachEditor(chapterId, null);
    },
    get text() { return state.doc.toString(); },
  };
}

const fontSize = (s: SandboxState) => s.config.bodyText?.fontSize?.value;
const typeFontSize = (env: ReturnType<typeof setup>, value: number) =>
  env.dispatch({ type: 'UPDATE_CONFIG', payload: { bodyText: { ...env.get().config.bodyText, fontSize: pt(value) } } });

afterEach(() => {
  setActiveHistory(null);
  resetViewerEdits();
});

describe('the configuration history', () => {
  it('makes one step of a setting typed or dragged on, and two of two gestures', () => {
    const env = setup();
    typeFontSize(env, 1);
    env.tick(200);
    typeFontSize(env, 12);
    env.tick(200);
    typeFontSize(env, 12.5);
    expect(env.history.peek()).toEqual({ kind: 'config', paths: ['bodyText.fontSize'], keys: ['bodyText'] });
    env.tick(COALESCE_MS + 1);
    typeFontSize(env, 14);
    env.history.undo();
    expect(fontSize(env.get())).toBe(12.5);
    env.history.undo();
    expect(env.get().config.bodyText).toBeUndefined();
    expect(env.history.canUndo()).toBe(false);
    env.history.redo();
    env.history.redo();
    expect(fontSize(env.get())).toBe(14);
  });

  it('keeps a write marked merge: false (a frame dropped, a tool call) apart, and forgets a write that came back', () => {
    const env = setup();
    env.dispatch({ type: 'UPDATE_CONFIG', payload: { bodyText: { fontSize: pt(10) } }, history: { merge: false } });
    env.tick(10);
    env.dispatch({ type: 'UPDATE_CONFIG', payload: { bodyText: { fontSize: pt(11) } }, history: { merge: false } });
    env.history.undo();
    expect(fontSize(env.get())).toBe(10);
    env.history.redo();
    // A slider dragged and brought back is no change.
    env.tick(COALESCE_MS * 2);
    typeFontSize(env, 12);
    env.tick(100);
    typeFontSize(env, 11);
    env.history.undo();
    expect(fontSize(env.get())).toBe(10);
  });

  it('builds on the writes dispatched before React renders them', () => {
    // The state on screen stays behind until the batch is rendered.
    let shown: SandboxState = baseState();
    let next = shown;
    const history = createSandboxHistory({ dispatch: (a) => { next = sandboxReducer(next, a); }, getState: () => shown, editorStates: () => new Map() });
    history.dispatch({ type: 'UPDATE_CONFIG', payload: { bodyText: { fontSize: pt(10) } }, history: { merge: false } });
    history.dispatch({ type: 'UPDATE_CONFIG', payload: { lineNumbers: { enabled: true } } as never, history: { merge: false } });
    shown = next;
    history.undo();
    shown = next;
    expect((shown.config as Record<string, unknown>).lineNumbers).toBeUndefined();
    expect(fontSize(shown)).toBe(10);
    history.undo();
    shown = next;
    expect(shown.config.bodyText).toBeUndefined();
  });

  it('leaves out writes marked history: false, a book being opened and the first load', () => {
    const env = setup();
    env.dispatch({ type: 'UPDATE_CONFIG', payload: { bodyText: { fontSize: pt(10) } }, history: false });
    expect(env.history.canUndo()).toBe(false);
    typeFontSize(env, 11);
    expect(env.history.canUndo()).toBe(true);
    // Another preset opened: its configuration is no step, and the history starts again.
    env.dispatch({ type: 'SET_PRESET', payload: { id: 'novel' } });
    env.dispatch({ type: 'SET_CONFIG', payload: { bodyText: { fontSize: pt(9) } } });
    expect(env.history.canUndo()).toBe(false);
    const boot = setup({ storeReady: false });
    boot.dispatch({ type: 'SET_CONFIG', payload: { bodyText: { fontSize: pt(9) } } });
    expect(boot.history.canUndo()).toBe(false);
  });

  it('keeps the history over a reset of the same book, which it can take back', () => {
    const env = setup();
    typeFontSize(env, 11);
    env.tick(COALESCE_MS * 2);
    env.dispatch({ type: 'SET_PRESET', payload: { id: env.get().activePresetId } });
    env.dispatch({ type: 'SET_CONFIG', payload: {} });
    expect(env.get().config.bodyText).toBeUndefined();
    env.history.undo();
    expect(fontSize(env.get())).toBe(11);
  });
});

describe('one history for the text and the configuration', () => {
  it('takes back the latest change whichever side it was on', () => {
    const env = setup();
    const editor = openEditor(env, 'a');
    editor.type(0, 'One. ');
    env.tick(10);
    typeFontSize(env, 11);
    env.tick(10);
    editor.type(0, 'Two. ');
    expect(env.get().markdown.startsWith('Two. One. # Opening')).toBe(true);
    expect(env.history.undo()).toEqual({ kind: 'text', chapterId: 'a' });
    expect(env.get().markdown.startsWith('One. # Opening')).toBe(true);
    expect(fontSize(env.get())).toBe(11);
    expect(env.history.undo()).toMatchObject({ kind: 'config' });
    expect(env.get().config.bodyText).toBeUndefined();
    expect(env.get().markdown.startsWith('One. ')).toBe(true);
    env.history.undo();
    expect(env.get().markdown.startsWith('# Opening')).toBe(true);
    expect(env.history.canUndo()).toBe(false);
    env.history.redo();
    env.history.redo();
    expect(fontSize(env.get())).toBe(11);
    expect(env.get().markdown.startsWith('One. # Opening')).toBe(true);
    // A new change, on either side, ends what can be redone.
    typeFontSize(env, 12);
    expect(env.history.canRedo()).toBe(false);
  });

  it("follows the editor's own undo, and drops the redo list on typing", () => {
    const env = setup();
    const editor = openEditor(env, 'a');
    typeFontSize(env, 11);
    editor.type(0, 'One. ');
    editor.ownUndo();
    expect(env.history.peek(true)).toEqual({ kind: 'text', chapterId: 'a' });
    expect(env.history.peek()).toMatchObject({ kind: 'config' });
    editor.type(0, 'Again. ');
    expect(env.history.canRedo()).toBe(false);
    env.history.undo();
    expect(editor.text.startsWith('# Opening')).toBe(true);
  });

  it('adds an edit made on the previews to the open editor\'s history, and to the saved one when it is closed', () => {
    const env = setup();
    const editor = openEditor(env, 'a');
    const before = env.get().markdown;
    // The editor is open: it takes the edit as a step of its own.
    applyViewerEdit(env.dispatch, 'a', [{ from: 0, to: 9, insert: '# Overture', expect: '# Opening' }], before.length);
    editor.sync();
    expect(editor.text.startsWith('# Overture')).toBe(true);
    // Closed: the edit goes into the chapter's saved state.
    const second = env.get().chapters[1]!.markdown;
    applyViewerEdit(env.dispatch, 'b', [{ from: 0, to: 8, insert: '# Seconde', expect: '# Second' }], second.length);
    expect(env.editorStates.has('b')).toBe(true);
    expect(env.get().chapters[1]!.markdown.startsWith('# Seconde')).toBe(true);
    // Undo of a step of another chapter shows that chapter (follow).
    expect(env.history.undo({ follow: true })).toEqual({ kind: 'text', chapterId: 'b' });
    expect(env.get().chapters[1]!.markdown).toBe(second);
    expect(env.get().activeChapterId).toBe('b');
    // The editor of the chapter left unmounts, as the panel's does.
    editor.close();
    expect(env.history.undo({ follow: true })).toEqual({ kind: 'text', chapterId: 'a' });
    expect(env.get().activeChapterId).toBe('a');
    expect(env.get().markdown).toBe(before);
  });

  it('takes a step back over text changed by other means, and forgets the steps of a chapter removed', () => {
    const env = setup();
    const second = env.get().chapters[1]!.markdown;
    applyViewerEdit(env.dispatch, 'b', [{ from: 0, to: 0, insert: 'Edited. ', expect: '' }], second.length);
    // The chapter changes by other means (an import, a reference renamed).
    env.dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: 'b', changes: [{ from: env.get().chapters[1]!.markdown.length, to: env.get().chapters[1]!.markdown.length, insert: 'Tail.' }] } });
    // That one is a step too (it came as an edit); take it back, then ours.
    env.history.undo();
    env.history.undo();
    expect(env.get().chapters[1]!.markdown).toBe(second);
    env.history.redo();
    env.dispatch({ type: 'REMOVE_CHAPTER', payload: 'b' });
    env.history.pruneChapters(new Set(env.get().chapters.map((c) => c.id)));
    expect(env.history.canUndo()).toBe(false);
  });

  it('runs only a step of the kind asked for', () => {
    const env = setup();
    applyViewerEdit(env.dispatch, 'a', [{ from: 0, to: 0, insert: 'X', expect: '' }], env.get().markdown.length);
    typeFontSize(env, 11);
    expect(env.history.undo({ kind: 'text' })).toBeNull();
    expect(fontSize(env.get())).toBe(11);
    expect(env.history.undo({ kind: 'config' })).toMatchObject({ kind: 'config' });
    expect(env.history.undo({ kind: 'text' })).toEqual({ kind: 'text', chapterId: 'a' });
  });

  it('is emptied when another book opens', () => {
    const env = setup();
    applyViewerEdit(env.dispatch, 'a', [{ from: 0, to: 0, insert: 'X', expect: '' }], env.get().markdown.length);
    typeFontSize(env, 11);
    env.dispatch({ type: 'SET_BOOK', payload: { chapters: [{ id: 'z', title: 'Z', markdown: '# Z\n', createdAt: 1, updatedAt: 1 }], activeChapterId: 'z' } });
    expect(env.history.canUndo()).toBe(false);
    expect(env.history.canRedo()).toBe(false);
  });

  it('tells its listeners when the lists change', () => {
    const env: { history: SandboxHistory } & ReturnType<typeof setup> = setup();
    let calls = 0;
    const off = env.history.subscribe(() => { calls++; });
    const v = env.history.getVersion();
    typeFontSize(env, 11);
    env.history.undo();
    off();
    expect(calls).toBe(2);
    expect(env.history.getVersion()).toBeGreaterThan(v);
  });
});
