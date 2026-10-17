// Zoom of the picture in the marks dialog (#956): the steps, the wheel and
// the zoom from which a dense map names all its points.

/** The most the picture is enlarged: a map of a hundred towns is worked on
 *  at eight times its fitted size. */
export const MAX_STAGE_ZOOM = 8;

/** From this zoom a dense map (more anchors than `DENSE_ANCHORS`) shows
 *  every name, as the picture then has room for them. */
export const STAGE_NAMES_ZOOM = 3;

const STEPS = [1, 1.5, 2, 3, 4, 6, MAX_STAGE_ZOOM];

/** The zoom a step of the buttons or keys goes to: the next level above
 *  (`direction` 1) or below (-1) `zoom`. */
export function zoomStep(zoom: number, direction: 1 | -1): number {
  if (direction === 1) return STEPS.find((s) => s > zoom + 1e-9) ?? MAX_STAGE_ZOOM;
  for (let i = STEPS.length - 1; i >= 0; i--) if (STEPS[i]! < zoom - 1e-9) return STEPS[i]!;
  return 1;
}

/** The factor a wheel event with a Ctrl or Meta key (a pinch on a
 *  trackpad) zooms by: smooth for small deltas, capped for the notches of
 *  a mouse wheel. */
export function wheelZoom(deltaY: number): number {
  return Math.exp(-Math.max(-30, Math.min(30, deltaY)) * 0.01);
}
