// Music scores (#1172): a notation fence is engraved at the width of the
// flow's column and expanded into one `score` block per system. Each system
// is then placed like a display formula — a single line of its own height,
// never cut — so a long score runs on over columns and pages, breaking only
// between systems.

import type { ContentBlock, ScoreBlockInfo } from '../parse/types.js';
import type { VDTScoreInfo } from '../vdt.js';
import type { ResolvedConfig } from '../vdt.js';
import type { ResolvedScoreStyleConfig } from '../types.js';
import type { BlockStyle } from './styles.js';
import { pickScoreStyle } from '../defaults/scoreStyle.js';
import { dimensionToPx } from '../units.js';
import { buildFontString } from '../measure/font.js';
import { computeBaselineGrid } from './config.js';
import { renderScore } from '../music/engine.js';
import type { ScoreRenderOptions } from '../music/types.js';

/** Whether parsed content holds a score: the host starts the engraver. */
export function blocksHaveScore(blocks: readonly ContentBlock[]): boolean {
  return blocks.some((b) => b.type === 'score');
}

/** The style a score fence picks with `style="…"`. */
export function scoreStyleOf(block: ContentBlock, resolved: ResolvedConfig): ResolvedScoreStyleConfig {
  const id = block.score?.attrs.style;
  return pickScoreStyle(resolved, typeof id === 'string' ? id : undefined);
}

export function scoreRenderOptions(style: ResolvedScoreStyleConfig, resolved: ResolvedConfig): ScoreRenderOptions {
  const dpi = resolved.page.dpi;
  return {
    staffSizePx: Math.max(4, dimensionToPx(style.staffSize, dpi)),
    font: style.musicFont,
    textFont: style.textFont,
    spacing: style.spacing,
    barNumbers: style.barNumbers,
    systemSpacing: 0,
  };
}

/** A placeholder system the size of one staff with room around it: what a
 *  score is set as while the engraver loads (or when its notation does
 *  not load). */
function placeholderHeight(options: ScoreRenderOptions): number {
  return options.staffSizePx * 2.5;
}

/**
 * Expand each `score` block into one block per engraved system, laid out
 * `widthPx` wide. A block keeps the fence's source range; the systems after
 * the first carry an empty one at its end.
 */
export function expandScoreBlocks(
  blocks: readonly ContentBlock[],
  resolved: ResolvedConfig,
  widthPx: number,
): { blocks: ContentBlock[]; expanded: boolean } {
  if (!blocksHaveScore(blocks)) return { blocks: blocks as ContentBlock[], expanded: false };
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    const score = b.score;
    if (b.type !== 'score' || !score) { out.push(b); continue; }
    const style = scoreStyleOf(b, resolved);
    const options = scoreRenderOptions(style, resolved);
    const render = renderScore(score.source, score.format, Math.max(40, widthPx), options);
    const meta = {
      ...(render.title ? { title: render.title } : {}),
      ...(render.composer ? { composer: render.composer } : {}),
    };
    if (render.systems.length === 0) {
      out.push({
        ...b,
        score: {
          ...score, ...meta, index: 0, count: 1,
          system: { widthPx, heightPx: placeholderHeight(options), items: [], svg: '', textFont: options.textFont ?? '' },
          ...(render.error ? { error: render.error } : {}),
        },
      });
      continue;
    }
    const count = render.systems.length;
    render.systems.forEach((system, index) => {
      out.push({
        ...b,
        ...(index > 0 ? { sourceStart: b.sourceEnd } : {}),
        score: { ...score, ...meta, system, index, count },
      });
    });
  }
  return { blocks: out, expanded: true };
}

/** Block style of one system: the score's margins above its first system
 *  and below its last, the system gap between two. */
export function resolveScoreBlockStyle(block: ContentBlock, resolved: ResolvedConfig): BlockStyle {
  const dpi = resolved.page.dpi;
  const style = scoreStyleOf(block, resolved);
  const fontSizePx = dimensionToPx(resolved.bodyText.fontSize, dpi);
  const index = block.score?.index ?? 0;
  const count = block.score?.count ?? 1;
  return {
    fontString: buildFontString(style.textFont, fontSizePx, '400'),
    fontSizePx,
    lineHeightPx: computeBaselineGrid(resolved),
    color: style.color.hex,
    textAlign: 'left',
    hyphenate: false,
    marginTopPx: index === 0 ? dimensionToPx(style.marginTop, dpi, fontSizePx) : dimensionToPx(style.systemGap, dpi, fontSizePx),
    marginBottomPx: index === count - 1 ? dimensionToPx(style.marginBottom, dpi, fontSizePx) : 0,
    firstLineIndentPx: 0,
    hangingIndent: false,
  };
}

/** What a VDT block keeps of its score: its system's place, and on the
 *  first system the alt text (the fence's `alt`, else the title and
 *  composer read from the notation). */
export function scoreInfoOf(score: ScoreBlockInfo): VDTScoreInfo {
  const index = score.index ?? 0;
  const alt = typeof score.attrs.alt === 'string' && score.attrs.alt.trim() !== ''
    ? score.attrs.alt.trim()
    : [score.title, score.composer].filter(Boolean).join(', ');
  return { index, count: score.count ?? 1, ...(alt && index === 0 ? { alt } : {}) };
}
