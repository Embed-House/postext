/**
 * The drawn parts of an exercise (#1227, #1228): writing areas, and the
 * grids of word searches, crosswords and operations in columns. Each is a
 * frameless box whose design draws it — paths for the rules, texts for the
 * letters — so every output paints it as it paints any box design, a
 * right-to-left page mirrors it, and the layout places and keeps it whole.
 * Lengths are given in points.
 */

import type { CalloutStyleConfig, ColorValue, DesignElement, DesignPathElement, DesignTextElement, Dimension } from '../types.js';

const PT = (value: number): Dimension => ({ value: Math.round(value * 1000) / 1000, unit: 'pt' });
const ZERO = PT(0);

/** A frameless box drawn by `elements`, `heightPt` tall. */
export function drawnBox(id: string, elements: DesignElement[], heightPt: number, marginTopPt = 3, marginBottomPt = 3): CalloutStyleConfig {
  return {
    id,
    title: '',
    backgroundEnabled: false,
    border: { enabled: false },
    padding: { top: ZERO, right: ZERO, bottom: ZERO, left: ZERO },
    stripe: { enabled: false },
    icon: { kind: 'none' },
    marker: { kind: 'none' },
    marginTop: PT(marginTopPt),
    marginBottom: PT(marginBottomPt),
    snapToGrid: false,
    keepTogether: true,
    design: { enabled: true, slot: { elements }, minHeight: PT(heightPt) },
  };
}

/** A path element over `[0, w] × [0, h]` points, from the box's top left. */
export function pathElement(id: string, d: string, wPt: number, hPt: number, stroke: ColorValue, widthPt: number, extra: Partial<DesignPathElement> = {}): DesignPathElement {
  return {
    kind: 'path',
    id,
    placement: { anchor: { to: 'container', edge: 'top-left' }, size: { width: PT(wPt), height: PT(hPt) } },
    d,
    viewBox: [Math.max(0.001, wPt), Math.max(0.001, hPt)],
    stroke,
    width: PT(widthPt),
    ...extra,
  };
}

/** A text element: `content` set in a box `wPt` × `hPt` at (`xPt`, `yPt`). */
export function textElement(id: string, content: string, xPt: number, yPt: number, wPt: number, hPt: number, sizePt: number, extra: Partial<DesignTextElement> = {}): DesignTextElement {
  return {
    kind: 'text',
    id,
    content: content.replace(/[{}]/g, (c) => (c === '{' ? '\uFF5B' : '\uFF5D')),
    fontSize: PT(sizePt),
    align: 'center',
    verticalAlign: 'middle',
    overflow: 'clip',
    placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: PT(xPt), y: PT(yPt) }, size: { width: PT(wPt), height: PT(hPt) } },
    ...extra,
  };
}

const r = (n: number): string => String(Math.round(n * 100) / 100);

export type AreaKind = 'lines' | 'dots' | 'grid' | 'seyes' | 'tianzige' | 'box' | 'none';

export interface AreaSpec {
  kind: AreaKind;
  lines: number;
  /** Distance between two lines (the side of a grid's square), points. */
  spacingPt: number;
  /** The room the area may take across, points. */
  widthPt: number;
  color: ColorValue;
  weightPt: number;
  /** Answers written on the lines (a teacher's edition), one a line, in
   *  `answerColor`. */
  answers?: string[];
  answerColor?: ColorValue;
  answerSizePt?: number;
  answerFont?: string;
}

/** The elements and height of a writing area. */
export function areaElements(a: AreaSpec): { elements: DesignElement[]; heightPt: number } {
  const n = Math.max(1, Math.floor(a.lines));
  const sp = a.spacingPt;
  const w = a.widthPt;
  const els: DesignElement[] = [];
  let h = n * sp;
  switch (a.kind) {
    case 'lines': case 'dots': {
      let d = '';
      for (let i = 0; i < n; i++) d += `M0 ${r((i + 0.85) * sp)}H${r(w)}`;
      els.push(pathElement('area', d, w, h, a.color, a.weightPt, a.kind === 'dots' ? { dash: [PT(a.weightPt * 1.2), PT(a.weightPt * 3)] } : {}));
      break;
    }
    case 'grid': case 'tianzige': {
      const cols = Math.max(1, Math.floor(w / sp));
      const gw = cols * sp;
      let d = '';
      for (let i = 0; i <= n; i++) d += `M0 ${r(i * sp)}H${r(gw)}`;
      for (let j = 0; j <= cols; j++) d += `M${r(j * sp)} 0V${r(h)}`;
      els.push(pathElement('area', d, gw, h, a.color, a.weightPt));
      if (a.kind === 'tianzige') {
        let x = '';
        for (let i = 0; i < n; i++) x += `M0 ${r((i + 0.5) * sp)}H${r(gw)}`;
        for (let j = 0; j < cols; j++) x += `M${r((j + 0.5) * sp)} 0V${r(h)}`;
        els.push(pathElement('cross', x, gw, h, a.color, a.weightPt * 0.6, { dash: [PT(a.weightPt * 3), PT(a.weightPt * 3)] }));
      }
      break;
    }
    case 'seyes': {
      // French Seyès ruling: a heavy line every `sp`, three light ones
      // between, light verticals every `sp`, a margin line on the left.
      let heavy = '';
      let light = '';
      const cols = Math.max(1, Math.floor(w / sp));
      for (let i = 0; i < n; i++) {
        heavy += `M0 ${r((i + 1) * sp)}H${r(w)}`;
        for (let k = 1; k < 4; k++) light += `M0 ${r((i + k / 4) * sp)}H${r(w)}`;
      }
      for (let j = 1; j <= cols; j++) light += `M${r(j * sp)} 0V${r(h)}`;
      h = n * sp + a.weightPt;
      els.push(pathElement('light', light, w, h, a.color, a.weightPt * 0.5));
      els.push(pathElement('heavy', heavy, w, h, a.color, a.weightPt));
      break;
    }
    case 'box':
      els.push(pathElement('area', `M0 0H${r(w)}V${r(h)}H0Z`, w, h, a.color, a.weightPt));
      break;
    case 'none':
      break;
  }
  if (a.answers && a.answerColor) {
    const size = a.answerSizePt ?? sp * 0.6;
    a.answers.slice(0, n).forEach((text, i) => {
      if (!text) return;
      els.push(textElement(`answer${i}`, text, sp * 0.15, i * sp, w - sp * 0.3, sp * 0.85, size, {
        align: 'start', verticalAlign: 'bottom', color: a.answerColor, overflow: 'ellipsis-end', ...(a.answerFont ? { fontFamily: a.answerFont } : {}),
      }));
    });
  }
  return { elements: els, heightPt: h };
}
