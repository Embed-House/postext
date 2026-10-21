/**
 * The shape a pushing frame pushes with (#883, `exclude: 'push'` with
 * `wrap: 'contour'`): the shapes of the pictures it holds (their polygon
 * or traced alpha channel, through their crop and scale), and the boxes of
 * everything else in it (a caption, a line of text). The text of the
 * other frames runs round that, as `calloutLayout`'s exclusions.
 */
import type { Dimension } from '../types.js';
import type { ContentWarning, VDTBlock, VDTContourSpan, VDTExclusionContour } from '../vdt.js';
import { contourOnPage } from '../contour/index.js';
import { dimensionToPx } from '../units.js';

export interface FrameContourOptions {
  /** The frame's gap from the text it pushes (px): the margin of a
   *  picture whose contour sets none. */
  gapPx: number;
  dpi: number;
  emPx: number;
  /** The page lays its flow out mirrored (right to left). */
  mirrored: boolean;
  pageIndex: number;
}

export interface FrameContour {
  /** Absent when no picture of the frame has a known shape: the frame
   *  pushes with its box. */
  contour?: VDTExclusionContour;
  /** `textWrap` notes (`noContour`) for the pictures with no known shape. */
  notes: ContentWarning[];
}

/** The contour of a frame's content `children` (page px, as laid). */
export function frameContour(children: readonly VDTBlock[], options: FrameContourOptions): FrameContour {
  const spans: VDTContourSpan[] = [];
  const notes: ContentWarning[] = [];
  let margin: number | undefined;
  let shaped = false;
  const marginOf = (m: Dimension | undefined): number => (m ? Math.max(0, dimensionToPx(m, options.dpi, options.emPx)) : options.gapPx);
  for (const b of children) {
    if (b.hidden) continue;
    const rb = b.resourceBlock;
    if (rb && (rb.kind === 'bitmap' || rb.kind === 'svg') && !rb.rotation) {
      const m = marginOf(rb.resource.contour?.margin);
      const c = contourOnPage(rb.resource, rb, b.bbox, { margin: m, mirrored: options.mirrored, originX: b.bbox.x, originY: b.bbox.y });
      if (c) {
        spans.push(...c.spans);
        margin = Math.max(margin ?? 0, m);
        shaped = true;
        continue;
      }
      notes.push({ kind: 'textWrap', reason: 'noContour', resourceId: rb.resource.id, pageIndex: options.pageIndex });
    }
    if (b.bbox.width > 0 && b.bbox.height > 0) {
      spans.push({ y: b.bbox.y, height: b.bbox.height, left: b.bbox.x, right: b.bbox.x + b.bbox.width });
    }
  }
  if (!shaped) return { notes };
  spans.sort((a, b) => a.y - b.y);
  return { contour: { spans, margin: margin ?? options.gapPx }, notes };
}
