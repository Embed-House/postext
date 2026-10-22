'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutTemplate, PenLine } from 'lucide-react';
import { useSandboxDispatch, useSandboxLabels, useSandboxSelector } from '../context/SandboxContext.js';
import type { PanelId } from '../types/index.js';
import { SegmentedControl, announce } from '../ui/index.js';
import { EDIT_MODE_SHORTCUT, editModeNow, isEditModeShortcut, isMacKeyboard, useEditMode, type EditMode } from './editMode.js';

/** How the shortcut reads on this machine: ⌥⇧M on a Mac. */
export function editModeShortcutText(): string {
  return isMacKeyboard() ? '⌥⇧M' : EDIT_MODE_SHORTCUT;
}

/** The side panel that goes with a mode, when the other mode's is open:
 *  the Text panel for Content, the Design panel for Design. */
export function panelForMode(mode: EditMode, open: PanelId | null): PanelId | null {
  if (mode === 'design' && open === 'markdown') return 'config';
  if (mode === 'content' && open === 'config') return 'markdown';
  return null;
}

/**
 * The Content / Design switch (#864), always in the bar above the preview,
 * and its keys (Alt+Shift+M, ⌥⇧M) anywhere in the Sandbox. Switching
 * also swaps the Text and Design panels when one of them is open.
 */
export function EditModeSwitch({ icons = false }: { icons?: boolean }) {
  const labels = useSandboxLabels();
  const dispatch = useSandboxDispatch();
  const activePanel = useSandboxSelector((s) => s.activePanel);
  const panelRef = useRef(activePanel);
  panelRef.current = activePanel;
  const [mode, setMode] = useEditMode();

  const apply = useCallback((next: EditMode) => {
    setMode(next);
    const panel = panelForMode(next, panelRef.current);
    if (panel) dispatch({ type: 'SET_PANEL', payload: panel });
    announce(next === 'design' ? labels.editModeDesignHint : labels.editModeContentHint);
  }, [dispatch, labels, setMode]);

  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.repeat || !isEditModeShortcut(ev)) return;
      ev.preventDefault();
      applyRef.current(editModeNow() === 'content' ? 'design' : 'content');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Read after mounting: the server has no keyboard to name.
  const [keys, setKeys] = useState(EDIT_MODE_SHORTCUT);
  useEffect(() => setKeys(editModeShortcutText()), []);
  const hint = (text: string) => `${text} (${keys})`;
  return (
    <SegmentedControl<EditMode>
      value={mode}
      onValueChange={apply}
      ariaLabel={labels.editMode}
      size="sm"
      options={[
        {
          value: 'content',
          label: icons ? <PenLine size={13} aria-hidden="true" /> : (
            <span className="inline-flex items-center gap-1"><PenLine size={12} aria-hidden="true" />{labels.editModeContent}</span>
          ),
          title: hint(icons ? `${labels.editModeContent}: ${labels.editModeContentHint}` : labels.editModeContentHint),
        },
        {
          value: 'design',
          label: icons ? <LayoutTemplate size={13} aria-hidden="true" /> : (
            <span className="inline-flex items-center gap-1"><LayoutTemplate size={12} aria-hidden="true" />{labels.editModeDesign}</span>
          ),
          title: hint(icons ? `${labels.editModeDesign}: ${labels.editModeDesignHint}` : labels.editModeDesignHint),
        },
      ]}
    />
  );
}
