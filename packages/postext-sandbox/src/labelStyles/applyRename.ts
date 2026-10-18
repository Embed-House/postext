/**
 * Renaming a label style in the Sandbox (#994): the pictures' anchors and
 * the `::label` lines of every chapter that name the old id are rewritten
 * with it, so nothing is left flagged `labelStyleUnknown`. Written as steps
 * of the Sandbox's one history (#899), as a style rename is for frame
 * styles: one step per chapter changed, one per picture changed, then one
 * for the design, so Undo takes them back one at a time.
 */

import type { Dispatch } from 'react';
import type { LabelStyle, Resource } from 'postext';
import type { SandboxAction } from '../context/SandboxContext';
import { applyViewerEdit } from '../editor/viewerEdits';
import type { UsageChapter } from '../frameStyles/styleUsage';
import { renameAnchorStyle, renameLabelStyleChanges } from './labelRefs';

/** What a rename rewrote. */
export interface LabelStyleRenameResult {
  /** Anchors of pictures renamed, and the pictures they belong to. */
  anchors: number;
  resources: number;
  /** `::label` lines renamed and the chapters they stand in. */
  lines: number;
  chapters: number;
}

/** Rename style `from` to `to` in `styles` and everywhere the book names
 *  it. `styles` is the list as it stands (without the rename). */
export function applyLabelStyleRename(
  dispatch: Dispatch<SandboxAction>,
  styles: readonly LabelStyle[],
  from: string,
  to: string,
  book: { chapters: readonly UsageChapter[]; resources: readonly Resource[]; activeChapterId?: string },
): LabelStyleRenameResult {
  const result: LabelStyleRenameResult = { anchors: 0, resources: 0, lines: 0, chapters: 0 };
  for (const c of book.chapters) {
    const changes = renameLabelStyleChanges(c.markdown, from, to);
    if (changes.length === 0) continue;
    result.lines += changes.length;
    result.chapters++;
    if (c.id === book.activeChapterId) applyViewerEdit(dispatch, c.id, changes, c.markdown.length);
    else dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: c.id, changes, baseLength: c.markdown.length } });
  }
  for (const r of renameAnchorStyle(book.resources, from, to)) {
    result.resources++;
    result.anchors += r.anchors?.filter((a) => a.style === to).length ?? 0;
    dispatch({ type: 'UPSERT_RESOURCE', payload: { ...r, updatedAt: Date.now() }, history: { merge: false } });
  }
  const next = styles.map((s) => (s.id === from ? { ...s, id: to } : s));
  dispatch({ type: 'UPDATE_CONFIG', payload: { labelStyles: next }, history: { merge: false } });
  return result;
}
