'use client';

import { useEffect, useRef } from 'react';
import { ArrowUpLeft, X } from 'lucide-react';
import { useSandboxDispatch, useSandboxDocRef, useSandboxDocSourceRef, useSandboxLabels, useSandboxSelector, useSandboxStateGetter } from '../context/SandboxContext.js';
import { onFrameEditorEvent } from '../templates/frameEvents.js';
import { createSelectionApply } from './applySelection.js';
import { IconButton, Tooltip, announce, cn } from '../ui/index.js';
import { altKeyText, useEditMode } from '../editing/editMode.js';
import { atLevel, breadcrumb, breadcrumbText, crumbText, type Crumb } from './pageSelection.js';
import { hasDesignTarget } from './selectionTargets.js';
import { clearPageSelection, climbPageSelection, followFrameEditor, pageSelectionNow, selectPageLevel, setSelectionChapters, setSelectionTemplates, usePageSelection } from './selectionStore.js';
import type { SandboxLabels } from '../types/labels.js';

/** The viewers that show the book's pages and share the selection. */
const PAGE_VIEWS = new Set(['canvas', 'folio', 'html']);

/** Where Esc climbs the selection: on the pages, in the Markdown editor
 *  (a selection made on a page lands there), on the path itself. Never in
 *  a field, a dialog, a menu or an open completion list. */
function escClimbs(ev: KeyboardEvent): boolean {
  if (ev.key !== 'Escape' || ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return false;
  const now = pageSelectionNow();
  if (!now || now.selection.origin !== 'page') return false;
  const target = ev.target as Element | null;
  if (target?.closest?.('[role="dialog"], [role="menu"], [role="listbox"], input, textarea, select')) return false;
  if (document.querySelector('.cm-tooltip-autocomplete')) return false;
  return true;
}

function crumbName(crumb: Crumb, labels: SandboxLabels): string {
  const text = crumbText(crumb, labels);
  const kind = crumb.kind === 'group' ? labels.selectionGroupLabel : crumb.kind === 'frame' ? labels.selectionFrameLabel : crumb.kind === 'design' ? labels.selectionDesignLabel : null;
  return kind ? kind.replace('__name__', crumb.name ?? '') : text;
}

/**
 * The path of the element picked on a page (#865): «Page 8 › cajas ›
 * dinero › paragraph 2». Each item picks its level; the levels a click
 * went through on its way up stay, dimmer, after the one picked. Esc
 * climbs one level. Shown over the foot of the canvas, the Folio and the
 * HTML pages while something is picked.
 */
export function SelectionBreadcrumb() {
  const labels = useSandboxLabels();
  const view = useSandboxSelector((s) => s.activeViewport);
  const getState = useSandboxStateGetter();
  const current = usePageSelection();
  const [mode] = useEditMode();

  // The chapters a contents entry's heading is looked for in.
  useEffect(() => {
    setSelectionChapters(() => getState().chapters);
    setSelectionTemplates(() => getState().config.pageTemplates);
    return () => {
      setSelectionChapters(null);
      setSelectionTemplates(null);
    };
  }, [getState]);

  // The template editor's picks and drags on the canvas (#863) are the
  // selection's too.
  const dispatch = useSandboxDispatch();
  const docRef = useSandboxDocRef();
  const sourceRef = useSandboxDocSourceRef();
  useEffect(() => {
    const apply = createSelectionApply({
      dispatch: () => dispatch,
      activePanel: () => getState().activePanel,
      sourceOfPage: () => sourceRef.current,
      chapters: () => getState().chapters,
    });
    return onFrameEditorEvent((e) => followFrameEditor(e, docRef.current, apply));
  }, [dispatch, docRef, sourceRef, getState]);

  // Esc climbs a selection made on a page, before the editor's own Esc
  // (which would only collapse the range the page selected there). Once
  // the reader moves the caret, the selection follows it and Esc is the
  // editor's again.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!escClimbs(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      climbPageSelection();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // A pick on a page is said (WCAG 4.1.3); the caret's path is not, it
  // moves with every key.
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const lastSaid = useRef('');
  useEffect(() => {
    if (!current || current.selection.origin !== 'page') return;
    const path = breadcrumbText(breadcrumb(current.doc, current.selection), labelsRef.current);
    if (path === lastSaid.current) return;
    lastSaid.current = path;
    announce(labelsRef.current.selectionAnnounce.replace('__path__', path));
  }, [current]);

  if (!current || !PAGE_VIEWS.has(view)) return null;
  const crumbs = breadcrumb(current.doc, current.selection);
  // Alt on an item opens the element's form — a frame's properties in its
  // template, a paragraph's style — without leaving Content mode (#864).
  // In Design mode a plain click already goes there, so nothing is said.
  const altOpensForm = (c: Crumb): boolean =>
    mode === 'content' && c.level !== null && hasDesignTarget(current.doc, atLevel(current.selection, c.level));
  const crumbTip = (c: Crumb): string =>
    altOpensForm(c)
      ? `${crumbName(c, labels)} · ${labels.selectionPropertiesHint.replace('__key__', altKeyText())}`
      : crumbName(c, labels);
  return (
    <nav
      aria-label={labels.selectionPath}
      className="pointer-events-auto absolute bottom-2 start-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-md border px-1 text-[0.72rem] leading-none shadow-sm"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--rule)', color: 'var(--foreground)' }}
      data-testid="page-selection-path"
    >
      <ol className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {crumbs.map((c, i) => (
          <li key={`${c.kind}-${c.level ?? 'p'}-${i}`} className="flex shrink-0 items-center gap-0.5">
            {i > 0 && <span aria-hidden="true" className="text-(--slate)">›</span>}
            <Tooltip content={crumbTip(c)}>
              <button
                type="button"
                disabled={c.level === null}
                aria-current={c.current ? 'true' : undefined}
                aria-label={crumbName(c, labels)}
                aria-keyshortcuts={altOpensForm(c) ? 'Alt+Enter' : undefined}
                onClick={(ev) => { if (c.level !== null) selectPageLevel(c.level, ev.altKey ? 'design' : undefined); }}
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center rounded px-1.5 whitespace-nowrap transition-colors pt-large:h-11 pt-large:px-2.5',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 outline-(--brand-hover)',
                  'enabled:hover:bg-(--background) disabled:cursor-default',
                  c.current ? 'font-semibold text-(--brand)' : c.inner ? 'text-(--slate) opacity-80' : 'text-(--foreground)',
                )}
              >
                {crumbText(c, labels)}
              </button>
            </Tooltip>
          </li>
        ))}
      </ol>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px" style={{ backgroundColor: 'var(--rule)' }} />
      <IconButton label={labels.selectionUp} icon={<ArrowUpLeft size={13} />} tooltipSide="top" onClick={() => climbPageSelection()} />
      <IconButton label={labels.selectionClear} icon={<X size={13} />} tooltipSide="top" onClick={() => clearPageSelection()} />
    </nav>
  );
}
