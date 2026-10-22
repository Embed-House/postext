// Flatten one Verovio system (SVG) into painted items: filled or stroked
// paths with every transform baked in, and text runs, all in px of the
// slice. Canvas paints the items; HTML and PDF take the plain SVG written
// back from them (`itemsToSvg`), which needs no stylesheet, no `<use>` and
// no nested viewport.
//
// Verovio's markup is well-formed and regular — glyphs in `<defs>` drawn by
// `<use>`, staff lines as stroked paths, stems and bar lines as rects, beams
// as polygons, dots as ellipses, words as `<text>`/`<tspan>` — so a small
// tag scanner does.

import {
  multiply,
  parseSvgTransform,
  scale as scaleMatrix,
  transformPath,
  type AffineMatrix,
} from '../math/pathTransform.js';
import type { ScoreItem } from './types.js';

interface El {
  name: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
}

const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function parse(svg: string): El | null {
  const root: El = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: El[] = [root];
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) break;
    if (lt > i) top.text += decode(svg.slice(i, lt));
    if (svg.startsWith('<!--', lt)) {
      const end = svg.indexOf('-->', lt);
      i = end < 0 ? svg.length : end + 3;
      continue;
    }
    const gt = svg.indexOf('>', lt);
    if (gt < 0) break;
    const tag = svg.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('?') || tag.startsWith('!')) continue;
    if (tag.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const sp = body.search(/\s/);
    const name = (sp < 0 ? body : body.slice(0, sp)).replace(/^.*:/, '');
    const attrs: Record<string, string> = {};
    for (const m of body.matchAll(ATTR_RE)) attrs[m[1]!.replace(/^xlink:/, '')] = decode(m[2]!);
    const el: El = { name, attrs, children: [], text: '' };
    top.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root.children.find((c) => c.name === 'svg') ?? null;
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
}

/** An ellipse as four cubic Béziers (κ = 0.5523). */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  const ox = rx * k;
  const oy = ry * k;
  return `M${cx - rx} ${cy}`
    + `C${cx - rx} ${cy - oy} ${cx - ox} ${cy - ry} ${cx} ${cy - ry}`
    + `C${cx + ox} ${cy - ry} ${cx + rx} ${cy - oy} ${cx + rx} ${cy}`
    + `C${cx + rx} ${cy + oy} ${cx + ox} ${cy + ry} ${cx} ${cy + ry}`
    + `C${cx - ox} ${cy + ry} ${cx - rx} ${cy + oy} ${cx - rx} ${cy}Z`;
}

function pointsPath(points: string): string {
  const n = points.trim().split(/[\s,]+/).map(Number);
  let d = '';
  for (let k = 0; k + 1 < n.length; k += 2) d += `${k === 0 ? 'M' : 'L'}${n[k]} ${n[k + 1]}`;
  return d ? `${d}Z` : '';
}

