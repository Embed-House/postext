/**
 * Which pages of a book use each page template (#863): the
 * `::::page{template=…}` fences of its chapters, read straight off the
 * Markdown so the Design panel can count them for every chapter, laid out
 * or not, and rewrite a fence's `template` when a page gets a variant of
 * its own.
 */

import { fenceAttributesSet, parseDirectiveAttrs } from 'postext';
import type { TextChange } from '../book/textChanges.js';

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
  /** The fence's `id` (#943): a story of an earlier page may jump to it
   *  (`overflow.continueIn: 'page:<id>'`). */
  id?: string;
  /** The attributes the fence sets (#1087): written as a flag or with any
   *  value but `false`, `template`, `spread` and `id` included. */
  attrs: string[];
}

const PAGE_FENCE_RE = /^(\s{0,3})(:{4,})\s*page(?:\s*\{([^}]*)\})?\s*$/;
const CODE_FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const TEMPLATE_ATTR_RE = /(^|\s)template\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/;
const SPREAD_ATTR_RE = /(^|\s)spread(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+)))?(?=\s|$)/;
const ID_ATTR_RE = /(^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/;

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
      out.push({ fenceStart: start, template: '', valueFrom: at, valueTo: at, missing: true, spread: false, attrs: [] });
      continue;
    }
    const blobStart = start + line.indexOf('{') + 1;
    const attrs = fenceAttributesSet(parseDirectiveAttrs(blob));
    const spreadMatch = SPREAD_ATTR_RE.exec(blob);
    const spreadValue = spreadMatch ? (spreadMatch[2] ?? spreadMatch[3] ?? spreadMatch[4]) : undefined;
    const spread = !!spreadMatch && spreadValue !== 'false';
    const idMatch = ID_ATTR_RE.exec(blob);
    const idValue = idMatch ? (idMatch[2] ?? idMatch[3] ?? idMatch[4] ?? '').trim() : '';
    const id = idValue !== '' ? { id: idValue } : {};
    const t = TEMPLATE_ATTR_RE.exec(blob);
    if (!t) {
      const at = blobStart + blob.length;
      out.push({ fenceStart: start, template: '', valueFrom: at, valueTo: at, missing: true, spread, ...id, attrs });
      continue;
    }
    const value = t[2] ?? t[3] ?? t[4] ?? '';
    const quoted = t[2] !== undefined || t[3] !== undefined;
    const valueEndInBlob = t.index + t[0].length - (quoted ? 1 : 0);
    const from = blobStart + valueEndInBlob - value.length;
    out.push({ fenceStart: start, template: value, valueFrom: from, valueTo: from + value.length, missing: false, spread, ...id, attrs });
  }
  return out;
}

/** The ids of the book's page fences (#943), each once, in book order, with
 *  the chapter (0-based) that holds it: the pages a story may jump to. */
export function pageFenceIds(chapters: readonly { markdown: string }[]): { id: string; chapter: number }[] {
  const seen = new Set<string>();
  const out: { id: string; chapter: number }[] = [];
  chapters.forEach((ch, chapter) => {
    for (const f of templateFences(ch.markdown)) {
      if (f.id === undefined || seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, chapter });
    }
  });
  return out;
}

/** The attributes the book's page fences set (#1087), each once, in book
 *  order, without `template`, `spread` and `id`: what a design element's
 *  `when` / `unless` can name. */
export function pageFenceAttributes(chapters: readonly { markdown: string }[]): string[] {
  const seen = new Set<string>(['template', 'spread', 'id']);
  const out: string[] = [];
  for (const ch of chapters) {
    for (const f of templateFences(ch.markdown)) {
      for (const a of f.attrs) {
        if (seen.has(a)) continue;
        seen.add(a);
        out.push(a);
      }
    }
  }
  return out;
}

