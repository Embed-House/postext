/**
 * The state the page-template editor shares between the Design panel and
 * the pages on the canvas (#863): whether the canvas is in Design mode
 * (frames are drawn, moved and resized there instead of the text being
 * selected), the template and frame being edited, and the scope.
 *
 * A small external store, so the canvas's DOM controllers read it without
 * React and the panel subscribes with `useSyncExternalStore`. Until the
 * editor's Content/Design switch (#864) owns the mode, the Page templates
 * section sets it with a switch of its own.
 */

import { useSyncExternalStore, type Dispatch } from 'react';
import type { SandboxAction, SandboxState } from '../context/SandboxContext';
import type { TemplateScope } from './templateEdits';

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

export const templateEditor = {
  getSnapshot: (): TemplateEditorState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setDesignMode(on: boolean): void {
    if (state.designMode === on) return;
    state = { ...state, designMode: on };
    emit();
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
    state = { designMode: false, selection: null };
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
