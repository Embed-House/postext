/**
 * Named frame looks in the Markdown (#1089): the `look="…"` a
 * `:::frame{slot}` piece of a composed page writes, which the engine lays
 * over the frame's style and its template look (`frameLooks` in the
 * configuration defines each one). The editor's look picker writes it on
 * the piece the caret is in; the looks library counts the pieces that name
 * each look and carries a renamed id into them.
 *
 * Pure: chapter offsets.
 */

import type { TextChange } from '../book/textChanges.js';
import { pageSites, type SlotSite } from '../viewport/composed/slotSource.js';
import { templateFences } from './templateUsage.js';

/** A `:::frame` piece of a composed page, as the Markdown writes it. */
export type FramePiece = SlotSite & { kind: 'frame' };

/** Every `:::frame{slot}` piece of the composed pages of `markdown`, a grid
 *  item's members (written inside their item) included, in Markdown
 *  order. */
export function framePieces(markdown: string): FramePiece[] {
  const out: FramePiece[] = [];
  for (const f of templateFences(markdown)) {
    const sites = pageSites(markdown, f.fenceStart, markdown.length);
    for (const s of sites?.sites ?? []) if (s.kind === 'frame') out.push(s as FramePiece);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The innermost `:::frame` piece holding `offset` (its fence line counts
 *  as its own): a grid item's member before its item. Null outside every
 *  piece. */
export function framePieceAt(markdown: string, offset: number): FramePiece | null {
  let best: FramePiece | null = null;
  for (const p of framePieces(markdown)) {
    if (offset < p.start || offset > p.end) continue;
    if (!best || p.end - p.start < best.end - best.start) best = p;
  }
  return best;
}

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';

/** The whole `look="…"` attribute of a piece, a space before it included:
 *  the range a removal takes out. */
function lookAttributeRange(markdown: string, piece: FramePiece): { from: number; to: number } | null {
  const look = piece.look;
  if (!look) return null;
  let from = look.start;
  let to = look.end;
  if (markdown[to] === '"' || markdown[to] === "'") to++;
  if (markdown[from - 1] === '"' || markdown[from - 1] === "'") from--;
  while (isSpace(markdown[from - 1])) from--;
  if (markdown[from - 1] === '=') from--;
  while (isSpace(markdown[from - 1])) from--;
  if (markdown.slice(from - 4, from) !== 'look') return null;
  from -= 4;
  while (isSpace(markdown[from - 1])) from--;
  return { from, to };
}

/**
 * The change that makes `piece` name look `id` (`look="<id>"`), or name
 * none (`null`). Null when nothing changes, or when the fence cannot take
 * it (no attribute braces).
 */
export function frameLookChange(markdown: string, piece: FramePiece, id: string | null): TextChange | null {
  const current = piece.look?.text;
  if (id === null) {
    const range = lookAttributeRange(markdown, piece);
    return range ? { from: range.from, to: range.to, insert: '' } : null;
  }
  if (current === id) return null;
  if (piece.look) {
    const quoted = markdown[piece.look.start - 1] === '"' || markdown[piece.look.start - 1] === "'";
    return quoted ? { from: piece.look.start, to: piece.look.end, insert: id } : { from: piece.look.start, to: piece.look.end, insert: `"${id}"` };
  }
  if (piece.attrsEnd === undefined) return null;
  return { from: piece.attrsEnd, to: piece.attrsEnd, insert: ` look="${id}"` };
}

/** How many pieces of `markdown` name each look. */
export function lookUsage(markdown: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of framePieces(markdown)) {
    const id = p.look?.text.trim();
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** The changes that carry a look renamed from `from` to `to` into every
 *  piece of `markdown` that names it. */
export function renameLookChanges(markdown: string, from: string, to: string): TextChange[] {
  if (from === to) return [];
  return framePieces(markdown)
    .filter((p) => p.look?.text.trim() === from)
    .map((p) => ({ from: p.look!.start, to: p.look!.end, insert: to }));
}
