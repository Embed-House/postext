'use client';

/**
 * Two editions side by side (#867): the chapter on screen in its language
 * at the left, the same chapter of another edition at the right, the same
 * page in both and their scrolling kept together (the same composed page
 * in both, counted from it between them, see `compareSync.ts`). The
 * frames that do not fit, or whose text was shrunk, are marked in both
 * (`fitMarks.ts`). The other edition is laid out behind the reader from
 * its draft or its bundle (`editions/editionStore.ts`); it is read only
 * here: a click on one of its pages opens that edition at that page.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { renderPageToCanvas, type VDTDocument } from 'postext';
import {
  useSandboxChapterDocsRef, useSandboxDocRef, useSandboxDocSourceRef, useSandboxLabels, useSandboxSelector,
} from '../../context/SandboxContext';
import { requestFrameJump } from '../../editions/frameJump';
import { useBookEditions } from '../../editions/useBookEditions';
import { sameLocaleTag } from '../../presets/locale';
import { localeDisplayName } from '../../presets/localeNames';
import { readViewHash } from '../../storage/viewHash';
import { IconButton, Select, Switch, cn } from '../../ui';
import { createOverlaySvg } from '../CanvasPreview/dom';
import { drawPageFitMarks } from './fitMarks';
import { syncedScrollTop } from './compareSync';

const GAP = 16;
const PAD = 16;

interface ColumnHandle {
  el: HTMLDivElement | null;
  doc: VDTDocument | null;
  tops: number[];
  heights: number[];
}

function PageColumn({
  doc, handle, onScroll, onPageClick, uiLocale, labels, emptyText,
}: {
  doc: VDTDocument | null;
  handle: React.MutableRefObject<ColumnHandle>;
  onScroll: () => void;
  onPageClick?: (pageIndex: number) => void;
  uiLocale: string;
  labels: ReturnType<typeof useSandboxLabels>;
  emptyText: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(80, width - PAD * 2);
  const sizes = useMemo(() => (doc ? doc.pages.map((p) => ({ w: pageWidth, h: (pageWidth * p.height) / p.width })) : []), [doc, pageWidth]);

  // The page tops in the column, for the scroll sync.
  useLayoutEffect(() => {
    const tops: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      tops.push(y);
      y += s.h + GAP;
    }
    handle.current = { el: ref.current, doc, tops, heights: sizes.map((s) => s.h) };
  }, [doc, sizes, handle]);

  // Paint the pages near the view; again when the document changes.
  useEffect(() => {
    const el = ref.current;
    if (!el || !doc || width === 0) return;
    const painted = new Set<number>();
    const dpr = window.devicePixelRatio || 1;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const slot = e.target as HTMLElement;
        const i = Number(slot.dataset.comparePage);
        if (painted.has(i)) continue;
        const page = doc.pages[i];
        const canvas = slot.querySelector('canvas');
        const svg = slot.querySelector('svg');
        if (!page || !canvas) continue;
        painted.add(i);
        renderPageToCanvas(page, doc, canvas, { scale: Math.min(1, (pageWidth * dpr) / page.width) });
        canvas.style.width = `${pageWidth}px`;
        canvas.style.height = `${(pageWidth * page.height) / page.width}px`;
        if (svg) drawPageFitMarks(svg as SVGSVGElement, doc, i, labels, uiLocale);
      }
    }, { root: el, rootMargin: '600px 0px' });
    el.querySelectorAll('[data-compare-page]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [doc, width, pageWidth, labels, uiLocale]);

  // Each slot's overlay, sized with the page.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !doc) return;
    el.querySelectorAll<HTMLElement>('[data-compare-page]').forEach((slot) => {
      const i = Number(slot.dataset.comparePage);
      const page = doc.pages[i];
      if (!page) return;
      slot.querySelector('svg')?.remove();
      const svg = createOverlaySvg(pageWidth, (pageWidth * page.height) / page.width, page.width, page.height);
      svg.setAttribute('aria-hidden', 'true');
      slot.appendChild(svg);
    });
  }, [doc, pageWidth]);

  return (
    <div ref={ref} className="relative h-full min-w-0 flex-1 overflow-auto" onScroll={onScroll} style={{ background: 'var(--surface)' }}>
      {emptyText !== null && (
        <p className="m-0 flex items-center gap-1.5 p-4 text-xs text-(--slate)">{emptyText}</p>
      )}
      <div style={{ padding: PAD }}>
        {doc?.pages.map((p, i) => (
          <div
            key={i}
            data-compare-page={i}
            className={cn('relative mx-auto', onPageClick && 'cursor-pointer')}
            style={{ width: pageWidth, height: sizes[i]?.h ?? 0, marginBottom: GAP }}
            onClick={onPageClick ? () => onPageClick(i) : undefined}
          >
            <canvas className="block rounded-[2px] bg-white shadow-sm" style={{ width: pageWidth, height: sizes[i]?.h ?? 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditionCompare({ onClose }: { onClose: () => void }) {
  const labels = useSandboxLabels();
  const uiLocale = useSandboxSelector((s) => s.locale);
  const chapters = useSandboxSelector((s) => s.chapters);
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  const docVersion = useSandboxSelector((s) => s.docVersion);
  const docRef = useSandboxDocRef();
  const docSourceRef = useSandboxDocSourceRef();
  const chapterDocsRef = useSandboxChapterDocsRef();
  const base = useBookEditions(false);
  const others = base.locales.filter((l) => !sameLocaleTag(l, base.activeLocale));
  const [chosen, setChosen] = useState<string | null>(null);
  const other = chosen && others.includes(chosen) ? chosen : others[0] ?? '';
  const activeIndex = chapters.findIndex((c) => c.id === activeChapterId);
  // The chapter on screen is laid out in the other edition even when the
  // checks would skip it (no composed page, #1007).
  const editions = useBookEditions(other !== '', other ? [other] : [], { chapters: activeIndex >= 0 ? [activeIndex] : [] });
  const [sync, setSync] = useState(true);

  const leftDoc = useMemo(() => {
    const held = chapterDocsRef.current.get(activeChapterId);
    if (held) return held.doc;
    const src = docSourceRef.current;
    return src && src.scope !== 'book' && src.scope.only === activeChapterId ? docRef.current : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the refs hold the document of `docVersion`
  }, [activeChapterId, docVersion]);
  const entry = other ? editions.entries[other] : undefined;
  const rightDoc = entry?.layout?.chapters[activeIndex]?.doc ?? null;
  // Laid out, and still without the chapter: the edition has none there.
  const rightMissing = !rightDoc && entry?.status === 'ready' && entry.chapters.has(activeIndex);
  const rightLoading = other !== '' && !rightDoc && !rightMissing && entry?.status !== 'error';

  const left = useRef<ColumnHandle>({ el: null, doc: null, tops: [], heights: [] });
  const right = useRef<ColumnHandle>({ el: null, doc: null, tops: [], heights: [] });
  const muted = useRef<HTMLDivElement | null>(null);

  const follow = (from: ColumnHandle, to: ColumnHandle) => {
    if (!sync || !from.el || !to.el || !from.doc || !to.doc) return;
    // The column moved by the sync does not move the other back.
    if (muted.current === from.el) {
      muted.current = null;
      return;
    }
    const top = syncedScrollTop({ doc: from.doc, tops: from.tops, heights: from.heights, scrollTop: from.el.scrollTop + PAD }, { doc: to.doc, tops: to.tops, heights: to.heights });
    if (top === null) return;
    // Both columns read at the same line: a page gap under their top.
    const next = Math.max(0, top - PAD);
    if (Math.abs(to.el.scrollTop - next) < 1) return;
    muted.current = to.el;
    to.el.scrollTop = next;
  };

  // Open on the page the canvas shows; the other column follows.
  const placedRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const l = left.current;
    if (!leftDoc || !l.el) return;
    const key = `${activeChapterId}|${other}|${rightDoc ? 1 : 0}`;
    if (placedRef.current === key) return;
    placedRef.current = key;
    const wanted = readViewHash().page;
    const i = wanted !== null ? leftDoc.pages.findIndex((p) => p.pageNumberValue === wanted) : -1;
    if (i >= 0 && l.tops[i] !== undefined) l.el.scrollTop = l.tops[i]! - PAD;
    follow(l, right.current);
  });

  const name = (l: string) => (l ? localeDisplayName(l, uiLocale) : '?');
  const status = !other
    ? labels.composedChecksOneEdition
    : entry?.status === 'error'
      ? labels.composedChecksEditionError.replace('__locale__', name(other)).replace('__error__', entry.error ?? '')
      : rightMissing
        ? labels.editionCompareNoChapter.replace('__locale__', name(other))
        : !rightDoc
          ? labels.editionCompareLoading.replace('__locale__', name(other))
          : null;

  const openOther = (pageIndex: number) => {
    const page = rightDoc?.pages[pageIndex];
    if (!page || !other) return;
    requestFrameJump({
      presetId: base.presetId,
      projectId: base.projectId,
      locale: other,
      chapterIndex: activeIndex >= 0 ? activeIndex : null,
      page: page.pageNumberValue,
      fenceIndex: page.composed?.fenceIndex ?? null,
      frame: null,
      panel: 'markdown',
      keepEditor: true,
    });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: 'var(--background)' }} data-edition-compare="" role="region" aria-label={labels.editionCompare}>
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1" style={{ borderColor: 'var(--rule)' }}>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-(--foreground)">{name(base.activeLocale)}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[0.66rem] text-(--slate)">{labels.editionCompareWith}</span>
          {others.length > 1 ? (
            <Select<string> size="sm" value={other} onValueChange={setChosen} ariaLabel={labels.editionCompareWith} options={others.map((l) => ({ value: l, label: name(l) }))} />
          ) : (
            <span className="truncate text-xs font-semibold text-(--foreground)">{other ? name(other) : ''}</span>
          )}
          {rightLoading && <Loader2 size={12} aria-hidden="true" className="shrink-0 animate-spin text-(--slate)" />}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[0.66rem] text-(--slate)">
          <Switch checked={sync} onCheckedChange={setSync} ariaLabelledBy="postext-compare-sync" />
          <span id="postext-compare-sync">{labels.editionCompareSync}</span>
        </span>
        <IconButton label={labels.editionCompareClose} onClick={onClose} icon={<X size={14} aria-hidden="true" />} />
      </div>
      <div className="flex min-h-0 flex-1 gap-px" style={{ background: 'var(--rule)' }}>
        <PageColumn doc={leftDoc} handle={left} onScroll={() => follow(left.current, right.current)} uiLocale={uiLocale} labels={labels} emptyText={leftDoc ? null : labels.editionCompareLoading.replace('__locale__', name(base.activeLocale))} />
        <PageColumn doc={rightDoc} handle={right} onScroll={() => follow(right.current, left.current)} onPageClick={openOther} uiLocale={uiLocale} labels={labels} emptyText={status} />
      </div>
    </div>
  );
}