/** Mean scale of a matrix: what a stroke width or font size is multiplied by. */
function lengthScale(m: AffineMatrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

interface Ctx {
  matrix: AffineMatrix;
  bold: boolean;
  italic: boolean;
  strokeWidth: number | undefined;
}

/** A path of straight segments only: a line, never a filled shape. */
const LINE_ONLY_RE = /^[\sMLHVmlhv\d.,eE+-]*$/;

const BOLD_CLASSES = new Set(['ending', 'fing', 'reh', 'tempo']);
const ITALIC_CLASSES = new Set(['dir', 'dynam', 'mNum']);

function leafRuns(el: El, inherited: number): Array<{ text: string; size: number; style?: string; weight?: string }> {
  const size = el.attrs['font-size'] !== undefined ? num(el.attrs['font-size'], inherited) : inherited;
  const own = el.text.replace(/\s+/g, ' ');
  const out: Array<{ text: string; size: number; style?: string; weight?: string }> = [];
  if (own.trim()) out.push({ text: own.trim(), size, style: el.attrs['font-style'], weight: el.attrs['font-weight'] });
  for (const c of el.children) {
    if (c.name !== 'tspan') continue;
    for (const r of leafRuns(c, size)) {
      out.push({ ...r, style: r.style ?? el.attrs['font-style'], weight: r.weight ?? el.attrs['font-weight'] });
    }
  }
  return out;
}

/**
 * Flatten a Verovio page SVG into items in px of a slice `widthPx` wide.
 * Returns the items and the slice height, or null when the markup is not
 * Verovio's.
 */
export function flattenVerovioSvg(svg: string, widthPx: number): { items: ScoreItem[]; heightPx: number } | null {
  const root = parse(svg);
  if (!root) return null;
  const inner = root.children.find((c) => c.name === 'svg') ?? root;
  const vb = (inner.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !(vb[2]! > 0) || !(vb[3]! > 0)) return null;
  const s = widthPx / vb[2]!;
  const base = multiply(scaleMatrix(s, s), [1, 0, 0, 1, -vb[0]!, -vb[1]!]);
  const heightPx = vb[3]! * s;

  const defs = new Map<string, El>();
  const collectDefs = (el: El): void => {
    for (const c of el.children) {
      if (c.name === 'defs') {
        for (const d of c.children) if (d.attrs.id) defs.set(d.attrs.id, d);
      } else {
        collectDefs(c);
      }
    }
  };
  collectDefs(root);

  const items: ScoreItem[] = [];
  const pushPath = (d: string, ctx: Ctx, el: El): void => {
    if (!d) return;
    const fillAttr = el.attrs.fill;
    const sw = el.attrs['stroke-width'] !== undefined ? num(el.attrs['stroke-width']) : ctx.strokeWidth;
    const path = transformPath(d, ctx.matrix);
    const stroked = sw !== undefined && sw > 0;
    const filled = fillAttr !== 'none';
    // Verovio strokes staff lines, ledger lines and bar lines with the
    // stylesheet's `stroke: currentColor`; their `fill` is left to the
    // default black, which on a path of straight lines paints nothing. Slurs
    // and ties are curves both filled and stroked.
    if (filled && !(stroked && el.name === 'path' && LINE_ONLY_RE.test(d))) {
      items.push({ type: 'path', d: path, fill: true });
    }
    if (stroked) {
      items.push({
        type: 'path',
        d: path,
        fill: false,
        strokeWidth: sw! * lengthScale(ctx.matrix),
        ...(el.attrs['stroke-linecap'] ? { lineCap: el.attrs['stroke-linecap'] as 'butt' | 'round' | 'square' } : {}),
      });
    }
  };

  const walk = (el: El, parent: Ctx): void => {
    if (el.name === 'defs' || el.name === 'style' || el.name === 'desc' || el.name === 'title') return;
    let matrix = parent.matrix;
    if (el.attrs.transform) matrix = multiply(matrix, parseSvgTransform(el.attrs.transform));
    const classes = (el.attrs.class ?? '').split(/\s+/);
    const ctx: Ctx = {
      matrix,
      bold: parent.bold || classes.some((c) => BOLD_CLASSES.has(c)),
      italic: parent.italic || classes.some((c) => ITALIC_CLASSES.has(c)),
      strokeWidth: el.attrs['stroke-width'] !== undefined ? num(el.attrs['stroke-width']) : parent.strokeWidth,
    };
    switch (el.name) {
      case 'svg':
        if (el !== inner && el !== root) {
          // A nested viewport (Verovio uses none inside a system; skip safely).
          return;
        }
        break;
      case 'g':
        break;
      case 'use': {
        const ref = defs.get((el.attrs.href ?? '').replace(/^#/, ''));
        if (!ref) return;
        const m = multiply(ctx.matrix, [1, 0, 0, 1, num(el.attrs.x), num(el.attrs.y)]);
        walk(ref, { ...ctx, matrix: m });
        return;
      }
      case 'path':
        pushPath(el.attrs.d ?? '', ctx, el);
        return;
      case 'rect':
        pushPath(rectPath(num(el.attrs.x), num(el.attrs.y), num(el.attrs.width), num(el.attrs.height)), ctx, el);
        return;
      case 'polygon':
        pushPath(pointsPath(el.attrs.points ?? ''), ctx, el);
        return;
      case 'polyline': {
        const d = pointsPath(el.attrs.points ?? '').replace(/Z$/, '');
        pushPath(d, { ...ctx, strokeWidth: ctx.strokeWidth ?? 1 }, { ...el, attrs: { ...el.attrs, fill: 'none' } });
        return;
      }
      case 'ellipse':
      case 'circle': {
        const rx = num(el.attrs.rx ?? el.attrs.r);
        const ry = num(el.attrs.ry ?? el.attrs.r);
        pushPath(ellipsePath(num(el.attrs.cx), num(el.attrs.cy), rx, ry), ctx, el);
        return;
      }
      case 'text': {
        const runs = leafRuns(el, num(el.attrs['font-size'], 0));
        const text = runs.map((r) => r.text).join('');
        const size = runs.find((r) => r.size > 0)?.size ?? 0;
        if (!text || !(size > 0)) return;
        const [x, y] = [num(el.attrs.x), num(el.attrs.y)];
        const m = ctx.matrix;
        const k = lengthScale(m);
        const anchor = el.attrs['text-anchor'];
        items.push({
          type: 'text',
          x: m[0] * x + m[2] * y + m[4],
          y: m[1] * x + m[3] * y + m[5],
          text,
          sizePx: size * k,
          bold: ctx.bold || runs.some((r) => r.weight === 'bold'),
          italic: ctx.italic || runs.some((r) => r.style === 'italic'),
          ...(anchor === 'middle' || anchor === 'end' ? { anchor } : {}),
        });
        return;
      }
      default:
        break;
    }
    for (const c of el.children) walk(c, ctx);
  };

  const start: Ctx = { matrix: base, bold: false, italic: false, strokeWidth: undefined };
  for (const c of inner.children) walk(c, start);
  return { items, heightPx };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Plain SVG for a flattened system: paths and text, `currentColor` ink, the
 * text in `textFont`. HTML inlines it; the PDF backend draws it with its SVG
 * vector subset.
 */
export function itemsToSvg(items: readonly ScoreItem[], widthPx: number, heightPx: number, color: string, textFont: string): string {
  const out: string[] = [];
  for (const it of items) {
    if (it.type === 'path') {
      out.push(it.fill
        ? `<path d="${it.d}" fill="${color}"/>`
        : `<path d="${it.d}" fill="none" stroke="${color}" stroke-width="${r2(it.strokeWidth ?? 1)}"${it.lineCap ? ` stroke-linecap="${it.lineCap}"` : ''}/>`);
    } else {
      out.push(`<text x="${r2(it.x)}" y="${r2(it.y)}" font-size="${r2(it.sizePx)}"${it.bold ? ' font-weight="bold"' : ''}${it.italic ? ' font-style="italic"' : ''}${it.anchor ? ` text-anchor="${it.anchor}"` : ''} fill="${color}">${esc(it.text)}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(widthPx)}" height="${r2(heightPx)}" viewBox="0 0 ${r2(widthPx)} ${r2(heightPx)}" font-family="${esc(textFont)}">${out.join('')}</svg>`;
}

