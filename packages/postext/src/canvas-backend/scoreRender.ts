// Paint a music score system (#1172) on the canvas: its paths filled or
// stroked and its words set, in the block's colour, scaled to the width the
// line gives the segment.

import type { VDTLineSegment, VDTResourceScore } from '../vdt.js';
import type { ScoreSystem } from '../music/types.js';
import { buildFontString } from '../measure/font.js';
import { counterFlipBox } from './mirrorFrame.js';
import { restoreContext, saveContext } from './contextState.js';
import { fillContextText } from './contextText.js';

const pathCache = new WeakMap<ScoreSystem, (Path2D | null)[]>();

function systemPaths(system: ScoreSystem): (Path2D | null)[] {
  let paths = pathCache.get(system);
  if (!paths) {
    paths = system.items.map((it) => (it.type === 'path' ? new Path2D(it.d) : null));
    pathCache.set(system, paths);
  }
  return paths;
}

/** Paint one system with its top-left at (`x`, `top`), `width` px wide. */
export function paintScoreSystem(
  ctx: CanvasRenderingContext2D,
  system: ScoreSystem | undefined,
  x: number,
  top: number,
  width: number,
  color: string,
): void {
  const k = system && system.widthPx > 0 ? width / system.widthPx : 1;
  const height = (system?.heightPx ?? 0) * k;
  if (!system || system.items.length === 0) {
    // The engraver is loading, or the notation did not load.
    saveContext(ctx);
    ctx.fillStyle = 'rgba(160, 160, 160, 0.15)';
    ctx.fillRect(x, top, width, height);
    restoreContext(ctx);
    return;
  }
  const paths = systemPaths(system);
  // Notation reads left to right in every document: a mirrored frame turns
  // it back (see `mirrorFrame.ts`).
  counterFlipBox(ctx, x, width, () => {
    saveContext(ctx);
    ctx.translate(x, top);
    ctx.scale(k, k);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    for (let i = 0; i < system.items.length; i++) {
      const it = system.items[i]!;
      if (it.type === 'path') {
        const p = paths[i]!;
        if (it.fill) {
          ctx.fill(p);
        } else {
          ctx.lineWidth = it.strokeWidth ?? 1;
          ctx.lineCap = it.lineCap ?? 'butt';
          ctx.stroke(p);
        }
      } else {
        ctx.font = buildFontString(system.textFont, it.sizePx, it.bold ? 'bold' : 'normal', it.italic ? 'italic' : 'normal');
        ctx.textAlign = it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left';
        ctx.textBaseline = 'alphabetic';
        fillContextText(ctx, it.text, it.x, it.y);
      }
    }
    restoreContext(ctx);
  });
}

/** Paint a score segment whose line's baseline is the system's foot. */
export function renderScoreSegment(
  ctx: CanvasRenderingContext2D,
  seg: VDTLineSegment,
  x: number,
  baseline: number,
  color: string,
): void {
  const system = seg.scoreSystem;
  const k = system && system.widthPx > 0 ? seg.width / system.widthPx : 1;
  paintScoreSystem(ctx, system, x, baseline - (system?.heightPx ?? 0) * k, seg.width, color);
}

/** Paint a score resource's systems down its body (#1172), scaled to the
 *  body's width. */
export function paintScoreBody(ctx: CanvasRenderingContext2D, score: VDTResourceScore, bx: number, by: number, bw: number): void {
  const k = score.systems[0] && score.systems[0].width > 0 ? bw / score.systems[0].width : 1;
  for (const s of score.systems) paintScoreSystem(ctx, s.system, bx, by + s.y * k, s.width * k, score.color);
}
