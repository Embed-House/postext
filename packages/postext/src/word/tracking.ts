// The character spacing of Word's paragraph styles (`w:spacing` in a style's
// run properties, #932), as the tracking of the Postext style each one
// becomes. The Markdown an import writes cannot carry it (a style is form,
// not content), so it is read apart: `wordStyleTracking` lists what the
// styles in use say, and `applyStyleTracking` puts it on the book's styles
// that set no tracking of their own.

import type { Dimension, PostextConfig } from '../types.js';
import type { WordBlock, WordDocument, WordStyle } from './model.js';
import type { ParagraphTarget, WordTemplate } from './template.js';
import { lookup } from './template.js';
import { paragraphTargetOf } from './toMarkdown.js';

/** The tracking of one Word paragraph style, on the Postext style it becomes. */
export interface StyleTracking {
  /** The Word style's name, as stored. */
  style: string;
  /** Where it goes: a paragraph style, a heading style or level, or the title of a callout type. */
  target: Extract<ParagraphTarget, { kind: 'paragraphs' | 'heading' | 'calloutTitle' }>;
  /** In em of the style's own size (`0.02em` = 2 % of the size). */
  letterSpacing: Dimension;
}

const MAX_CHAIN = 12;

/** The paragraph style ids the document's text uses, with how many paragraphs each has. */
function usedStyles(doc: WordDocument): Map<string, number> {
  const used = new Map<string, number>();
  const walk = (blocks: readonly WordBlock[]): void => {
    for (const b of blocks) {
      if (b.type === 'table') {
        for (const row of b.rows) for (const cell of row) walk(cell.blocks);
      } else {
        const id = b.styleId || doc.defaultParagraphStyle;
        used.set(id, (used.get(id) ?? 0) + 1);
        if (b.textBoxes) walk(b.textBoxes);
      }
    }
  };
  walk(doc.blocks);
  return used;
}

/** What a style sets, or what its nearest ancestor does. */
function inherited<T>(doc: WordDocument, style: WordStyle, pick: (s: WordStyle) => T | undefined): T | undefined {
  let s: WordStyle | undefined = style;
  for (let guard = 0; s && guard < MAX_CHAIN; guard++) {
    const v = pick(s);
    if (v !== undefined) return v;
    s = s.basedOn ? doc.styles.get(s.basedOn) : undefined;
  }
  return undefined;
}

/**
 * The tracking each paragraph style in use sets (own or inherited), on the
 * Postext style it maps to under `template`. A style that sets none, or
 * sets it to zero, is left out; so is a style that goes to body text, a
 * quote, a caption or anything else with no style of its own to carry it.
 * Where two Word styles go to the same Postext style, the one with more
 * paragraphs wins.
 */
export function wordStyleTracking(doc: WordDocument, template: WordTemplate, config: PostextConfig): StyleTracking[] {
  const used = [...usedStyles(doc)].sort((a, b) => b[1] - a[1]);
  const out: StyleTracking[] = [];
  const seen = new Set<string>();
  for (const [id] of used) {
    const style = doc.styles.get(id);
    if (!style || style.type !== 'paragraph') continue;
    const twentieths = inherited(doc, style, (s) => s.letterSpacing);
    if (!twentieths) continue;
    const target = lookup(template.paragraphs, style.name) ?? paragraphTargetOf(doc, id, template, config);
    if (target.kind !== 'paragraphs' && target.kind !== 'heading' && target.kind !== 'calloutTitle') continue;
    const key = JSON.stringify(target);
    if (seen.has(key)) continue;
    seen.add(key);
    const halfPoints = inherited(doc, style, (s) => s.fontSizeHalfPoints) ?? doc.defaultFontSizeHalfPoints ?? 20;
    const em = Math.round((twentieths / 20 / (halfPoints / 2)) * 10000) / 10000;
    if (!Number.isFinite(em) || em === 0) continue;
    out.push({ style: style.name, target, letterSpacing: { value: em, unit: 'em' } });
  }
  return out;
}

/**
 * `config` with the tracking set on each style it names that sets none of
 * its own: a paragraph style, a heading style, a heading level (an entry
 * is added to `headings.levels` when the level has none) or the title of a
 * listed callout style. Nothing the book already sets is changed. `applied`
 * lists what was set; `skipped` what the book already tracks, or has no
 * style for.
 */
export function applyStyleTracking(config: PostextConfig, tracking: readonly StyleTracking[]): { config: PostextConfig; applied: StyleTracking[]; skipped: StyleTracking[] } {
  const next: PostextConfig = { ...config };
  const applied: StyleTracking[] = [];
  const skipped: StyleTracking[] = [];
  const set = (done: boolean, t: StyleTracking): void => void (done ? applied : skipped).push(t);
  for (const t of tracking) {
    const target = t.target;
    if (target.kind === 'paragraphs') {
      const list = next.paragraphStyles;
      const i = list?.findIndex((s) => s.id === target.style) ?? -1;
      if (!list || i < 0 || list[i]!.letterSpacing !== undefined) {
        set(false, t);
        continue;
      }
      next.paragraphStyles = list.map((s, k) => (k === i ? { ...s, letterSpacing: t.letterSpacing } : s));
      set(true, t);
    } else if (target.kind === 'heading' && target.style) {
      const list = next.headingStyles;
      const i = list?.findIndex((s) => s.id === target.style) ?? -1;
      if (!list || i < 0 || list[i]!.letterSpacing !== undefined) {
        set(false, t);
        continue;
      }
      next.headingStyles = list.map((s, k) => (k === i ? { ...s, letterSpacing: t.letterSpacing } : s));
      set(true, t);
    } else if (target.kind === 'heading') {
      const levels = next.headings?.levels ?? [];
      const i = levels.findIndex((l) => l.level === target.level);
      if (i >= 0 && levels[i]!.letterSpacing !== undefined) {
        set(false, t);
        continue;
      }
      next.headings = {
        ...next.headings,
        levels: i >= 0 ? levels.map((l, k) => (k === i ? { ...l, letterSpacing: t.letterSpacing } : l)) : [...levels, { level: target.level, letterSpacing: t.letterSpacing }],
      };
      set(true, t);
    } else {
      const list = next.calloutStyles;
      const i = list?.findIndex((s) => s.id === target.type) ?? -1;
      if (!list || i < 0 || list[i]!.titleStyle?.letterSpacing !== undefined) {
        set(false, t);
        continue;
      }
      next.calloutStyles = list.map((s, k) => (k === i ? { ...s, titleStyle: { ...s.titleStyle, letterSpacing: t.letterSpacing } } : s));
      set(true, t);
    }
  }
  return { config: next, applied, skipped };
}
