/**
 * A frame the page-template editor is dragging on the page (#863, #865):
 * where it is while the pointer moves, before the drop writes it. The
 * selection's mark and the frame's properties follow it. Kept apart from
 * the selection store so the Design panel imports nothing else.
 */

import { useSyncExternalStore } from 'react';

/** A frame being moved or resized: where it is now, page px of its page. */
export interface FrameDrag {
  pageIndex: number;
  frame: string;
  rect: { x: number; y: number; width: number; height: number };
}

let dragging: FrameDrag | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The frame dragged now, null when none. */
export function frameDragNow(): FrameDrag | null {
  return dragging;
}

/** Set (or end, null) the drag. */
export function setFrameDrag(next: FrameDrag | null): void {
  if (next === null && dragging === null) return;
  dragging = next;
  for (const l of [...listeners]) l();
}

export function onFrameDragChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** The frame dragged now when it is `frame`, for a panel showing it. */
export function useFrameDrag(frame: string | null): FrameDrag | null {
  const now = useSyncExternalStore(subscribe, frameDragNow, () => null);
  return now && frame !== null && now.frame === frame ? now : null;
}
