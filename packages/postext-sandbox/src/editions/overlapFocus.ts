/**
 * An overlap check the reader selected (#1066), drawn on the canvas until
 * another check is selected or one of its fixes is made: a `frameCovered`
 * (both frames and where they meet) or a `frameOutsideArea` (the frame,
 * the box it runs past and the overrun). Frames by their names on the
 * page; the canvas marks are `viewport/composed/overlapMarks.ts`.
 */

export type OverlapSides = { top?: number; right?: number; bottom?: number; left?: number };

export type OverlapFocusOf =
  | { kind: 'covered'; frame: string; coveredBy: string }
  | { kind: 'outside'; frame: string; past: 'trim' | 'bleed' | 'frame' | 'group'; target?: string; sides: OverlapSides };

export type OverlapFocus = OverlapFocusOf & {
  /** The page in the document on screen. */
  pageIndex: number;
};

const listeners = new Set<() => void>();
let focus: OverlapFocus | null = null;

/** The overlap a warning payload describes, if it is an overlap check. */
export function overlapFocusOf(payload: { kind: string }): OverlapFocusOf | undefined {
  const p = payload as { kind: string } & Record<string, unknown>;
  if (p.kind === 'frameCovered') return { kind: 'covered', frame: String(p.frame), coveredBy: String(p.coveredBy) };
  if (p.kind === 'frameOutsideArea') {
    return {
      kind: 'outside',
      frame: String(p.frame),
      past: p.past as 'trim' | 'bleed' | 'frame' | 'group',
      ...(typeof p.target === 'string' ? { target: p.target } : {}),
      sides: { ...(p.sides as OverlapSides | undefined) },
    };
  }
  return undefined;
}

export function overlapFocusNow(): OverlapFocus | null {
  return focus;
}

export function setOverlapFocus(next: OverlapFocus | null): void {
  if (focus === next) return;
  focus = next;
  for (const l of listeners) l();
}

export function onOverlapFocusChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
