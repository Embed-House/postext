/**
 * Content and Design modes (#864): the two ways the Sandbox is worked in.
 *
 * - **Content**: the text is edited (in the editor and on the pages); the
 *   frames of composed pages stay where their template puts them.
 * - **Design**: templates and styles are edited (the Design panel, frames
 *   dragged on the page, #863); the text is read only.
 *
 * Viewer state, never configuration, remembered per browser. Alt+Shift+M
 * (⌥⇧M) switches between them anywhere in the Sandbox. The frame picked on
 * the page in Design mode is kept here too, for the page-template editor.
 */

import { useSyncExternalStore } from 'react';

export type EditMode = 'content' | 'design';
export const EDIT_MODES: readonly EditMode[] = ['content', 'design'];

const KEY = 'postext-sandbox-edit-mode';
const listeners = new Set<() => void>();
let mode: EditMode | undefined;

function readMode(): EditMode {
  if (mode !== undefined) return mode;
  try {
    mode = globalThis.localStorage?.getItem(KEY) === 'design' ? 'design' : 'content';
  } catch {
    mode = 'content';
  }
  return mode;
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The mode now, read outside React. */
export function editModeNow(): EditMode {
  return readMode();
}

export function setEditMode(next: EditMode): void {
  if (readMode() === next) return;
  mode = next;
  try {
    if (next === 'design') globalThis.localStorage?.setItem(KEY, 'design');
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the switch still works for this visit.
  }
  // A frame picked for the template editor belongs to Design mode.
  if (next === 'content') selected = null;
  emit();
}

export function toggleEditMode(): EditMode {
  const next = readMode() === 'content' ? 'design' : 'content';
  setEditMode(next);
  return next;
}

/** The mode, `[mode, set]`. */
export function useEditMode(): [EditMode, (next: EditMode) => void] {
  const m = useSyncExternalStore(subscribe, readMode, () => 'content' as EditMode);
  return [m, setEditMode];
}

/** A frame of a composed page picked on the page in Design mode. */
export interface SelectedFrame {
  /** The page in the document on screen. */
  pageIndex: number;
  /** `cp<fence>:<name>`. */
  frameId: string;
  name: string;
  template: string;
  /** JSON pointer of the template entry (`/pageTemplates/3/frames/2`). */
  configPath: string;
}

let selected: SelectedFrame | null = null;

export function selectedFrameNow(): SelectedFrame | null {
  return selected;
}

export function selectFrame(next: SelectedFrame | null): void {
  const same = selected === next || (selected && next && selected.pageIndex === next.pageIndex && selected.frameId === next.frameId && selected.configPath === next.configPath);
  if (same) return;
  selected = next;
  emit();
}

/** The frame picked in Design mode, null when none. */
export function useSelectedFrame(): SelectedFrame | null {
  return useSyncExternalStore(subscribe, selectedFrameNow, () => null);
}

/** Listen to any change of mode or picked frame (the canvas overlay,
 *  outside React). */
export function onEditModeChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** Whether the keys are read on a Mac: its shortcuts are written with the
 *  symbols printed on its keyboard (⌥, ⇧). */
export function isMacKeyboard(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** How the Alt key reads on this machine: ⌥ on a Mac. */
export function altKeyText(): string {
  return isMacKeyboard() ? '⌥' : 'Alt';
}

/** The keys that switch modes: Alt+Shift+M (⌥⇧M on a Mac). Read by the
 *  physical key, so every keyboard layout has it where an M is printed
 *  on a QWERTY one. */
export const EDIT_MODE_SHORTCUT = 'Alt+Shift+M';

export function isEditModeShortcut(ev: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code' | 'key'>): boolean {
  if (!ev.altKey || !ev.shiftKey || ev.ctrlKey || ev.metaKey) return false;
  return ev.code === 'KeyM' || ev.key === 'M' || ev.key === 'm';
}

/** Forget the stored state (tests). */
export function resetEditMode(): void {
  mode = undefined;
  selected = null;
  emit();
}
