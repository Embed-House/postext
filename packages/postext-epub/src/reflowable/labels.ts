// The words a `:::figure` sets on its picture (#860), back on the picture
// of a reflowable book (#955): one inline SVG laid over the image, in the
// picture's own coordinates, so the labels keep their place and their
// proportion whatever the width the reader gives the picture.
//
// Only what an SVG `<text>` says as well as the print does is drawn: a
// horizontal label of plain words, in bold or italic, with the halo and the
// plate of its style. A label with a formula, a chip, a mark, a script, a
// line the bidi algorithm reordered or a vertical column stays in the list
// of labels that follows the picture, out of sight, as before.

import type { ResolvedResourceBlock, VDTFigureLabelLayout, VDTLine, VDTLineSegment } from 'postext';
import { figureLabelMatrix, parseFontString, uncroppedPictureBox } from 'postext';
import { familyStack } from './css';
import { fontPx, xmlAttr, xmlText } from './inline';

const n = (v: number): string => String(+v.toFixed(3));

/** Segment fields an SVG `<text>` cannot set as the print does. */
function plain(seg: VDTLineSegment): boolean {
  return (seg.kind === 'text' || seg.kind === 'space')
    && !seg.script && !seg.baselineShift && !seg.stacked && !seg.cjkMarks && !seg.ruby && !seg.kunten
    && !seg.warichu && !seg.sideMarker && !seg.mark && !seg.chip && !seg.mathRender && !seg.swatch && !seg.footnoteId
    && !seg.tab && !seg.leader && !seg.labelTab && !seg.tcy && seg.orientation === undefined && !seg.rtl;
}

function drawable(layout: VDTFigureLabelLayout): boolean {
  if (layout.vertical || layout.mirrored || layout.direction === 'rtl') return false;
  return layout.lines.every((line) => !line.order && !line.highlights?.length && (line.segments ?? []).every(plain));
}

/** The font of one segment: the label's face for its weight and slant,
 *  unless the segment carries its own. */
function faceOf(layout: VDTFigureLabelLayout, seg: VDTLineSegment): string {
  if (seg.fontString) return seg.fontString;
  if (seg.bold && seg.italic) return layout.boldItalicFontString;
  if (seg.bold) return layout.boldFontString;
  if (seg.italic) return layout.italicFontString;
  return layout.fontString;
}

function fontAttrs(font: string): string {
  const face = parseFontString(font);
  const parts = [`font-size="${n(fontPx(font))}"`];
  if (face) {
    parts.push(`font-family="${xmlAttr(familyStack(face.family))}"`);
    if (face.weight !== 400) parts.push(`font-weight="${face.weight}"`);
    if (face.style === 'italic') parts.push('font-style="italic"');
  }
  return parts.join(' ');
}

/** One line as a `<text>`: a `<tspan>` per word run at the x the layout
 *  measured, so a face with other metrics cannot push the words together. */
function lineText(layout: VDTFigureLabelLayout, line: VDTLine, extra: string): string {
  const y = n(line.baseline);
  const segments = line.segments ?? [];
  if (segments.length === 0) {
    if (line.text.trim() === '') return '';
    return `<text x="${n(line.bbox.x)}" y="${y}" ${fontAttrs(layout.fontString)}${extra}>${xmlText(line.text)}</text>`;
  }
  let x = line.bbox.x;
  const runs: string[] = [];
  for (const seg of segments) {
    if (seg.kind === 'text' && seg.text.trim() !== '') {
      const tracking = seg.tracking ? ` letter-spacing="${n(seg.tracking)}"` : '';
      runs.push(`<tspan x="${n(x)}" ${fontAttrs(faceOf(layout, seg))}${tracking}>${xmlText(seg.text)}</tspan>`);
    }
    x += seg.width;
  }
  return runs.length === 0 ? '' : `<text y="${y}"${extra}>${runs.join('')}</text>`;
}

function labelGroup(layout: VDTFigureLabelLayout): string {
  const m = figureLabelMatrix(layout, 0, 0);
  const out: string[] = [];
  if (layout.background) {
    const r = layout.background.rect;
    out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}" fill="${xmlAttr(layout.background.color)}"/>`);
  }
  if (layout.halo && layout.halo.widthPx > 0) {
    const halo = ` fill="${xmlAttr(layout.halo.color)}" stroke="${xmlAttr(layout.halo.color)}" stroke-width="${n(2 * layout.halo.widthPx)}" stroke-linejoin="round"`;
    for (const line of layout.lines) out.push(lineText(layout, line, halo));
  }
  const ink = ` fill="${xmlAttr(layout.color)}"`;
  for (const line of layout.lines) out.push(lineText(layout, line, ink));
  const body = out.filter(Boolean).join('');
  return body ? `<g transform="matrix(${m.map(n).join(' ')})">${body}</g>` : '';
}

/**
 * The SVG laid over the picture of a figure with labels, or undefined when
 * no label can be drawn that way. Its viewBox is the picture's box in the
 * body's coordinates (the whole picture, past the safe area the print
 * crops to), so the labels land where the print puts them. Right-to-left
 * pages are laid out mirrored: the caller leaves them to the list.
 */
export function figureLabelsOverlay(rb: ResolvedResourceBlock): string | undefined {
  if (rb.kind !== 'bitmap' && rb.kind !== 'svg') return undefined;
  const groups = (rb.labels ?? [])
    .map((l) => (l.layout && drawable(l.layout) ? labelGroup(l.layout) : ''))
    .filter(Boolean);
  if (groups.length === 0) return undefined;
  const { width, height } = rb.bodyRect;
  const box = rb.bodySource ? uncroppedPictureBox(0, 0, width, height, rb.bodySource) : { x: 0, y: 0, width, height };
  return `<svg class="pt-label-layer" xmlns="http://www.w3.org/2000/svg" viewBox="${n(box.x)} ${n(box.y)} ${n(box.width)} ${n(box.height)}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${groups.join('')}</svg>`;
}
