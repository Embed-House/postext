'use client';

import { useMemo } from 'react';
import { useSandboxSelector } from '../context/SandboxContext.js';
import type { UsageChapter } from './styleUsage.js';

const NONE: never[] = [];

/** The chapters of the book with the text each holds now: the chapter in
 *  the editor reads from the editor's text, which `chapters` may not have
 *  caught up with yet. */
export function useBookTexts(): UsageChapter[] {
  const chapters = useSandboxSelector((s) => s.chapters) ?? NONE;
  const activeId = useSandboxSelector((s) => s.activeChapterId);
  const markdown = useSandboxSelector((s) => s.markdown);
  return useMemo(
    () => chapters.map((c) => ({ id: c.id, title: c.title, markdown: c.id === activeId ? markdown : c.markdown })),
    [chapters, activeId, markdown],
  );
}
