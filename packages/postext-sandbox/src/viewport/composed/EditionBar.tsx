'use client';

/**
 * The editions of a book in several languages, over the canvas (#867):
 * one button per edition switches the book to it while staying on the
 * same composed page (the same fence, and the frame picked; its page
 * number may differ in that language), and «Side by side» shows the page
 * next to the same page of another edition.
 */

import { Columns2 } from 'lucide-react';
import { useSandboxDocRef, useSandboxLabels, useSandboxSelector } from '../../context/SandboxContext';
import { selectedFrameNow } from '../../editing/editMode';
import { requestFrameJump } from '../../editions/frameJump';
import { useBookEditions } from '../../editions/useBookEditions';
import { sameLocaleTag } from '../../presets/locale';
import { localeDisplayName, localeShortTag } from '../../presets/localeNames';
import { readViewHash } from '../../storage/viewHash';
import { cn } from '../../ui';

const BUTTON = 'flex h-6 min-w-6 cursor-pointer items-center justify-center gap-1 rounded px-1.5 text-[0.66rem] font-semibold uppercase transition-colors pt-large:h-11 pt-large:min-w-11 focus-visible:outline-2 focus-visible:outline-offset-1 outline-(--brand)';

export function EditionBar({ comparing, onToggleCompare }: { comparing: boolean; onToggleCompare: () => void }) {
  const labels = useSandboxLabels();
  const uiLocale = useSandboxSelector((s) => s.locale);
  const chapters = useSandboxSelector((s) => s.chapters);
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  const docRef = useSandboxDocRef();
  const { presetId, locales, activeLocale } = useBookEditions(false);
  if (presetId === null || locales.length < 2) return null;

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
      locale,
      chapterIndex: chapterIndex >= 0 ? chapterIndex : null,
      page: page?.composed ? null : hash.page,
      fenceIndex: page?.composed?.fenceIndex ?? null,
      frame: page?.composed && picked && page.composed.frames.some((f) => f.id === picked.frameId) ? picked.name : null,
      panel: 'markdown',
      keepEditor: true,
    });
  };

  return (
    <div
      role="group"
      aria-label={labels.editionSwitch}
      className="flex items-center gap-0.5 rounded-md border px-0.5 py-0.5 shadow-sm"
      style={{ borderColor: 'var(--rule)', background: 'var(--background)' }}
      data-edition-bar=""
    >
      {locales.map((l) => {
        const active = sameLocaleTag(l, activeLocale);
        const short = localeShortTag(l, locales);
        const name = localeDisplayName(l, uiLocale);
        return (
          <button
            key={l}
            type="button"
            aria-pressed={active}
            aria-label={active ? labels.presetLocaleActive.replace('__locale__', name) : labels.editionSwitchTo.replace('__locale__', name)}
            title={active ? labels.presetLocaleActive.replace('__locale__', name) : labels.editionSwitchTo.replace('__locale__', name)}
            onClick={() => switchTo(l)}
            className={cn(BUTTON, active ? 'bg-(--brand) text-(--background)' : 'bg-transparent text-(--slate) hover:text-(--foreground)')}
          >
            {short.lang ? <span lang={short.lang}>{short.text}</span> : short.text}
          </button>
        );
      })}
      <span aria-hidden="true" className="mx-0.5 h-4 w-px" style={{ background: 'var(--rule)' }} />
      <button
        type="button"
        aria-pressed={comparing}
        title={labels.editionCompareHint}
        onClick={onToggleCompare}
        className={cn(BUTTON, 'normal-case', comparing ? 'bg-(--brand) text-(--background)' : 'bg-transparent text-(--slate) hover:text-(--foreground)')}
      >
        <Columns2 size={13} aria-hidden="true" />
        <span>{labels.editionCompare}</span>
      </button>
    </div>
  );
}
