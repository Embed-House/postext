/**
 * The label styles a book names (#994), read straight off its Markdown and
 * its resources so that the Label styles section can count what each style
 * serves and, when a style is renamed, rewrite what names it: the `style`
 * of a `::label[TEXT]{at=… style=…}` line in any chapter and the `style`
 * of an anchor of a picture.
 */

import type { Resource } from 'postext';
import type { TextChange } from '../book/textChanges';

/** A `style` attribute on a `::label` line. */
export interface LabelStyleRef {
  /** The style id as written. */
  style: string;
  /** Range of the value (inside its quotes). */
  from: number;
  to: number;
}

const CODE_FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
// `=` or the fullwidth `＝` a Chinese input method types, as the engine.
const STYLE_ATTR_RE = /(^|\s)style\s*[=＝]\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/;

/** The `style` attribute of every `::label` line of `markdown`, outside
 *  code blocks. A line is read as the parser reads it: it starts with
 *  `::label[` and ends with the attribute blob that follows the bracket. */
export function labelStyleRefs(markdown: string): LabelStyleRef[] {
  const out: LabelStyleRef[] = [];
  if (!markdown.includes('::label[')) return out;
  let offset = 0;
  let code: string | null = null;
  for (const line of markdown.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    const fence = CODE_FENCE_RE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      if (code === null) code = mark[0]!.repeat(mark.length);
      else if (mark[0] === code[0] && mark.length >= code.length) code = null;
      continue;
    }
    if (code !== null) continue;
    const trimmed = line.trimEnd();
    if (!trimmed.trimStart().startsWith('::label[') || !trimmed.endsWith('}')) continue;
    const open = trimmed.lastIndexOf('{');
    if (open < 0 || !trimmed.slice(0, open).trimEnd().endsWith(']')) continue;
    const blob = trimmed.slice(open + 1, trimmed.length - 1);
    const m = STYLE_ATTR_RE.exec(blob);
    if (!m) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    const quoted = m[2] !== undefined || m[3] !== undefined;
    const valueEndInBlob = m.index + m[0].length - (quoted ? 1 : 0);
    const from = start + open + 1 + valueEndInBlob - value.length;
    out.push({ style: value.trim(), from, to: from + value.length });
  }
  return out;
}

/** The changes that make every `::label` line of `markdown` naming `from`
 *  name `to` instead. */
export function renameLabelStyleChanges(markdown: string, from: string, to: string): TextChange[] {
  return labelStyleRefs(markdown)
    .filter((r) => r.style === from)
    .map((r) => ({ from: r.from, to: r.to, insert: to, expect: markdown.slice(r.from, r.to) }));
}

/** The resources whose anchors name style `from`, each with the anchors
 *  naming `to` instead; the others are not returned. */
export function renameAnchorStyle(resources: readonly Resource[], from: string, to: string): Resource[] {
  const out: Resource[] = [];
  for (const r of resources) {
    if (!r.anchors?.some((a) => a.style === from)) continue;
    out.push({ ...r, anchors: r.anchors.map((a) => (a.style === from ? { ...a, style: to } : a)) });
  }
  return out;
}

/** What names a label style: anchors of pictures and `::label` lines. */
export interface LabelStyleUse {
  anchors: number;
  lines: number;
}

/** How many anchors and label lines name each style id. `refs` are the
 *  `labelStyleRefs` of each chapter. */
export function labelStyleUsage(resources: readonly Resource[], refs: readonly (readonly LabelStyleRef[])[]): Map<string, LabelStyleUse> {
  const out = new Map<string, LabelStyleUse>();
  const of = (id: string): LabelStyleUse => {
    let u = out.get(id);
    if (!u) out.set(id, (u = { anchors: 0, lines: 0 }));
    return u;
  };
  for (const r of resources) for (const a of r.anchors ?? []) if (a.style) of(a.style).anchors++;
  for (const list of refs) for (const ref of list) if (ref.style) of(ref.style).lines++;
  return out;
}
