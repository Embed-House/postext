// A chapter's text changed by a tool, and the change taken back. The edit
// goes the way an edit made on the previews goes (editor/viewerEdits.ts):
// the chapter's open editor applies it as one step of its history, and it
// joins the edits Cmd/Ctrl+Z takes back over the previews — the same list
// a tool undoes from.

import { applyTextChanges, changesApply, invertTextChanges, minimalChange, type TextChange } from '../book/textChanges';
import type { SandboxAction, SandboxState } from '../context/SandboxContext';
import { applyViewerEdit, dropViewerEdit, peekViewerEdit, redoViewerEdit, undoViewerEdit } from '../editor/viewerEdits';
import type { SandboxToolHost } from './host';
import { ToolError } from './modelContext';

/** How long an edit may take to reach the state: a render away, which a
 *  long book can make slow. */
const LANDING_MS = 5000;
/** How long the chapter's open editor is given to undo an edit through
 *  its own history before the changes are sent themselves. */
const EDITOR_UNDO_MS = 600;

/** A chapter's text as it stands (the one on screen is mirrored in
 *  `markdown`), or null when the book has no such chapter. */
export function chapterText(state: SandboxState, chapterId: string): string | null {
  if (chapterId === state.activeChapterId) return state.markdown;
  return state.chapters.find((c) => c.id === chapterId)?.markdown ?? null;
}

/** Resolves once `done` holds for the state, or after `timeoutMs` with
 *  whether it does by then. */
export function stateReaches(host: SandboxToolHost, done: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (done()) {
      resolve(true);
      return;
    }
    const finish = (reached: boolean) => {
      unsubscribe();
      clearTimeout(timer);
      resolve(reached);
    };
    const unsubscribe = host.store.subscribe(() => {
      if (done()) finish(true);
    });
    const timer = setTimeout(() => finish(done()), timeoutMs);
  });
}

function lengthAfter(baseLength: number, changes: readonly TextChange[]): number {
  return changes.reduce((n, c) => n + c.insert.length - (c.to - c.from), baseLength);
}

/** Turn a chapter's text from `before` (what the state holds) into
 *  `after`, as one edit that can be taken back. False when they are the
 *  same text. */
export async function editChapter(host: SandboxToolHost, chapterId: string, before: string, after: string): Promise<boolean> {
  const change = minimalChange(before, after);
  if (!change) return false;
  const dispatch = (action: SandboxAction) => host.store.dispatch(action);
  applyViewerEdit(dispatch, chapterId, [change], before.length);
  const landed = await stateReaches(host, () => chapterText(host.store.getSnapshot(), chapterId) === after, LANDING_MS);
  if (!landed) {
    // Refused by the state: the chapter was no longer the text the edit
    // was worked out on.
    if (peekViewerEdit()?.changes[0] === change) dropViewerEdit();
    throw new ToolError('The chapter changed while the edit was on its way, so nothing was changed. Read the chapter again and edit its current text.');
  }
  return true;
}

export interface TakenBack {
  chapterId: string;
  /** The chapter's text afterwards. */
  text: string;
  /** Whether there is an edit to take back, and one to put back, after
   *  this one. */
  canUndo: boolean;
  canRedo: boolean;
}

/** Take back the last edit ({@link editChapter}, or one made on the
 *  previews), or with `redo` put back the last one taken back. `only`
 *  refuses an edit to another chapter than that one. An edit whose
 *  chapter is no longer the text it left is forgotten and refused: its
 *  changes would land on other text. */
export async function undoChapterEdit(host: SandboxToolHost, redo: boolean, only?: string): Promise<TakenBack> {
  const edit = peekViewerEdit(redo);
  if (!edit) {
    throw new ToolError(redo
      ? 'There is no edit to put back: nothing was taken back since the last edit.'
      : 'There is no edit to take back. sandbox_undo_text takes back the text edits of sandbox_write_text, sandbox_edit_text and sandbox_import_word (into a chapter) and the edits made on the previews, made since the page was opened; what is typed in the Manuscript editor is undone there.');
  }
  const state = host.store.getSnapshot();
  const text = chapterText(state, edit.chapterId);
  const again = `Call again for the edit ${redo ? 'taken back' : 'made'} before it.`;
  if (text === null) {
    dropViewerEdit(redo);
    throw new ToolError(`The last edit was to a chapter that is no longer in the book, so it cannot be ${redo ? 'put' : 'taken'} back; it was forgotten. ${again}`);
  }
  const position = state.chapters.findIndex((c) => c.id === edit.chapterId) + 1;
  if (only !== undefined && only !== edit.chapterId) {
    throw new ToolError(`The last edit ${redo ? 'taken back ' : ''}was to chapter ${position} (${state.chapters[position - 1]!.title}), not to the chapter named. Edits come back in the order they were made, whatever the chapter: name that chapter, or none.`);
  }
  const changes = redo ? edit.changes : invertTextChanges(edit.changes);
  const baseLength = redo ? edit.baseLength : lengthAfter(edit.baseLength, edit.changes);
  if (text.length !== baseLength || !changesApply(text, changes)) {
    dropViewerEdit(redo);
    throw new ToolError(`Chapter ${position} was changed after that edit (in the editor, or by another tool), so it cannot be ${redo ? 'put' : 'taken'} back without touching other text; it was forgotten. Read the chapter and edit it instead. ${again}`);
  }
  const expected = applyTextChanges(text, changes);
  const current = (): string | null => chapterText(host.store.getSnapshot(), edit.chapterId);
  if (redo) redoViewerEdit();
  else undoViewerEdit();
  if (!(await stateReaches(host, () => current() !== text, EDITOR_UNDO_MS))) {
    // The chapter's editor is open and its history holds no step for this
    // edit (it was opened after it): the changes themselves, then. Sent a
    // second time after a slow render, they are refused: each carries the
    // text it expects to replace.
    host.store.dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: edit.chapterId, changes, baseLength } });
    await stateReaches(host, () => current() !== text, LANDING_MS);
  }
  const now = current();
  if (now !== expected) {
    throw new ToolError(`The edit to chapter ${position} could not be ${redo ? 'put' : 'taken'} back: the Manuscript editor is open on that chapter and its own last step was another change. Read the chapter to see how it stands.`);
  }
  return { chapterId: edit.chapterId, text: now, canUndo: peekViewerEdit() !== null, canRedo: peekViewerEdit(true) !== null };
}
