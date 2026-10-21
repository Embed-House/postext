import type { VDTChip, VDTLineSegment } from '../vdt.js';

/** A chip opening or closing a line keeps no gap margin on that side, so it
 *  sits flush with the measure like a word. The pieces of a piece of
 *  inline code the line did not break inside are joined first
 *  ({@link joinCodePieces}). */
export function trimChipLineEdges(segments: VDTLineSegment[]): VDTLineSegment[] {
  segments = joinCodePieces(segments);
  if (segments.length === 0) return segments;
  let out = segments;
  const trim = (idx: number, side: 'marginLeft' | 'marginRight'): void => {
    const seg = out[idx]!;
    const m = seg.chip?.[side] ?? 0;
    if (m <= 0) return;
    if (out === segments) out = [...segments];
    out[idx] = { ...seg, width: seg.width - m, chip: { ...seg.chip!, [side]: 0 } };
  };
  trim(0, 'marginLeft');
  trim(out.length - 1, 'marginRight');
  return out;
}

/**
 * Inline code split at its spaces (#845, `InlineSpan.codeSpace`) is one box
 * again wherever a line holds two pieces of it: a piece, its space and the
 * next piece become one chip, the space a run as wide as the room between
 * the two pieces' text (the space's own width, which the measurer took the
 * two boxes' inner paddings and borders out of), so the line keeps the
 * width it was broken at. A piece that ends a line keeps its box; no chip
 * of the line keeps `joinNext`.
 */
export function joinCodePieces(segments: VDTLineSegment[]): VDTLineSegment[] {
  if (!segments.some((s) => s.chip?.joinNext)) return segments;
  const out: VDTLineSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i]!;
    while (seg.chip?.joinNext) {
      const a = seg.chip;
      // Every piece of a piece of code has the same box.
      const inner = 2 * (a.paddingX + a.borderWidth);
      // An empty code space (a break after a hyphen) leaves no segment: it
      // stands for minus the inner paddings.
      const spaced = segments[i + 1]?.kind === 'space';
      const space: Pick<VDTLineSegment, 'text' | 'width'> = spaced ? segments[i + 1]! : { text: '', width: -inner };
      const next = segments[i + (spaced ? 2 : 1)];
      const b = next?.chip;
      if (!b || a.order || b.order) break;
      const font = a.runs[a.runs.length - 1]?.fontString ?? b.runs[0]?.fontString ?? '';
      const rest = withoutJoin(a);
      seg = {
        ...seg,
        text: seg.text + space.text + next!.text,
        width: seg.width + space.width + next!.width,
        chip: {
          ...rest,
          runs: [...a.runs, ...(space.text ? [{ text: space.text, fontString: font, width: space.width + inner }] : []), ...b.runs],
          boxWidth: a.boxWidth + space.width + b.boxWidth,
          marginRight: b.marginRight,
          borderRadius: Math.max(a.borderRadius, b.borderRadius),
          ...(b.joinNext ? { joinNext: true } : {}),
        },
      };
      i += spaced ? 2 : 1;
    }
    if (seg.chip?.joinNext) seg = { ...seg, chip: withoutJoin(seg.chip) };
    out.push(seg);
  }
  return out;
}

function withoutJoin(chip: VDTChip): VDTChip {
  const out = { ...chip };
  delete out.joinNext;
  return out;
}
