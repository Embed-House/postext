/**
 * The state the page-template editor shares between the Design panel and
 * the pages on the canvas (#863): whether the canvas is in Design mode
 * (frames are drawn, moved and resized there instead of the text being
 * selected), the template and frame being edited, and the scope.
 *
 * A small external store, so the canvas's DOM controllers read it without
 * React and the panel subscribes with `useSyncExternalStore`. The mode is
 * the Sandbox's Content / Design mode (#864, `editing/editMode.ts`), and a
 * frame picked there (`selectFrame`) is picked here too.
 */

import { useSyncExternalStore, type Dispatch } from 'react';
import type { SandboxAction, SandboxState } from '../context/SandboxContext';
import type { TemplateScope } from './templateEdits';
import { editModeNow, onEditModeChange, selectedFrameNow, setEditMode } from '../editing/editMode';

export interface TemplateEditorSelection {
  templateId: string;
  scope: TemplateScope;
  /** The frame (or group, `kind: 'group'`) open in the properties. */
  frame: string | null;
  group: string | null;
  /** The page the frame was picked on, when it was picked on a page. */
  pageIndex: number | null;
}

export interface TemplateEditorState {
  designMode: boolean;
  selection: TemplateEditorSelection | null;
}

let state: TemplateEditorState = { designMode: false, selection: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

const SCOPE_RE = /^\/pageTemplates\/\d+\/variants\/(recto|verso)\//;

/** The Content / Design mode and the frame picked in it, read into the
 *  editor's state. */
function syncFromEditMode(): void {
  const designMode = editModeNow() === 'design';
  const picked = selectedFrameNow();
  let selection = state.selection;
  if (picked && (selection?.templateId !== picked.template || selection.frame !== picked.name || selection.pageIndex !== picked.pageIndex)) {
    const scope = (SCOPE_RE.exec(picked.configPath)?.[1] as TemplateScope | undefined) ?? 'base';
    selection = { templateId: picked.template, scope, frame: picked.name, group: null, pageIndex: picked.pageIndex };
  }
  if (designMode === state.designMode && selection === state.selection) return;
  state = { designMode, selection };
  emit();
}

let linked = false;
function link(): void {
  if (linked) return;
  linked = true;
  state = { ...state, designMode: editModeNow() === 'design' };
  onEditModeChange(syncFromEditMode);
}

export const templateEditor = {
  getSnapshot: (): TemplateEditorState => {
    link();
    return state;
  },
  subscribe(listener: () => void): () => void {
    link();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The Sandbox's mode: Design (`on`) or Content. */
  setDesignMode(on: boolean): void {
    link();
    setEditMode(on ? 'design' : 'content');
  },
  select(selection: TemplateEditorSelection | null): void {
    const a = state.selection;
    if (a && selection && a.templateId === selection.templateId && a.scope === selection.scope && a.frame === selection.frame && a.group === selection.group && a.pageIndex === selection.pageIndex) return;
    state = { ...state, selection };
    emit();
  },
  /** The selection with some fields changed (no selection: nothing). */
  update(patch: Partial<TemplateEditorSelection>): void {
    if (!state.selection) return;
    templateEditor.select({ ...state.selection, ...patch });
  },
  /** Back to the start (tests). */
  reset(): void {
    state = { designMode: editModeNow() === 'design', selection: null };
    emit();
  },
};

export function useTemplateEditor(): TemplateEditorState {
  return useSyncExternalStore(templateEditor.subscribe, templateEditor.getSnapshot, templateEditor.getSnapshot);
}

/** What the canvas's frame editors read the book from and write it with:
 *  set by the canvas while it is mounted. */
export interface TemplateEditorHost {
  getState: () => SandboxState;
  dispatch: Dispatch<SandboxAction>;
}

let host: TemplateEditorHost | null = null;

export function setTemplateEditorHost(next: TemplateEditorHost | null): void {
  host = next;
}

export function templateEditorHost(): TemplateEditorHost | null {
  return host;
}
