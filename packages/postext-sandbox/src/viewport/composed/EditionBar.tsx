'use client';

/**
 * The editions of a book in several languages, over the canvas (#867):
 * one button per edition switches the book to it while staying on the
 * same composed page (the same fence, and the frame picked; its page
 * number may differ in that language), and «Side by side» shows the page
 * next to the same page of another edition. With them, the switch of the
 * reflow marks (#868).
 *
 * A rail at the start edge (#1009), the mirror of the toolbar at the end
 * edge: hidden until the pointer reaches that edge, gone again when it
 * leaves, kept open when pinned (`useFloatingToolbarShell`). The phone
 * layout docks it as a row at the top, as there is no hover there.
 */

import { Columns2, MoveDiagonal, Pin, PinOff } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useSandboxDocRef, useSandboxLabels, useSandboxSelector } from '../../context/SandboxContext';
import { selectedFrameNow } from '../../editing/editMode';
import { requestFrameJump } from '../../editions/frameJump';
import { useBookEditions } from '../../editions/useBookEditions';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { sameLocaleTag } from '../../presets/locale';
import { localeDisplayName, localeShortTag } from '../../presets/localeNames';
import { readViewHash } from '../../storage/viewHash';
import { useUiRtl } from '../../ui';
import { TOOLBAR_STYLE_BASE, ToolbarButton, ToolbarSeparator, toolbarHiddenStyle } from '../CanvasToolbar';
import { useFloatingToolbarShell } from '../useFloatingToolbarShell';
import { hasComposedPages } from './ReflowPanel';
import { useReflowShown } from './reflowView';

/** Over the side-by-side view (z-30), which it opens and closes. */
const RAIL_Z = 35;

const RAIL_COMPACT: CSSProperties = {
  position: 'absolute',
  insetInlineStart: 8,
  top: 8,
  zIndex: RAIL_Z,
  gap: 1,
  backgroundColor: 'var(--background)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  padding: 4,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
};

export function EditionRail({ comparing, onToggleCompare }: { comparing: boolean; onToggleCompare: () => void }) {
  const labels = useSandboxLabels();
  const uiLocale = useSandboxSelector((s) => s.locale);
  const chapters = useSandboxSelector((s) => s.chapters);
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  useSandboxSelector((s) => s.docVersion);
  const docRef = useSandboxDocRef();
  const { presetId, projectId, linked, locales, activeLocale } = useBookEditions(false);
  const [reflowShown, setReflowShown] = useReflowShown();
  const compact = useCompactLayout();
  const rtl = useUiRtl();
  const shell = useFloatingToolbarShell('canvas-editions', false, { edge: 'start', defaultPinned: false });

  const editions = (presetId !== null || projectId !== null) && locales.length >= 2;
  const reflow = hasComposedPages(docRef.current);
  if (!editions && !reflow) return null;

  const switchTo = (locale: string) => {
    if (sameLocaleTag(locale, activeLocale)) return;
    const hash = readViewHash();
    const doc = docRef.current;
    const page = doc && hash.page !== null ? doc.pages.find((p) => p.pageNumberValue === hash.page) : undefined;
    const chapterIndex = chapters.findIndex((c) => c.id === activeChapterId);
    const picked = selectedFrameNow();
    // A composed page is found again by its fence; any other page keeps
    // its number.
    requestFrameJump({
      presetId,
      projectId,
      linked,
      locale,
      chapterIndex: chapterIndex >= 0 ? chapterIndex : null,
      page: page?.composed ? null : hash.page,
      fenceIndex: page?.composed?.fenceIndex ?? null,
      frame: page?.composed && picked && page.composed.frames.some((f) => f.id === picked.frameId) ? picked.name : null,
      panel: 'markdown',
      keepEditor: true,
    });
  };

  const tooltipSide = 'inline-end' as const;
  const rootStyle: CSSProperties = compact
    ? RAIL_COMPACT
    : {
        ...TOOLBAR_STYLE_BASE,
        insetInlineEnd: undefined,
        insetInlineStart: 12,
        zIndex: RAIL_Z,
        maxHeight: `calc(100% - ${TOOLBAR_STYLE_BASE.top + 12}px)`,
        overflowY: 'auto',
        scrollbarWidth: 'none',
        ...toolbarHiddenStyle(shell.hidden, rtl, 'start'),
      };

  return (
    <>
      {!compact && <div {...shell.hoverStripProps} style={{ ...shell.hoverStripProps.style, zIndex: RAIL_Z }} />}
      <div
        role="toolbar"
        aria-label={labels.editionSwitch}
        aria-orientation={compact ? 'horizontal' : 'vertical'}
        className={compact ? 'flex flex-row items-center' : 'flex flex-col items-center'}
        style={rootStyle}
        data-edition-bar=""
        {...shell.toolbarHoverProps}
      >
        {!compact && (
          <>
            <ToolbarButton
              icon={shell.pinned ? <Pin size={16} aria-hidden="true" /> : <PinOff size={16} aria-hidden="true" />}
              label={shell.pinned ? labels.toolbarUnpin : labels.toolbarPin}
              onClick={shell.togglePin}
              active={shell.pinned}
              tooltipSide={tooltipSide}
            />
            <ToolbarSeparator />
          </>
        )}
        {editions && locales.map((l) => {
          const active = sameLocaleTag(l, activeLocale);
          const short = localeShortTag(l, locales);
          const name = localeDisplayName(l, uiLocale);
          return (
            <ToolbarButton
              key={l}
              icon={(
                <span className="text-[0.66rem] font-semibold uppercase" {...(short.lang ? { lang: short.lang } : {})}>
                  {short.text}
                </span>
              )}
              label={active ? labels.presetLocaleActive.replace('__locale__', name) : labels.editionSwitchTo.replace('__locale__', name)}
              onClick={() => switchTo(l)}
              active={active}
              tooltipSide={tooltipSide}
            />
          );
        })}
        {editions && (
          <>
            <ToolbarSeparator />
            <ToolbarButton
              icon={<Columns2 size={16} aria-hidden="true" />}
              label={`${labels.editionCompare}: ${labels.editionCompareHint}`}
              onClick={onToggleCompare}
              active={comparing}
              tooltipSide={tooltipSide}
            />
          </>
        )}
        {reflow && (
          <ToolbarButton
            icon={<MoveDiagonal size={16} aria-hidden="true" />}
            label={`${labels.reflowToggle}: ${labels.reflowToggleHint}`}
            onClick={() => setReflowShown(!reflowShown)}
            active={reflowShown}
            tooltipSide={tooltipSide}
          />
        )}
      </div>
    </>
  );
}
