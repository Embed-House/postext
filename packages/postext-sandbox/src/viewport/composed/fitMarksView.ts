/**
 * Which fit marks the canvas draws over composed pages (#1160): every one
 * (`all`), the frames that do not fit and the looks the config does not
 * have (`problems`), or none. The book sets a default (`debug.fitMarks`,
 * with `debug.fitMarksMinScale` for the scale badges); the viewer's own
 * choice in the canvas rail wins, and is remembered per browser like the
 * switch of the reflow marks.
 */

import { useSyncExternalStore } from 'react';
import { FIT_MARKS_MODES, resolveDebugConfig } from 'postext';
import type { DebugConfig, FitMarksMode } from 'postext';

export type { FitMarksMode };
export { FIT_MARKS_MODES };

const KEY = 'postext-sandbox-fit-marks';
const listeners = new Set<() => void>();
/** undefined: not read yet; null: the viewer never chose. */
let choice: FitMarksMode | null | undefined;

function isMode(value: unknown): value is FitMarksMode {
  return FIT_MARKS_MODES.includes(value as FitMarksMode);
}

function readChoice(): FitMarksMode | null {
  if (choice !== undefined) return choice;
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    choice = isMode(stored) ? stored : null;
  } catch {
    choice = null;
  }
  return choice;
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The viewer's own choice, or null when they follow the book. */
export function fitMarksChoiceNow(): FitMarksMode | null {
  return readChoice();
}

/** Keep the viewer's choice; null goes back to the book's default. */
export function setFitMarksChoice(next: FitMarksMode | null): void {
  if (readChoice() === next) return;
  choice = next;
  try {
    if (next) globalThis.localStorage?.setItem(KEY, next);
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Blocked storage: the choice holds for this visit.
  }
  emit();
}

export function useFitMarksChoice(): [FitMarksMode | null, (next: FitMarksMode | null) => void] {
  return [useSyncExternalStore(subscribe, readChoice, () => null), setFitMarksChoice];
}

/** Any change of the viewer's choice (the canvas overlay redraws). */
export function onFitMarksChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** What the canvas draws: the viewer's choice over the book's default,
 *  and the scale at which a scale badge is no longer drawn. */
export interface FitMarksView {
  mode: FitMarksMode;
  minScale: number;
  /** Where the mode comes from. */
  source: 'viewer' | 'book';
}

export function fitMarksViewOf(debug: DebugConfig | undefined, viewer: FitMarksMode | null = readChoice()): FitMarksView {
  const book = resolveDebugConfig(debug);
  return { mode: viewer ?? book.fitMarks, minScale: book.fitMarksMinScale, source: viewer ? 'viewer' : 'book' };
}

/** The mode after `mode` in the rail's button: all → problems → none. */
export function nextFitMarksMode(mode: FitMarksMode): FitMarksMode {
  return FIT_MARKS_MODES[(FIT_MARKS_MODES.indexOf(mode) + 1) % FIT_MARKS_MODES.length]!;
}

/** Forget the stored choice (tests). */
export function resetFitMarksView(): void {
  choice = undefined;
  emit();
}
