import { describe, expect, it } from 'vitest';
import { framePieceAt, framePieces, frameLookChange, lookUsage, renameLookChanges } from './frameLooks';
import type { TextChange } from '../book/textChanges';

// #1089: the look picker writes `look="…"` on the `:::frame` piece the
// caret is in; the looks library counts and renames.

const MD = [
  '# Animals',
  '',
  '::::page{template="fotos"}',
  ':::frame{slot="foto"}',
  '::resource{id="heron"}',
  '',
  ':::frame{slot="pie" look="pill-1"}',
  'The heron',
  ':::',
  ':::',
  '',
  ':::frame{slot="foto" look="teal"}',
  '::resource{id="otter"}',
  '',
  ':::frame{slot="pie"}',
  'The otter',
  ':::',
  ':::',
  '::::',
  '',
  ':::frame{slot="outside"}',
  'Not on a page.',
  ':::',
  '',
].join('\n');

const apply = (text: string, c: TextChange | null): string => (c ? text.slice(0, c.from) + c.insert + text.slice(c.to) : text);

describe('frame looks in the Markdown (#1089)', () => {
  it('finds the frame pieces of the pages, members included, with their looks', () => {
    const pieces = framePieces(MD);
    expect(pieces.map((p) => `${p.slot}:${p.look?.text ?? ''}`)).toEqual(['foto:', 'pie:pill-1', 'foto:teal', 'pie:']);
  });

  it('picks the innermost piece at the caret: a member before its item', () => {
    expect(framePieceAt(MD, MD.indexOf('The heron'))!.slot).toBe('pie');
    expect(framePieceAt(MD, MD.indexOf('::resource{id="otter"}'))!.slot).toBe('foto');
    expect(framePieceAt(MD, MD.indexOf('# Animals'))).toBeNull();
    // A :::frame outside a page fence is no piece.
    expect(framePieceAt(MD, MD.indexOf('Not on a page.'))).toBeNull();
  });

  it('writes, replaces and removes the look of a piece', () => {
    const otterPill = framePieceAt(MD, MD.indexOf('The otter'))!;
    const added = apply(MD, frameLookChange(MD, otterPill, 'pill-2'));
    expect(added).toContain(':::frame{slot="pie" look="pill-2"}\nThe otter');
    const heronPill = framePieceAt(MD, MD.indexOf('The heron'))!;
    const replaced = apply(MD, frameLookChange(MD, heronPill, 'pill-9'));
    expect(replaced).toContain(':::frame{slot="pie" look="pill-9"}\nThe heron');
    const removed = apply(MD, frameLookChange(MD, heronPill, null));
    expect(removed).toContain(':::frame{slot="pie"}\nThe heron');
    expect(removed.length).toBe(MD.length - ' look="pill-1"'.length);
    // Nothing to do: the same look, or none on a piece without one.
    expect(frameLookChange(MD, heronPill, 'pill-1')).toBeNull();
    expect(frameLookChange(MD, otterPill, null)).toBeNull();
  });

  it('reads an unquoted look and writes it quoted', () => {
    const md = '::::page{template="a"}\n:::frame{slot="x" look=teal}\nWords.\n:::\n::::\n';
    const piece = framePieceAt(md, md.indexOf('Words'))!;
    expect(piece.look?.text).toBe('teal');
    expect(apply(md, frameLookChange(md, piece, 'red'))).toContain(':::frame{slot="x" look="red"}');
    expect(apply(md, frameLookChange(md, piece, null))).toContain(':::frame{slot="x"}');
  });

  it('counts the pieces that name each look and renames them', () => {
    expect([...lookUsage(MD)]).toEqual([['pill-1', 1], ['teal', 1]]);
    let md = MD;
    for (const c of renameLookChanges(MD, 'teal', 'sea').reverse()) md = apply(md, c);
    expect(md).toContain(':::frame{slot="foto" look="sea"}');
    expect(renameLookChanges(MD, 'none', 'x')).toEqual([]);
  });
});
