/**
 * The exercises in a build (#1227): the resolved config with the chip and
 * paragraph styles every exercise style sets its exercises with, and the
 * expansion of a document's exercises against its page.
 */

import type { ContentBlock } from '../parse/index.js';
import type { LayoutContinuation, PostextConfig } from '../types.js';
import type { ResolvedConfig } from '../vdt.js';
import { exerciseSettingsOf } from '../defaults/exercises.js';
import { resolveChipStylesConfig } from '../defaults/chipStyles.js';
import { resolveParagraphStylesConfig } from '../defaults/paragraphStyles.js';
import { dimensionToPx } from '../units.js';
import { computeBaselineGrid } from '../pipeline/config.js';
import { exerciseChipStyles, exerciseParagraphStyles } from './styles.js';
import { expandExercises, type ExerciseExpansion } from './expand.js';
import { hasExercises } from './model.js';

const withStyles = new WeakMap<ResolvedConfig, ResolvedConfig>();

/** `resolved` with the chip and paragraph styles of every exercise style
 *  among its own (after them, so no fence's fallback finds them first). */
export function withExerciseStyles(resolved: ResolvedConfig, config: PostextConfig | undefined, locale: string | undefined): ResolvedConfig {
  const hit = withStyles.get(resolved);
  if (hit) return hit;
  const settings = exerciseSettingsOf(config, locale);
  const chips = resolveChipStylesConfig(settings.styles.flatMap(exerciseChipStyles));
  const paragraphs = resolveParagraphStylesConfig(settings.styles.flatMap(exerciseParagraphStyles), resolved.bodyText);
  const out: ResolvedConfig = {
    ...resolved,
    chipStyles: [...resolved.chipStyles, ...chips],
    paragraphStyles: [...resolved.paragraphStyles, ...paragraphs],
  };
  withStyles.set(resolved, out);
  return out;
}

/** The key carrying an exercise counter in `LayoutContinuation.statementCounters`. */
const COUNTER_PREFIX = 'exercise:';

/** The exercise counters a continuation carries. */
export function exerciseCountersOf(continuation: LayoutContinuation | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(continuation?.statementCounters ?? {})) {
    if (k.startsWith(COUNTER_PREFIX)) out[k.slice(COUNTER_PREFIX.length)] = v.counter;
  }
  return out;
}

/** The counters as `statementCounters` entries. */
export function exerciseCounterEntries(counters: Record<string, number>, heading: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number }): Record<string, { counter: number; heading: typeof heading }> {
  const out: Record<string, { counter: number; heading: typeof heading }> = {};
  for (const [k, v] of Object.entries(counters)) out[COUNTER_PREFIX + k] = { counter: v, heading };
  return out;
}

/** Whether the blocks need the expansion (an exercise or a `:::solutions`
 *  line). */
export function needsExerciseExpansion(blocks: readonly ContentBlock[]): boolean {
  return hasExercises(blocks) || blocks.some((b) => b.type === 'directive' && b.directiveName === 'solutions')
    || blocks.some((b) => b.type === 'containerStart' && (b.containerName === 'solution' || b.containerName === 'hint'));
}

/** Expand the exercises of `blocks` for a page of `resolved`, `measurePx`
 *  the width of the flow's first column. */
export function expandDocumentExercises(
  blocks: readonly ContentBlock[],
  resolved: ResolvedConfig,
  config: PostextConfig | undefined,
  locale: string | undefined,
  measurePx: number,
  continuation: LayoutContinuation | undefined,
): ExerciseExpansion {
  const dpi = resolved.page.dpi;
  const toPt = (px: number): number => (px * 72) / dpi;
  const bodyPx = dimensionToPx(resolved.bodyText.fontSize, dpi);
  return expandExercises(blocks, {
    settings: exerciseSettingsOf(config, locale),
    ...(locale ? { locale } : {}),
    ...(resolved.numerals ? { digits: resolved.numerals } : {}),
    ...(continuation?.headings ? { headings: continuation.headings } : {}),
    counters: exerciseCountersOf(continuation),
    bodySizePt: toPt(bodyPx),
    lineHeightPt: toPt(computeBaselineGrid(resolved)),
    measurePt: toPt(measurePx),
    bodyFont: resolved.bodyText.fontFamily,
    boxIds: new Set(resolved.calloutStyles.map((s) => s.id)),
  });
}
