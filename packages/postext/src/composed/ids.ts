/**
 * Stable ids of what a composed page paints (#857, DESIGN §6). Each id is
 * built from the page fence's ordinal in its chapter and the names the
 * template and the Markdown give, never from positions or counters of the
 * layout, so it is the same in every locale of a chapter and across
 * relayouts: a selection made on one build finds its element on the next.
 */

/** The composed page itself (its template): `cp<fenceIndex>`. */
export function composedPageElementId(fenceIndex: number): string {
  return `cp${fenceIndex}`;
}

/** A frame: `cp<fenceIndex>:<name>`; the n-th piece of its content that
 *  goes on on a later page (#859) is `cp<fenceIndex>:<name>~<n>`. */
export function frameElementId(fenceIndex: number, name: string, piece?: number): string {
  return `cp${fenceIndex}:${name}${piece !== undefined && piece > 0 ? `~${piece}` : ''}`;
}

/** A group of frames: `cp<fenceIndex>:group:<name>`. */
export function groupElementId(fenceIndex: number, name: string): string {
  return `cp${fenceIndex}:group:${name}`;
}

/** A figure label: `cp<fenceIndex>:<slot>:label:<anchor>`, `<anchor>` the
 *  anchor's id (or `@<n>` for the n-th label placed by percentages). */
export function labelElementId(fenceIndex: number, slot: string, anchor: string): string {
  return `cp${fenceIndex}:${slot}:label:${anchor}`;
}

/** An element of a composed page's design slot: its decoration, header or
 *  footer, by the element's `id` (or its index in the slot when it has
 *  none): `cp<fenceIndex>:decoration:<id>`. */
export function designElementId(fenceIndex: number, slot: 'decoration' | 'header' | 'footer', element: string): string {
  return `cp${fenceIndex}:${slot}:${element}`;
}
