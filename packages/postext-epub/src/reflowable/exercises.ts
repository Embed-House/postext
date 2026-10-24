// The exercises of a reflowable book (#1231). An exercise's outer box is a
// group with its records for the exercise script; its drawn boxes — a
// writing area, a word search, a crossword, operations in columns, the
// two columns of a match — are the picture its design draws, as an inline
// SVG at the size it prints (CSS pixels for the points of the page) set in
// ems, so it grows with the reader's text, with the box the script lays its
// inputs, lines and capsules over.

import type { VDTBlock, VDTDesignBlock } from 'postext';
import { pathSvgData } from 'postext';
import { xmlAttr, xmlText } from './inline.js';

/** CSS pixels to a point. */
export const CSS_PX_PER_PT = 96 / 72;

const n = (v: number): string => String(Math.round(v * 100) / 100);

/** The picture a drawn box's design paints, its size in CSS pixels, and
 *  its width in ems of the text (`bodyCssPx`, the text's size in CSS
 *  pixels): the box is set that wide, so a reader's larger text draws it
 *  larger (#1244). */
export function drawnBoxSvg(block: VDTBlock, dpi: number, bodyCssPx = 16): { svg: string; width: number; height: number; em: number } {
  const { x: ox, y: oy, width: bw, height: bh } = block.bbox;
  const scale = 96 / (dpi || 96);
  const parts: string[] = [];
  for (const b of (block.designOverlay?.blocks ?? []) as VDTDesignBlock[]) {
    if (b.kind === 'path') {
      const attrs = [`d="${pathSvgData(b.subpaths, ox, oy)}"`, `fill="${b.fill ? xmlAttr(b.fill) : 'none'}"`];
      if (b.fill && b.fillRule === 'evenodd') attrs.push('fill-rule="evenodd"');
      if (b.stroke && b.stroke.widthPx > 0) {
        attrs.push(`stroke="${xmlAttr(b.stroke.color)}"`, `stroke-width="${n(b.stroke.widthPx)}"`);
        if (b.stroke.dash && b.stroke.dash.length > 0) attrs.push(`stroke-dasharray="${b.stroke.dash.map(n).join(' ')}"`);
        if (b.stroke.cap && b.stroke.cap !== 'butt') attrs.push(`stroke-linecap="${b.stroke.cap}"`);
        if (b.stroke.join && b.stroke.join !== 'miter') attrs.push(`stroke-linejoin="${b.stroke.join}"`);
      }
      parts.push(`<path ${attrs.join(' ')}/>`);
    } else if (b.kind === 'rule') {
      const w = b.direction === 'vertical' ? b.thicknessPx : b.bbox.width;
      const h = b.direction === 'vertical' ? b.bbox.height : b.thicknessPx;
      parts.push(`<rect x="${n(b.bbox.x - ox)}" y="${n(b.bbox.y - oy)}" width="${n(w)}" height="${n(h)}" fill="${xmlAttr(b.color)}"/>`);
    } else if (b.kind === 'text') {
      for (const line of b.lines) {
        if (!line.text.trim()) continue;
        parts.push(
          `<text x="${n(b.bbox.x - ox + line.xOffset)}" y="${n(line.baselineY - oy)}" fill="${xmlAttr(b.color)}" style="font:${xmlAttr(b.fontString)};white-space:pre">${xmlText(line.text)}</text>`,
        );
      }
    }
  }
  const width = bw * scale;
  const height = bh * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="pt-ex-drawing" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(bw)} ${n(bh)}">${parts.join('')}</svg>`;
  return { svg, width, height, em: Math.round((width / Math.max(1, bodyCssPx)) * 1000) / 1000 };
}
