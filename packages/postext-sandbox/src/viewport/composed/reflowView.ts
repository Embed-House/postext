/**
 * Whether the canvas shows what the layout moved on composed pages (#868):
 * the Reflow panel and its marks on the pages (the declared boxes dashed,
 * arrows to the boxes as laid, a numbered badge per frame that changed).
 * Viewer state, remembered per browser; the frame the reader points at in
 * the panel is drawn stronger on its page.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'postext-sandbox-reflow';
const listeners = new Set<() => void>();
let shown: boolean | undefined;
let focused: { pageIndex: number; frame: string } | null = null;

function readShown(): boolean {
  if (shown !== undefined) return shown;
  try {
    shown = globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    shown = false;
  }
  return shown;
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reflowShownNow(): boolean {
  return readShown();
}

export function setReflowShown(next: boolean): void {
  if (readShown() === next) return;
  shown = next;
  if (!next) focused = null;
  try {
    if (next) globalThis.localStorage?.setItem(KEY, '1');
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Blocked storage: the switch works for this visit.
  }
  emit();
}

export function useReflowShown(): [boolean, (next: boolean) => void] {
  return [useSyncExternalStore(subscribe, readShown, () => false), setReflowShown];
}

/** The frame the reader points at in the panel (its page index in the
 *  document on screen, its name), or null. */
export function reflowFocusNow(): { pageIndex: number; frame: string } | null {
  return focused;
}

export function setReflowFocus(next: { pageIndex: number; frame: string } | null): void {
  if (focused === next || (focused && next && focused.pageIndex === next.pageIndex && focused.frame === next.frame)) return;
  focused = next;
  emit();
}

/** Any change of the switch or the focused frame (the canvas overlay). */
export function onReflowViewChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** Forget the stored state (tests). */
export function resetReflowView(): void {
  shown = undefined;
  focused = null;
  emit();
}
