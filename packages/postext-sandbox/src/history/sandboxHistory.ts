/**
 * One undo/redo history for the text and the configuration (#899).
 *
 * The Sandbox changes a book two ways: its text, held per chapter in a
 * CodeMirror history (the open editor's, or the state it left behind,
 * see ./textHistory), and its configuration, written only through
 * `SET_CONFIG` / `UPDATE_CONFIG`. This coordinator sits on the store's
 * dispatch and keeps one timeline of both:
 *
 * - a **config step** is recorded for every write, as a patch of the
 *   leaves it changed (./configPatch). Writes of the same leaves (or of
 *   leaves under them) within {@link COALESCE_MS} of each other are one step (a slider dragged, a
 *   number typed digit by digit); a write marked `merge: false` (a frame
 *   dropped, a tool call) is a step of its own.
 * - a **text step** stands for one event of a chapter's CodeMirror history:
 *   the open editor reports its transactions ({@link SandboxHistory.editorUpdated}),
 *   and an edit made on the previews while the chapter's editor is closed
 *   is added to the chapter's saved state here.
 *
 * - a **resource step** is recorded for an `UPSERT_RESOURCE` that asks for
 *   it (`history`, #866): the marks of a picture (its label anchors, safe
 *   area, lettering zones) saved from the Resources panel or dragged on a
 *   page. Changes of the same resource within {@link COALESCE_MS} are one
 *   step unless one says `merge: false`.
 *
 * Undo takes back the latest step whichever kind it is: a config step by
 * putting back the leaves it changed on the configuration as it is now, a
 * text step through the chapter's own history (its editor's when open,
 * the saved state's otherwise). A text step of another chapter switches to
 * that chapter (`follow`). Any new change empties the redo list. Opening
 * another book (`SET_BOOK`, another preset or project) empties both.
 */

import type { Dispatch } from 'react';
import type { EditorState, Transaction } from '@codemirror/state';
import { Transaction as Tr } from '@codemirror/state';
import type { PostextConfig, Resource } from 'postext';
import type { SandboxAction, SandboxState } from '../context/SandboxContext.js';
import { applyTextChanges, changesApply } from '../book/textChanges.js';
import { applyPatch, carryPatch, diffConfig, patchCovers, patchIsEmpty, patchSettingPaths, patchTopKeys, type ConfigPatch } from './configPatch.js';
import { depthsOf, editSaved, runSaved, savedState, stateJSON } from './textHistory.js';

/** Writes of the same settings closer than this are one step. */
export const COALESCE_MS = 1000;
/** Steps kept; the oldest go first. */
export const MAX_STEPS = 500;

/** How a configuration write enters the history: `false` not at all (a
 *  book being opened, a side effect of another change); `merge: false`
 *  as a step of its own, never joined with the writes around it. */
export type ConfigHistoryMeta = false | { merge?: boolean };

type TextStep = { kind: 'text'; chapterId: string; at: number };
type ConfigStep = { kind: 'config'; patch: ConfigPatch; at: number; open: boolean; before: PostextConfig };
type ResourceStep = { kind: 'resource'; resourceId: string; before: Resource; after: Resource; at: number; open: boolean };
type Step = TextStep | ConfigStep | ResourceStep;

/** A step as the toolbar, the announcements and the tools describe it. */
export type HistoryStepInfo =
  | { kind: 'text'; chapterId: string }
  | { kind: 'config'; paths: string[]; keys: string[] }
  | { kind: 'resource'; resourceId: string };

/** The open editor of a chapter, as the history drives it. `run` undoes
 *  or redoes one step of its history, read only or not. */
export interface HistoryEditor {
  getState(): EditorState;
  run(dir: 'undo' | 'redo'): boolean;
}

export interface SandboxHistoryDeps {
  /** The reducer's own dispatch. */
  dispatch: Dispatch<SandboxAction>;
  getState: () => SandboxState;
  /** The saved editor state of each chapter (`editorStatesRef`). */
  editorStates: () => Map<string, unknown>;
  now?: () => number;
}

