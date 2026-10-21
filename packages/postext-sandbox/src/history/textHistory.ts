/**
 * A chapter's text history while its editor is closed (#899).
 *
 * Every chapter keeps one CodeMirror history: the open editor's, or, once
 * it unmounts, the state it leaves behind as JSON (`editorStatesRef`). The
 * edits made on the previews while the editor is closed, and their undo,
 * run on that saved state here, without a view, so the editor finds them
 * in its history when it opens again.
 */

import { EditorState, Transaction } from '@codemirror/state';
import { history, historyField, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { minimalChange, type TextChange } from '../book/textChanges.js';

const EXTENSIONS = [history()];

/** The chapter's saved state (or a fresh one), with its text brought to
 *  `text`. A change made by other means (a chapter imported, a reference
 *  renamed) is no step of the history: the history is mapped over it, as
 *  an open editor maps it. */
export function savedState(json: unknown, text: string): EditorState {
  let state: EditorState;
  try {
    state = json
      ? EditorState.fromJSON(json, { extensions: EXTENSIONS }, { history: historyField })
      : EditorState.create({ doc: text, extensions: EXTENSIONS });
  } catch {
    state = EditorState.create({ doc: text, extensions: EXTENSIONS });
  }
  const current = state.doc.toString();
  if (current !== text) {
    const c = minimalChange(current, text)!;
    state = state.update({ changes: { from: c.from, to: c.to, insert: c.insert }, annotations: Transaction.addToHistory.of(false) }).state;
  }
  return state;
}

/** What the editor stores for a chapter. */
export function stateJSON(state: EditorState): unknown {
  return state.toJSON({ history: historyField });
}

export function depthsOf(state: EditorState): { undo: number; redo: number } {
  return { undo: undoDepth(state), redo: redoDepth(state) };
}

/** `changes` (offsets in the state's text) as one step of the history. */
export function editSaved(state: EditorState, changes: readonly TextChange[]): EditorState {
  return state.update({
    changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.viewer')],
  }).state;
}

/** The last step of the saved history taken back (or put back): the new
 *  state and the changes it made to the text, for the store. Null when
 *  the history has no such step. */
export function runSaved(state: EditorState, dir: 'undo' | 'redo'): { state: EditorState; changes: TextChange[] } | null {
  let tr: Transaction | null = null;
  const ran = (dir === 'undo' ? undo : redo)({ state, dispatch: (t) => { tr = t; } });
  if (!ran || !tr) return null;
  const done = tr as Transaction;
  const changes: TextChange[] = [];
  done.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString(), expect: state.doc.sliceString(fromA, toA) });
  });
  return { state: done.state, changes };
}