/** What a fence attribute typed for a `when` / `unless` condition is
 *  (#1095): a key a `::::page` line can write (ASCII, as the attribute
 *  grammar reads it), not one the page itself reads. */
export type FenceAttributeName = { ok: true; name: string } | { ok: false; reason: 'empty' | 'syntax' | 'reserved' };

const FENCE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const PAGE_OWN = new Set(['template', 'spread', 'id']);

/** `raw`, trimmed, as an attribute name a condition may test (#1095). */
export function fenceAttributeName(raw: string): FenceAttributeName {
  const name = raw.trim();
  if (name === '') return { ok: false, reason: 'empty' };
  if (name.length > 64 || !FENCE_KEY.test(name)) return { ok: false, reason: 'syntax' };
  if (PAGE_OWN.has(name)) return { ok: false, reason: 'reserved' };
  return { ok: true, name };
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

// ---------------------------------------------------------------------------
// Slot names (#979)
// ---------------------------------------------------------------------------

const PAGE_OPEN_RE = /^(\s{0,3})(:{4,})\s*page\s*(?:\{[^}]*\})?\s*$/;
const PAGE_CLOSE_RE = /^\s{0,3}(:{4,})\s*$/;
const SLOT_LINE_RE = /^\s*(?::{2,}[A-Za-z][\w-]*\s*\{|#{1,6}\s)/;
const ATTR_PAIR_RE = /([A-Za-z_][\w-]*)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"'}]+)/y;

/** The `slot` attribute of a line that opens a container, a leaf or a
 *  heading, with the range of its value (inside the quotes). Attributes are
 *  read one after the other, so `slot="x"` inside another value (a `label`)
 *  is never taken for the attribute. */
function slotOf(line: string): { value: string; from: number; to: number } | null {
  if (!SLOT_LINE_RE.test(line)) return null;
  const heading = /^\s*#{1,6}\s/.test(line);
  let at = heading ? line.lastIndexOf(' {') + 1 : line.indexOf('{');
  if (at <= 0 || (heading && !line.trimEnd().endsWith('}'))) return null;
  at += 1;
  for (;;) {
    while (at < line.length && /\s/.test(line[at]!)) at++;
    ATTR_PAIR_RE.lastIndex = at;
    const m = ATTR_PAIR_RE.exec(line);
    if (!m) return null;
    if (m[1] === 'slot') {
      const raw = m[2]!;
      const quoted = raw[0] === '"' || raw[0] === "'";
      const from = at + m[0].length - raw.length + (quoted ? 1 : 0);
      const value = quoted ? raw.slice(1, -1) : raw;
      return { value, from, to: from + value.length };
    }
    at += m[0].length;
  }
}

/** The changes that rename slot `from` to `to` in the pages of `markdown`
 *  whose fence names one of `templates` (a frame shared by several
 *  templates, `frameFamily`): the `slot` of a `:::frame`, a `::resource`, a
 *  `:::figure` or a heading, outside code blocks. */
export function renameSlotChanges(markdown: string, templates: ReadonlySet<string>, from: string, to: string): TextChange[] {
  const out: TextChange[] = [];
  let offset = 0;
  let code: string | null = null;
  let colons = 0;
  let open = false;
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
    const page = PAGE_OPEN_RE.exec(line);
    if (page) {
      const blob = line.includes('{') ? line.slice(line.indexOf('{') + 1) : '';
      const t = TEMPLATE_ATTR_RE.exec(blob);
      const id = t ? (t[2] ?? t[3] ?? t[4] ?? '') : '';
      open = templates.has(id);
      colons = page[2]!.length;
      continue;
    }
    if (open) {
      const close = PAGE_CLOSE_RE.exec(line);
      if (close && close[1]!.length >= colons) {
        open = false;
        continue;
      }
      const slot = slotOf(line);
      if (slot && slot.value === from) out.push({ from: start + slot.from, to: start + slot.to, insert: to, expect: from });
    }
  }
  return out;
}
