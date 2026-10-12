import { scriptMark, type ScriptContext } from '../measure/script';
import { paintAsOneRun } from './mirrorFrame';
import { letterSpacingOf, restoreContext, saveContext, setLetterSpacing } from './contextState';
import { contextTextWidth } from './contextText';

/**
 * A word with no letter painted in the script it was measured in (#725,
 * `VDTLineSegment.scriptContext`, `measure/script.ts`).
 *
 * A canvas has no way to name the script of a text; it shapes a word of
 * digits and punctuation in a script of its own choosing, which changed
 * between Chrome 131 (the font's default forms) and 154 (Latin ones). What
 * every version agrees on is that such characters take the script of the
 * text they stand in. So the word is painted beside its mark, a character
 * of the script glued to it with a no-break space (`scriptMark`), and the
 * mark is clipped away. The mark stands on the word's right in either
 * direction (after a left-to-right word; before a right-to-left one, whose
 * run then reads from the right), so the word starts at `x` as it would
 * alone, and the no-break space keeps the two from kerning: the word is
 * exactly as wide as the layout measured it.
 *
 * The two are one run for a mirrored page (`mirrorFrame.ts`): its frame
 * would turn the text back about the box of the word and its mark, and the
 * word would land the mark's width away. The run is turned once, about
 * the word's own box (`paintAsOneRun`), as a tracked word in pieces is
 * (#685).
 */

/** How far the clip reaches above and below the baseline, and to the
 *  word's left: past any ascender, descender or overhang. */
const REACH = 4096;

/** Font string → half the advance of the glue between a word and its
 *  mark: how far past its advance a word's last glyph may reach before
 *  the clip cuts it (an italic bracket overhangs a little). */
const slackByFont = new Map<string, number>();

function slackOf(ctx: CanvasRenderingContext2D, glue: string): number {
  const font = ctx.font;
  let slack = slackByFont.get(font);
  if (slack === undefined) {
    const spacing = letterSpacingOf(ctx);
    if (spacing !== 0) setLetterSpacing(ctx, 0);
    slack = contextTextWidth(ctx, glue) / 2;
    if (spacing !== 0) setLetterSpacing(ctx, spacing);
    if (slackByFont.size > 512) slackByFont.clear();
    slackByFont.set(font, Number.isFinite(slack) ? slack : 0);
  }
  return slack;
}

/**
 * Paint `text`, a word with no letter, in `script` with `paint` (the
 * caller's `fillText`) at `x`, `y`: its left end on a left-to-right page,
 * the start of its box in a mirrored frame. `rtl`: the word is a
 * right-to-left run, and the caller has set the context right to left and
 * aligned on its left edge (`fillSegmentWord`). The context's font, fill,
 * letter-spacing and direction are the caller's; they are left as found.
 */
export function fillScriptWord(
  ctx: CanvasRenderingContext2D,
  text: string,
  script: ScriptContext,
  rtl: boolean,
  x: number,
  y: number,
  paint: (text: string, x: number, y: number) => void,
): void {
  const { lead, trail } = scriptMark(script, rtl);
  // The word's advance as the context sets it, its tracking included: the
  // two together less the mark alone (nothing kerns across the glue).
  const width = contextTextWidth(ctx, lead + text + trail) - contextTextWidth(ctx, lead + trail);
  if (!(width > 0)) {
    paint(text, x, y);
    return;
  }
  const slack = slackOf(ctx, lead !== '' ? lead.slice(-1) : trail.slice(0, 1));
  paintAsOneRun(ctx, x, width, () => {
    saveContext(ctx);
    ctx.beginPath();
    ctx.rect(x - REACH, y - REACH, REACH + width + slack, 2 * REACH);
    ctx.clip();
    paint(lead + text + trail, x, y);
    restoreContext(ctx);
  });
}
