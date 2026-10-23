/**
 * The `:::callout{type=…}` fences of a chapter (#873), read straight off
 * the Markdown so the frame-style library can count the boxes of every
 * style in every chapter, laid out or not, and rewrite the style a fence
 * names when two styles are merged or one is renamed.
 */

import type { TextChange } from '../book/textChanges.js';

/** A `:::callout` opening fence in a text. */
export interface CalloutFence {
  /** Offset of the fence line. */
  fenceStart: number;
  /** 0-based line of the fence. */
  line: number;
  /** The `type` value as written ('' when the fence names none). */
  type: string;
  /** Range of the value (inside its quotes); both at the fence's end when
   *  the fence has no `type`. */
  valueFrom: number;
  valueTo: number;
  /** The fence carries no `type` attribute. */
  missing: boolean;
}

// As the engine's DIRECTIVE_RE reads a trimmed line.
const CALLOUT_FENCE_RE = /^\s*:::\s*callout(?:\s*\{([^}]*)\})?\s*$/;
const CODE_FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
// `=` or the fullwidth `＝` a Chinese input method types, as the engine.
const TYPE_ATTR_RE = /(^|\s)type\s*[=＝]\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/;

/** Every `:::callout` fence of `markdown`, outside code blocks. */
export function calloutFences(markdown: string): CalloutFence[] {
  const out: CalloutFence[] = [];
  let offset = 0;
  let code: string | null = null;
  const lines = markdown.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
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
    const m = CALLOUT_FENCE_RE.exec(line);
    if (!m) continue;
    const blob = m[1];
    const t = blob !== undefined ? TYPE_ATTR_RE.exec(blob) : null;
    if (!t) {
      const at = start + line.trimEnd().length;
      out.push({ fenceStart: start, line: n, type: '', valueFrom: at, valueTo: at, missing: true });
      continue;
    }
    const value = t[2] ?? t[3] ?? t[4] ?? '';
    const quoted = t[2] !== undefined || t[3] !== undefined;
    const blobStart = start + line.indexOf('{') + 1;
    const valueEndInBlob = t.index + t[0].length - (quoted ? 1 : 0);
    const from = blobStart + valueEndInBlob - value.length;
    out.push({ fenceStart: start, line: n, type: value.trim(), valueFrom: from, valueTo: from + value.length, missing: false });
  }
  return out;
}

/** The changes that make every fence of `markdown` naming a key of
 *  `renames` name its value instead. */
export function retypeCalloutChanges(markdown: string, renames: ReadonlyMap<string, string>): TextChange[] {
  return calloutFences(markdown)
    .filter((f) => !f.missing && renames.has(f.type))
    .map((f) => ({ from: f.valueFrom, to: f.valueTo, insert: renames.get(f.type)!, expect: markdown.slice(f.valueFrom, f.valueTo) }));
}
