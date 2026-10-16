/**
 * Which pages of a book use each page template (#863): the
 * `::::page{template=…}` fences of its chapters, read straight off the
 * Markdown so the Design panel can count them for every chapter, laid out
 * or not, and rewrite a fence's `template` when a page gets a variant of
 * its own.
 */

import type { TextChange } from '../book/textChanges';

/** A composed-page fence (`::::page{…}`, four or more colons) in a text. */
export interface TemplateFence {
  /** Offset of the fence line. */
  fenceStart: number;
  /** The `template` value as written ('' when the fence names none). */
  template: string;
  /** Range of the value (inside the quotes), or of the place a
   *  `template` attribute would go when there is none. */
  valueFrom: number;
  valueTo: number;
  /** The value is written without the attribute (`valueFrom` is where it
   *  goes, before the closing brace or after `page`). */
  missing: boolean;
  /** The fence carries `spread` (any value but `false`). */
  spread: boolean;
}

const PAGE_FENCE_RE = /^(\s{0,3})(:{4,})\s*page\s*(?:\{([^}]*)\})?\s*$/;
const CODE_FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const TEMPLATE_ATTR_RE = /(^|\s)template\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/;
const SPREAD_ATTR_RE = /(^|\s)spread(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+)))?(?=\s|$)/;

/** Every composed-page fence of `markdown`, outside code blocks. */
export function templateFences(markdown: string): TemplateFence[] {
  const out: TemplateFence[] = [];
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
    const m = PAGE_FENCE_RE.exec(line);
    if (!m) continue;
    const blob = m[3];
    if (blob === undefined) {
      const at = start + line.trimEnd().length;
      out.push({ fenceStart: start, template: '', valueFrom: at, valueTo: at, missing: true, spread: false });
      continue;
    }
    const blobStart = start + line.indexOf('{') + 1;
    const spreadMatch = SPREAD_ATTR_RE.exec(blob);
    const spreadValue = spreadMatch ? (spreadMatch[2] ?? spreadMatch[3] ?? spreadMatch[4]) : undefined;
    const spread = !!spreadMatch && spreadValue !== 'false';
    const t = TEMPLATE_ATTR_RE.exec(blob);
    if (!t) {
      const at = blobStart + blob.length;
      out.push({ fenceStart: start, template: '', valueFrom: at, valueTo: at, missing: true, spread });
      continue;
    }
    const value = t[2] ?? t[3] ?? t[4] ?? '';
    const quoted = t[2] !== undefined || t[3] !== undefined;
    const valueEndInBlob = t.index + t[0].length - (quoted ? 1 : 0);
    const from = blobStart + valueEndInBlob - value.length;
    out.push({ fenceStart: start, template: value, valueFrom: from, valueTo: from + value.length, missing: false, spread });
  }
  return out;
}

/** How many pages of the book each template lays out: one per fence, two
 *  for a spread (`spreadIds`, or a fence that says `spread`). */
export function countTemplatePages(
  chapters: readonly { markdown: string }[],
  spreadIds: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of chapters) {
    for (const f of templateFences(ch.markdown)) {
      if (!f.template) continue;
      const pages = f.spread || spreadIds.has(f.template) ? 2 : 1;
      counts.set(f.template, (counts.get(f.template) ?? 0) + pages);
    }
  }
  return counts;
}

/** The change that makes the fence at `fenceStart` name `template`. */
export function fenceTemplateChange(markdown: string, fenceStart: number, template: string): TextChange | null {
  const fence = templateFences(markdown).find((f) => f.fenceStart === fenceStart);
  if (!fence) return null;
  if (!fence.missing) {
    return { from: fence.valueFrom, to: fence.valueTo, insert: template, expect: markdown.slice(fence.valueFrom, fence.valueTo) };
  }
  const line = markdown.slice(fenceStart, markdown.indexOf('\n', fenceStart) < 0 ? markdown.length : markdown.indexOf('\n', fenceStart));
  const insert = line.includes('{') ? `${/[{\s]$/.test(markdown.slice(0, fence.valueFrom)) ? '' : ' '}template="${template}"` : `{template="${template}"}`;
  return { from: fence.valueFrom, to: fence.valueFrom, insert, expect: '' };
}

/** The changes that rename template `from` to `to` in every fence of
 *  `markdown` that names it. */
export function renameTemplateChanges(markdown: string, from: string, to: string): TextChange[] {
  return templateFences(markdown)
    .filter((f) => !f.missing && f.template === from)
    .map((f) => ({ from: f.valueFrom, to: f.valueTo, insert: to, expect: from }));
}
