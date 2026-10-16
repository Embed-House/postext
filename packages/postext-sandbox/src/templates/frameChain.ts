/** The frame of the same page a frame's content goes on in: its `next`,
 *  else an `overflow.continueIn` of the form `'#frame'` (as the engine
 *  reads it, #855). */
export function nextFrameName(frame: { next?: string; overflow?: { continueIn?: string } }): string | undefined {
  if (frame.next) return frame.next;
  const c = frame.overflow?.continueIn;
  return typeof c === 'string' && c.startsWith('#') && c.length > 1 ? c.slice(1) : undefined;
}