export interface HistoryRunOptions {
  /** Show the chapter a text step belongs to (the keys and the toolbar
   *  do; the tools leave the chapter on screen alone). */
  follow?: boolean;
  /** Only a step of this kind: when the latest is of the other kind,
   *  nothing is run (and null is answered). */
  kind?: 'text' | 'config' | 'resource';
}

export interface SandboxHistory {
  /** The store's dispatch: every action passes here first. */
  dispatch: Dispatch<SandboxAction>;
  undo(options?: HistoryRunOptions): HistoryStepInfo | null;
  redo(options?: HistoryRunOptions): HistoryStepInfo | null;
  /** The step undo (with `redo`, redo) would take, without taking it. */
  peek(redo?: boolean): HistoryStepInfo | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Changes whenever the lists do (for `useSyncExternalStore`). */
  getVersion(): number;
  subscribe(listener: () => void): () => void;
  attachEditor(chapterId: string, editor: HistoryEditor | null): void;
  /** The open editor of `chapterId` ran these transactions. */
  editorUpdated(chapterId: string, state: EditorState, transactions: readonly Transaction[]): void;
  /** Forget the steps of chapters no longer in the book. */
  pruneChapters(live: ReadonlySet<string>): void;
  /** The next write starts a step of its own (a gesture ended). */
  seal(): void;
  clear(): void;
}

function chapterText(state: SandboxState, chapterId: string): string | null {
  if (chapterId === state.activeChapterId) return state.markdown;
  return state.chapters.find((c) => c.id === chapterId)?.markdown ?? null;
}

function configMeta(action: SandboxAction): ConfigHistoryMeta | undefined {
  return action.type === 'SET_CONFIG' || action.type === 'UPDATE_CONFIG' ? action.history : undefined;
}

