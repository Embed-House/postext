import type { AnchorMark, ContentBlock } from './types';

/** A `\label{…}` in TeX: the identifier a `\eqref`, `\ref` or `:ref`
 *  names (#530), trimmed; `tex.slice(start, end)` is the whole command. */
export interface TexLabel {
  label: string;
  start: number;
  end: number;
}

/** Every `\label{…}` of a TeX source, in order, as
 *  `/\\label\{\s*([^{}]*?)\s*\}/g` finds them: a braced group holding no
 *  brace. A scan in one pass (the expression backtracks over spaces). */
export function texLabelMatches(tex: string): TexLabel[] {
  const out: TexLabel[] = [];
  for (let i = tex.indexOf('\\label{'); i >= 0; ) {
    let j = i + 7;
    while (j < tex.length && tex[j] !== '{' && tex[j] !== '}') j++;
    if (j === tex.length) break;
    if (tex[j] === '}') {
      out.push({ label: tex.slice(i + 7, j).trim(), start: i, end: j + 1 });
      i = tex.indexOf('\\label{', j + 1);
    } else i = tex.indexOf('\\label{', i + 1);
  }
  return out;
}

/** The labels of a TeX source, in order. */
export function texLabels(tex: string): string[] {
  return texLabelMatches(tex).map((m) => m.label).filter((label) => label);
}

/**
 * A `\label{eq:x}` in a display formula (#530) is an anchor on the formula:
 * where a reference to it jumps and whose page it prints. The anchor sits
 * on the formula's first source character; the mark's range is the
 * `\label{…}` itself, so a duplicate is reported where it is written.
 */
export function attachEquationAnchors<T extends { blocks: ContentBlock[] }>(result: T, markdown: string): T {
  for (const b of result.blocks) {
    if (b.type !== 'mathDisplay' || !b.tex || !b.tex.includes('\\label')) continue;
    const marks: AnchorMark[] = [];
    const source = markdown.slice(b.sourceStart, b.sourceEnd);
    for (const m of texLabelMatches(source)) {
      if (!m.label) continue;
      marks.push({
        anchorId: m.label,
        sourceStart: b.sourceStart + m.start,
        sourceEnd: b.sourceStart + m.end,
        anchor: b.sourceStart,
        attach: 'after',
      });
    }
    if (marks.length > 0) b.anchorMarks = [...(b.anchorMarks ?? []), ...marks];
  }
  return result;
}
