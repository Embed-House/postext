// Music scores (#1172) in the PDF: each system's plain SVG converted to a
// vector drawing up front (its words in the book's embedded faces), then
// drawn in place as a form XObject when its line is painted.

import type { VDTDocument, VDTBlock, VDTLineSegment, ScoreSystem } from 'postext';
import type { FontCache } from '../fontCache.js';
import type { PageCtx } from './primitives.js';
import { svgToVectorDrawing, drawVectorDrawing, type VectorDrawing } from './svgVector.js';
import { collectSvgFontStrings, fontResolverFor, svgCodePoints } from './renderResourceBlock.js';
import { counterFlipPx, fillRectPx, colorFromHex } from './primitives.js';

/** Drawings per system and ink: a score's systems are converted once. */
const drawings = new WeakMap<ScoreSystem, Map<string, VectorDrawing | null>>();

function scoreSvg(system: ScoreSystem, color: string): string {
  return system.svg.replace(/currentColor/g, color);
}

function* scoreSegments(doc: VDTDocument): Generator<{ system: ScoreSystem; color: string }> {
  const seen = new Set<VDTBlock>();
  const visit = function* (blocks: readonly VDTBlock[]): Generator<{ system: ScoreSystem; color: string }> {
    for (const b of blocks) {
      if (seen.has(b) || b.type !== 'score') continue;
      seen.add(b);
      for (const line of b.lines) for (const seg of line.segments ?? []) {
        if (seg.kind === 'score' && seg.scoreSystem && seg.scoreSystem.svg) yield { system: seg.scoreSystem, color: b.color };
      }
    }
  };
  yield* visit(doc.blocks);
  for (const page of doc.pages) for (const col of page.columns) yield* visit(col.blocks);
}

/** Convert every score system of `doc` to a vector drawing, its text faces
 *  embedded first (the conversion that follows is synchronous). */
export async function preloadScoreDrawings(doc: VDTDocument, fontCache: FontCache | undefined): Promise<void> {
  const pending: Array<{ system: ScoreSystem; color: string; svg: string }> = [];
  const wanted = new Map<string, Set<number>>();
  for (const { system, color } of scoreSegments(doc)) {
    if (drawings.get(system)?.has(color)) continue;
    const svg = scoreSvg(system, color);
    pending.push({ system, color, svg });
    if (fontCache && system.items.some((i) => i.type === 'text')) {
      const codePoints = svgCodePoints(svg);
      for (const fs of collectSvgFontStrings(svg)) {
        const set = wanted.get(fs) ?? new Set<number>();
        for (const cp of codePoints) set.add(cp);
        wanted.set(fs, set);
      }
    }
  }
  if (pending.length === 0) return;
  if (fontCache && wanted.size > 0) await fontCache.preloadFontStrings(wanted);
  const fonts = fontCache ? fontResolverFor(fontCache) : undefined;
  for (const { system, color, svg } of pending) {
    let byColor = drawings.get(system);
    if (!byColor) drawings.set(system, (byColor = new Map()));
    byColor.set(color, svgToVectorDrawing(svg, fonts ? { fonts } : {}));
  }
}

/** Paint a score segment whose line's baseline is the system's foot. */
export function renderScoreSegment(ctx: PageCtx, seg: VDTLineSegment, xPx: number, baselinePx: number, color: string): void {
  const system = seg.scoreSystem;
  const k = system && system.widthPx > 0 ? seg.width / system.widthPx : 1;
  const h = (system?.heightPx ?? 0) * k;
  const top = baselinePx - h;
  const drawing = system ? drawings.get(system)?.get(color) : undefined;
  if (!drawing) {
    // The engraver did not run, or the drawing did not convert: a pale box
    // keeps the room, as on the screen.
    fillRectPx(ctx, xPx, top, seg.width, h, colorFromHex('#ececec', ctx.colorSpace));
    return;
  }
  // Notation reads left to right on a mirrored page too.
  counterFlipPx(ctx, xPx, seg.width, () => drawVectorDrawing(ctx, drawing, xPx, top, seg.width, h));
}