export function createSandboxHistory(deps: SandboxHistoryDeps): SandboxHistory {
  const now = deps.now ?? (() => Date.now());
  const undoList: Step[] = [];
  const redoList: Step[] = [];
  const editors = new Map<string, HistoryEditor>();
  const depths = new Map<string, { undo: number; redo: number }>();
  const listeners = new Set<() => void>();
  let version = 0;
  /** The chapter whose editor the history itself is driving. */
  let applying: string | null = null;
  /** A book is being swapped in: writes in the same batch are not steps. */
  let switching = false;
  // Writes dispatched before React renders them: the next write in the
  // same batch builds on them, not on the state still on screen.
  let eagerConfigBase: PostextConfig | null = null;
  let eagerConfig: PostextConfig | null = null;
  const eagerText = new Map<string, { base: string; next: string }>();

  const notify = () => {
    version++;
    for (const l of [...listeners]) l();
  };

  const currentConfig = (): PostextConfig => {
    const c = deps.getState().config;
    return eagerConfig !== null && c === eagerConfigBase ? eagerConfig : c;
  };
  const setEagerConfig = (next: PostextConfig) => {
    eagerConfigBase = deps.getState().config;
    eagerConfig = next;
  };
  const currentText = (chapterId: string): string | null => {
    const stored = chapterText(deps.getState(), chapterId);
    if (stored === null) return null;
    const eager = eagerText.get(chapterId);
    return eager && eager.base === stored ? eager.next : stored;
  };
  const setEagerText = (chapterId: string, next: string) => {
    const stored = chapterText(deps.getState(), chapterId);
    if (stored !== null) eagerText.set(chapterId, { base: stored, next });
  };

  const sealTop = () => {
    const top = undoList[undoList.length - 1];
    if (top?.kind === 'config' || top?.kind === 'resource') top.open = false;
  };
  const push = (step: Step) => {
    sealTop();
    undoList.push(step);
    if (undoList.length > MAX_STEPS) undoList.splice(0, undoList.length - MAX_STEPS);
    redoList.length = 0;
  };

  const info = (step: Step): HistoryStepInfo => step.kind === 'text'
    ? { kind: 'text', chapterId: step.chapterId }
    : step.kind === 'resource'
      ? { kind: 'resource', resourceId: step.resourceId }
      : { kind: 'config', paths: patchSettingPaths(step.before, step.patch), keys: patchTopKeys(step.patch) };

  // --- configuration -----------------------------------------------------

  const recordConfig = (action: Extract<SandboxAction, { type: 'SET_CONFIG' | 'UPDATE_CONFIG' }>) => {
    const base = currentConfig();
    const next = action.type === 'SET_CONFIG' ? action.payload : { ...base, ...action.payload };
    setEagerConfig(next);
    const meta = configMeta(action);
    const s = deps.getState();
    if (meta === false || switching || !s.storeReady || s.booting) return;
    const patch = diffConfig(base, next, action.type === 'UPDATE_CONFIG' ? Object.keys(action.payload) : undefined);
    if (patch.length === 0) return;
    const at = now();
    const merge = meta?.merge !== false;
    const top = undoList[undoList.length - 1];
    if (merge && top?.kind === 'config' && top.open && at - top.at <= COALESCE_MS && patchCovers(top.patch, patch)) {
      top.patch = carryPatch(top.patch, next);
      top.at = at;
      if (patchIsEmpty(top.patch)) undoList.pop();
      redoList.length = 0;
    } else {
      push({ kind: 'config', patch, at, open: merge, before: base });
    }
    notify();
  };

  const runConfig = (step: ConfigStep, dir: 'undo' | 'redo') => {
    const next = applyPatch(currentConfig(), step.patch, dir === 'undo' ? 'before' : 'after');
    setEagerConfig(next);
    deps.dispatch({ type: 'SET_CONFIG', payload: next, history: false });
  };

  // --- resources (#866) --------------------------------------------------

  // Resource writes dispatched before React renders them, as for the
  // configuration: the next write of the batch builds on them.
  let eagerResourcesBase: readonly Resource[] | null = null;
  const eagerResources = new Map<string, Resource>();
  const currentResource = (id: string): Resource | undefined => {
    const list = deps.getState().resources;
    if (list !== eagerResourcesBase) {
      eagerResources.clear();
      eagerResourcesBase = list;
    }
    return eagerResources.get(id) ?? list.find((r) => r.id === id);
  };
  const setEagerResource = (r: Resource) => {
    currentResource(r.id);
    eagerResources.set(r.id, r);
  };

  const recordResource = (action: Extract<SandboxAction, { type: 'UPSERT_RESOURCE' }>) => {
    const before = currentResource(action.payload.id);
    setEagerResource(action.payload);
    const meta = action.history;
    const s = deps.getState();
    // Only a change of a resource that is there, asked for as a step.
    if (!meta || !before || switching || !s.storeReady || s.booting) return;
    if (sameResource(before, action.payload)) return;
    const at = now();
    const top = undoList[undoList.length - 1];
    if (meta.merge !== false && top?.kind === 'resource' && top.open && top.resourceId === action.payload.id && at - top.at <= COALESCE_MS) {
      top.after = action.payload;
      top.at = at;
      if (sameResource(top.before, top.after)) undoList.pop();
      redoList.length = 0;
    } else {
      push({ kind: 'resource', resourceId: action.payload.id, before, after: action.payload, at, open: meta.merge !== false });
    }
    notify();
  };

  /** Put a resource back as it was before (or after) a step; false when it
   *  is no longer in the book. */
  const runResource = (step: ResourceStep, dir: 'undo' | 'redo'): boolean => {
    if (!currentResource(step.resourceId)) return false;
    const next = { ...(dir === 'undo' ? step.before : step.after), updatedAt: now() };
    setEagerResource(next);
    deps.dispatch({ type: 'UPSERT_RESOURCE', payload: next });
    return true;
  };

  // --- text --------------------------------------------------------------

  /** Steps of `chapterId` moved from one list to the other (its editor
   *  undid or redid by itself), latest first. */
  const moveText = (chapterId: string, from: Step[], to: Step[], count: number) => {
    for (let n = 0; n < count; n++) {
      let i = from.length - 1;
      while (i >= 0 && !(from[i]!.kind === 'text' && (from[i] as TextStep).chapterId === chapterId)) i--;
      if (i < 0) return;
      to.push(from.splice(i, 1)[0]!);
    }
  };
  /** The oldest steps of `chapterId` dropped (its history let them go). */
  const dropOldestText = (chapterId: string, count: number) => {
    for (let n = 0; n < count; n++) {
      const i = undoList.findIndex((s) => s.kind === 'text' && s.chapterId === chapterId);
      if (i < 0) return;
      undoList.splice(i, 1);
    }
  };
  /** The history of `chapterId` went from `was` to `is` depths through a
   *  change that is a step (`added`), or by undoing or redoing itself. */
  const noteDepths = (chapterId: string, was: { undo: number; redo: number }, is: { undo: number; redo: number }, how: 'added' | 'undo' | 'redo') => {
    depths.set(chapterId, is);
    if (how === 'added') {
      if (is.undo !== was.undo) {
        push({ kind: 'text', chapterId, at: now() });
        // Past its depth the history forgets its oldest events.
        if (is.undo < was.undo) dropOldestText(chapterId, was.undo + 1 - is.undo);
      } else {
        // Joined the last step (typing on): still a new change.
        sealTop();
        redoList.length = 0;
      }
    } else if (how === 'undo') {
      moveText(chapterId, undoList, redoList, Math.max(1, was.undo - is.undo));
    } else {
      moveText(chapterId, redoList, undoList, Math.max(1, was.redo - is.redo));
    }
    notify();
  };

  /** An edit made on a preview (`EDIT_CHAPTER_MARKDOWN`) whose chapter has
   *  no open editor: a step of the chapter's saved history. With the
   *  editor open, the editor takes it as a step of its own. */
  const recordTextEdit = (action: Extract<SandboxAction, { type: 'EDIT_CHAPTER_MARKDOWN' }>) => {
    const { chapterId, changes, baseLength } = action.payload;
    if (editors.has(chapterId) || changes.length === 0) return;
    const text = currentText(chapterId);
    if (text === null) return;
    if (baseLength !== undefined && text.length !== baseLength) return;
    if (!changesApply(text, changes)) return;
    const before = savedState(deps.editorStates().get(chapterId), text);
    const after = editSaved(before, changes);
    deps.editorStates().set(chapterId, stateJSON(after));
    setEagerText(chapterId, applyTextChanges(text, changes));
    noteDepths(chapterId, depthsOf(before), depthsOf(after), 'added');
  };

  /** Run one text step; false when the chapter or its history no longer
   *  has it (the step is then dropped). */
  const runText = (step: TextStep, dir: 'undo' | 'redo', follow: boolean): boolean => {
    const id = step.chapterId;
    const text = currentText(id);
    if (text === null) return false;
    const editor = editors.get(id);
    if (editor) {
      applying = id;
      let ran = false;
      try {
        ran = editor.run(dir);
      } finally {
        applying = null;
      }
      depths.set(id, depthsOf(editor.getState()));
      if (!ran) return false;
    } else {
      const json = deps.editorStates().get(id);
      if (!json) return false;
      const out = runSaved(savedState(json, text), dir);
      if (!out) return false;
      deps.editorStates().set(id, stateJSON(out.state));
      depths.set(id, depthsOf(out.state));
      setEagerText(id, applyTextChanges(text, out.changes));
      deps.dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: id, changes: out.changes, baseLength: text.length } });
    }
    if (follow && deps.getState().activeChapterId !== id) deps.dispatch({ type: 'SET_ACTIVE_CHAPTER', payload: id });
    return true;
  };

  // --- both --------------------------------------------------------------

  const run = (dir: 'undo' | 'redo', options: HistoryRunOptions = {}): HistoryStepInfo | null => {
    const from = dir === 'undo' ? undoList : redoList;
    const to = dir === 'undo' ? redoList : undoList;
    sealTop();
    while (from.length > 0) {
      const step = from.pop()!;
      if (options.kind && step.kind !== options.kind) {
        from.push(step);
        break;
      }
      if (step.kind === 'config') {
        runConfig(step, dir);
        step.open = false;
      } else if (step.kind === 'resource') {
        if (!runResource(step, dir)) continue;
        step.open = false;
      } else if (!runText(step, dir, options.follow === true)) {
        continue;
      }
      to.push(step);
      notify();
      return info(step);
    }
    notify();
    return null;
  };

  const clearAll = () => {
    if (undoList.length === 0 && redoList.length === 0) return;
    undoList.length = 0;
    redoList.length = 0;
    notify();
  };

  const startSwitch = () => {
    clearAll();
    eagerText.clear();
    switching = true;
    queueMicrotask(() => { switching = false; });
  };

  const dispatch: Dispatch<SandboxAction> = (action) => {
    switch (action.type) {
      case 'SET_CONFIG':
      case 'UPDATE_CONFIG':
        recordConfig(action);
        break;
      case 'EDIT_CHAPTER_MARKDOWN':
        recordTextEdit(action);
        break;
      case 'UPSERT_RESOURCE':
        recordResource(action);
        break;
      case 'SET_BOOK':
        startSwitch();
        break;
      case 'SET_PRESET':
        if (action.payload.id !== deps.getState().activePresetId) startSwitch();
        break;
      case 'SET_ACTIVE_PROJECT':
        if (action.payload.id !== deps.getState().activeProjectId) startSwitch();
        break;
      default:
        break;
    }
    deps.dispatch(action);
  };

  return {
    dispatch,
    undo: (options) => run('undo', options),
    redo: (options) => run('redo', options),
    peek: (redo = false) => {
      const list = redo ? redoList : undoList;
      const step = list[list.length - 1];
      return step ? info(step) : null;
    },
    canUndo: () => undoList.length > 0,
    canRedo: () => redoList.length > 0,
    getVersion: () => version,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attachEditor: (chapterId, editor) => {
      if (editor) {
        editors.set(chapterId, editor);
        depths.set(chapterId, depthsOf(editor.getState()));
        eagerText.delete(chapterId);
      } else {
        editors.delete(chapterId);
      }
    },
    editorUpdated: (chapterId, state, transactions) => {
      const is = depthsOf(state);
      const was = depths.get(chapterId) ?? is;
      depths.set(chapterId, is);
      if (applying === chapterId) return;
      const added = transactions.some((tr) => tr.docChanged && tr.annotation(Tr.addToHistory) !== false && !tr.isUserEvent('undo') && !tr.isUserEvent('redo'));
      if (added) noteDepths(chapterId, was, is, 'added');
      else if (is.undo === was.undo && is.redo === was.redo) return;
      else if (transactions.some((tr) => tr.isUserEvent('undo'))) noteDepths(chapterId, was, is, 'undo');
      else if (transactions.some((tr) => tr.isUserEvent('redo'))) noteDepths(chapterId, was, is, 'redo');
    },
    pruneChapters: (live) => {
      const keep = (s: Step) => s.kind !== 'text' || live.has(s.chapterId);
      const before = undoList.length + redoList.length;
      const u = undoList.filter(keep);
      const r = redoList.filter(keep);
      undoList.splice(0, undoList.length, ...u);
      redoList.splice(0, redoList.length, ...r);
      for (const id of [...depths.keys()]) if (!live.has(id)) depths.delete(id);
      for (const id of [...eagerText.keys()]) if (!live.has(id)) eagerText.delete(id);
      if (undoList.length + redoList.length !== before) notify();
    },
    seal: sealTop,
    clear: () => {
      clearAll();
      eagerText.clear();
    },
  };
}

/** Whether two versions of a resource differ in more than their stamp. */
function sameResource(a: Resource, b: Resource): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}

// --- the history the module-level helpers reach ---------------------------

let active: SandboxHistory | null = null;

/** The provider's history, for code outside React (viewer edits, keys). */
export function setActiveHistory(history: SandboxHistory | null): void {
  active = history;
}

export function activeHistory(): SandboxHistory | null {
  return active;
}
