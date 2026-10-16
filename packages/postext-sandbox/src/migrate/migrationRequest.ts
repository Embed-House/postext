/**
 * Who asked for the «Move the text to the Markdown» dialog (#874): a book
 * just imported whose configuration holds content, or the reader from the
 * Checks panel. A small external store, so the import, the Checks panel and
 * the dialog (mounted once with the Sandbox) need no shared state.
 */
import { useSyncExternalStore } from 'react';

export type TextMigrationReason = 'import' | 'checks';

export interface TextMigrationRequest {
  reason: TextMigrationReason;
  /** Bumped on every request, so asking again reopens the dialog. */
  serial: number;
}

let current: TextMigrationRequest | null = null;
let serial = 0;
const listeners = new Set<() => void>();

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const emit = (): void => { for (const l of listeners) l(); };

/** Open the dialog. */
export function openTextMigration(reason: TextMigrationReason): void {
  current = { reason, serial: ++serial };
  emit();
}

export function closeTextMigration(): void {
  if (!current) return;
  current = null;
  emit();
}

export function textMigrationRequestNow(): TextMigrationRequest | null {
  return current;
}

export function useTextMigrationRequest(): TextMigrationRequest | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
