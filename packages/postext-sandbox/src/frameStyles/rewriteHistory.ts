/**
 * Applying a style merge or rename to the book on screen, and taking the
 * last one back (#873): the style list, the template frames and the
 * rewritten fences of every chapter go back as one step. The frame-style
 * library shows the last change with an Undo button.
 */

import type { Dispatch } from 'react';
import type { PostextConfig } from 'postext';
import type { SandboxAction } from '../context/SandboxContext';
import { undoOf, type StyleRewritePlan, type StyleRewriteUndo } from './styleMerge';

export interface StyleRewriteRecord {
  /** What the library says was done. */
  message: string;
  undo: StyleRewriteUndo;
}

let last: StyleRewriteRecord | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeStyleRewrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lastStyleRewrite(): StyleRewriteRecord | null {
  return last;
}

/** Write `plan` into the book: one `UPDATE_CONFIG` for the styles and the
 *  templates, one `EDIT_CHAPTER_MARKDOWN` per chapter it rewrites. */
export function applyStyleRewrite(
  dispatch: Dispatch<SandboxAction>,
  config: Pick<PostextConfig, 'calloutStyles' | 'pageTemplates'>,
  plan: StyleRewritePlan,
  message: string,
): StyleRewriteRecord {
  const payload: Partial<PostextConfig> = { calloutStyles: plan.calloutStyles.length > 0 ? plan.calloutStyles : undefined };
  if (plan.pageTemplates !== config.pageTemplates) payload.pageTemplates = plan.pageTemplates;
  dispatch({ type: 'UPDATE_CONFIG', payload });
  for (const c of plan.chapters) {
    dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: c.chapterId, changes: c.changes, baseLength: c.baseLength } });
  }
  last = { message, undo: undoOf(config, plan) };
  emit();
  return last;
}

/** Put the book back as it was before the last rewrite. A chapter edited
 *  since keeps its text (its changes would land on other characters);
 *  the number of such chapters is returned. */
export function undoStyleRewrite(dispatch: Dispatch<SandboxAction>, chapterLength: (chapterId: string) => number | undefined): number | null {
  const record = last;
  if (!record) return null;
  const { undo } = record;
  dispatch({ type: 'UPDATE_CONFIG', payload: { calloutStyles: undo.calloutStyles, pageTemplates: undo.pageTemplates } });
  let skipped = 0;
  for (const c of undo.chapters) {
    if (chapterLength(c.chapterId) !== c.baseLength) {
      skipped++;
      continue;
    }
    dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: c.chapterId, changes: c.changes, baseLength: c.baseLength } });
  }
  last = null;
  emit();
  return skipped;
}

/** Forget the last rewrite (another book was opened). */
export function clearStyleRewrite(): void {
  if (!last) return;
  last = null;
  emit();
}
