/**
 * What the page-template editor does on the canvas (#863), as events: a
 * frame picked, a drag starting, moving, dropped or cancelled. Other tools
 * (two-way selection, U9) listen here instead of reading the editor's DOM.
 * Boxes are page px of the page the event happened on.
 */

import type { FrameConfig } from 'postext';
import type { Handle, Rect } from './frameGeometry';

export type FrameDragKind = 'move' | 'resize' | 'draw';

export type FrameEditorEvent =
  | { type: 'select'; pageIndex: number; templateId: string; frame: string; frameId: string }
  | { type: 'dragStart' | 'drag'; pageIndex: number; kind: FrameDragKind; handle: Handle; frame?: string; rect: Rect }
  | { type: 'drop'; pageIndex: number; kind: FrameDragKind; handle: Handle; frame?: string; rect: Rect; patch?: Partial<FrameConfig> }
  | { type: 'cancel'; pageIndex: number; frame?: string };

const listeners = new Set<(e: FrameEditorEvent) => void>();

/** Listen to the editor's events; the function returned stops. */
export function onFrameEditorEvent(listener: (e: FrameEditorEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** @internal the frame editor's. */
export function emitFrameEditorEvent(e: FrameEditorEvent): void {
  for (const l of [...listeners]) {
    try {
      l(e);
    } catch (err) {
      console.error('[postext-sandbox] frame editor listener', err);
    }
  }
}
