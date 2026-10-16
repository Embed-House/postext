/**
 * Carrying a page selection out on the editors (#865): the Markdown
 * editor selects the element's source, the Design panel opens where its
 * form is edited, the Resources panel opens on its picture, the
 * page-template editor picks its frame.
 */

import type { Dispatch } from 'react';
import type { VDTDocument, VDTFrame } from 'postext';
import type { SandboxAction } from '../context/SandboxContext';
import type { Chapter, ComposedBook } from '../book/types';
import type { PanelId } from '../types';
import { toChapterFocus } from '../viewport/CanvasPreview/chapterFocus';
import { editModeNow, selectFrame } from '../editing/editMode';
import { requestSettingsSection } from '../context/settingsNavigation';
import { saveSettingsGroup } from '../storage/persistence';
import { headingInChapters, selectionTarget, type SelectionTarget } from './selectionTargets';
import type { PageSelection } from './pageSelection';
import type { SelectionApply } from './selectionStore';

export interface SelectionApplyDeps {
  dispatch: () => Dispatch<SandboxAction>;
  activePanel: () => PanelId | null;
  /** The book a page's offsets belong to. */
  sourceOfPage: (pageIndex: number) => ComposedBook | null;
  /** The chapters of the book: a contents entry finds its heading there. */
  chapters?: () => readonly Chapter[];
  /** A frame with nothing in it yet, in Content mode: the caret goes to
   *  its slot (written first when missing, #864). */
  openFrameSlot?: (pageIndex: number, frame: VDTFrame) => boolean;
}

/** Open a panel unless it is open. */
function openPanel(deps: SelectionApplyDeps, panel: PanelId): void {
  if (deps.activePanel() !== panel) deps.dispatch()({ type: 'SET_PANEL', payload: panel });
}

/** Carry `target` out (from `sel` on `doc`). True when it led somewhere. */
export function applyTarget(target: SelectionTarget, sel: PageSelection, doc: VDTDocument, deps: SelectionApplyDeps): boolean {
  const dispatch = deps.dispatch();
  switch (target.kind) {
    case 'caret':
    case 'markdown': {
      const book = deps.sourceOfPage(sel.pageIndex);
      const [anchor, head] = target.kind === 'caret' ? [target.offset, target.offset] : [target.start, target.end];
      openPanel(deps, 'markdown');
      dispatch({ type: 'SET_PENDING_EDITOR_FOCUS', payload: { ...toChapterFocus(book, anchor, head, false), fromViewer: true } });
      return true;
    }
    case 'heading': {
      const chapters = deps.chapters?.() ?? [];
      const hit = headingInChapters(chapters, target.bodyOffset, target.title);
      if (!hit) return false;
      openPanel(deps, 'markdown');
      dispatch({ type: 'SET_PENDING_EDITOR_FOCUS', payload: { chapterId: hit.chapterId, anchor: hit.start, head: hit.end, selectWord: false, fromViewer: true } });
      return true;
    }
    case 'resource':
      openPanel(deps, 'resources');
      dispatch({ type: 'SET_ACTIVE_RESOURCE', payload: target.resourceId });
      return true;
    case 'frame': {
      if (editModeNow() === 'design') {
        selectFrame({ pageIndex: sel.pageIndex, frameId: target.frame.id, name: target.frame.name, template: target.template, configPath: target.frame.configPath });
        openSettings(deps, 'page', 'pageTemplates');
        return true;
      }
      return deps.openFrameSlot?.(sel.pageIndex, target.frame) ?? false;
    }
    case 'settings':
      openSettings(deps, target.group, target.section);
      return true;
    case 'none':
      return false;
  }
}

/** Open the Design panel on a group, bringing a section into view. */
function openSettings(deps: SelectionApplyDeps, group: Parameters<typeof requestSettingsSection>[0]['group'], section: string | null): void {
  const open = deps.activePanel() === 'config';
  requestSettingsSection({ group, section });
  if (!open) {
    saveSettingsGroup(group);
    deps.dispatch()({ type: 'SET_PANEL', payload: 'config' });
  }
}

/** What carries a viewer's page selections out, in the mode of the
 *  moment. */
export function createSelectionApply(deps: SelectionApplyDeps): SelectionApply {
  return (sel, doc) => {
    applyTarget(selectionTarget(doc, sel, editModeNow()), sel, doc, deps);
  };
}
