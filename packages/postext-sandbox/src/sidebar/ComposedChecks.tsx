'use client';

/**
 * The composed pages' part of the Checks panel (#867): every check of a
 * composed book in every edition — frames that do not fit, slots, fences,
 * the contents cut between columns, the templates — grouped by page, by
 * frame or by language, filtered by any of them; a click takes the reader
 * to the frame in its edition (the book switches language when it must),
 * on its page, with the caret in its slot.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, LayoutTemplate, Loader2 } from 'lucide-react';
import { useSandboxChapterDocsRef, useSandboxDocRef, useSandboxDocSourceRef, useSandboxSelector } from '../context/SandboxContext';
import { Collapsible, ListRow, RowTag, SegmentedControl, Select, cn } from '../ui';
import type { SandboxLabels } from '../types';
import type { Warning } from '../warnings/types';
import {
  composedChecksOf, filterComposedChecks, frameKeyOf, groupComposedChecks, isComposedCheckKind, jumpFor, pageKeyOf,
  type ComposedCheck, type ComposedGroup, type ComposedGroupBy, type EditionChapterChecks,
} from '../warnings/composedChecks';
import { useBookEditions, type BookEditions } from '../editions/useBookEditions';
import { requestFrameJump } from '../editions/frameJump';
import { localeDisplayName, localeShortTag } from '../presets/localeNames';
import { sameLocaleTag } from '../presets/locale';

const ALL = '*';

/** Every edition's checks: the chapter on screen read live (the panel's
 *  own warnings, its document), the rest from the editions laid out
 *  behind the reader. */
export function useComposedChecks(liveWarnings: readonly Warning[], enabled: boolean): { editions: BookEditions; checks: ComposedCheck[] } {
  const editions = useBookEditions(enabled);
  const chapters = useSandboxSelector((s) => s.chapters);
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  const docVersion = useSandboxSelector((s) => s.docVersion);
  const docRef = useSandboxDocRef();
  const docSourceRef = useSandboxDocSourceRef();
  const chapterDocsRef = useSandboxChapterDocsRef();
  const checks = useMemo(() => {
    if (!enabled) return [];
    const activeIndex = chapters.findIndex((c) => c.id === activeChapterId);
    const held = chapterDocsRef.current.get(activeChapterId);
    const src = docSourceRef.current;
    const liveDoc = held?.doc ?? (src && src.scope !== 'book' && src.scope.only === activeChapterId ? docRef.current : null);
    const live: EditionChapterChecks = {
      index: activeIndex,
      doc: liveDoc,
      warnings: liveWarnings.filter((w) => isComposedCheckKind(w.payload.kind) && (w.chapterId === undefined || w.chapterId === activeChapterId)),
    };
    const out: ComposedCheck[] = [];
    for (const locale of editions.locales) {
      const layout = editions.entries[locale]?.layout ?? null;
      const onScreen = sameLocaleTag(locale, editions.activeLocale) || (locale === '' && editions.activeLocale === '');
      const rest: EditionChapterChecks[] = (layout?.chapters ?? [])
        .filter((c) => !onScreen || c.index !== activeIndex)
        .map((c) => ({ index: c.index, doc: c.doc, warnings: c.warnings }));
      out.push(...composedChecksOf(locale, onScreen ? [live, ...rest] : rest));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the refs are read again on each new document (`docVersion`)
  }, [enabled, editions, liveWarnings, chapters, activeChapterId, docVersion]);
  return { editions, checks };
}

function GroupHeading({ group, by, labels, uiLocale, locales }: { group: ComposedGroup; by: ComposedGroupBy; labels: SandboxLabels; uiLocale: string; locales: readonly string[] }): ReactNode {
  if (by === 'locale') {
    const l = group.locale ?? '';
    return l ? `${localeDisplayName(l, uiLocale)} (${localeShortTag(l, locales).text})` : labels.composedChecksBook;
  }
  if (group.chapterIndex === null) return labels.composedChecksBook;
  const chapter = labels.warningsChapterLabel.replace('__n__', String(group.chapterIndex + 1));
  const pages = group.pages.length > 0 ? labels.preflightPage.replace('__page__', group.pages.join(', ')) : null;
  const parts = [chapter, pages, by === 'frame' ? group.frame : null].filter(Boolean);
  return parts.join(' · ');
}

export interface ComposedChecksSectionProps {
  checks: readonly ComposedCheck[];
  editions: BookEditions;
  labels: SandboxLabels;
  title: (w: Warning) => string;
  detail: (w: Warning) => string;
}

export function ComposedChecksSection({ checks, editions, labels, title, detail }: ComposedChecksSectionProps) {
  const uiLocale = useSandboxSelector((s) => s.locale);
  const [open, setOpen] = useState(true);
  const [by, setBy] = useState<ComposedGroupBy>('page');
  const [locale, setLocale] = useState<string>(ALL);
  const [page, setPage] = useState<string>(ALL);
  const [frame, setFrame] = useState<string>(ALL);
  const { locales } = editions;

  // The filters offer what the checks hold.
  const pageOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of checks) {
      const key = pageKeyOf(c);
      if (seen.has(key)) continue;
      const label = c.chapterIndex === null
        ? labels.composedChecksBook
        : [labels.warningsChapterLabel.replace('__n__', String(c.chapterIndex + 1)), c.page !== null ? labels.preflightPage.replace('__page__', String(c.page)) : null].filter(Boolean).join(' · ');
      seen.set(key, label);
    }
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [checks, labels]);
  const frameOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of checks) {
      if (c.frame === null) continue;
      const key = frameKeyOf(c);
      if (!seen.has(key)) seen.set(key, c.chapterIndex !== null && c.page !== null ? `${c.frame} · ${labels.preflightPage.replace('__page__', String(c.page))}` : c.frame);
    }
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [checks, labels]);

  const filtered = filterComposedChecks(checks, {
    locale: locale === ALL ? null : locale,
    page: page === ALL ? null : page,
    frame: frame === ALL ? null : frame,
  });
  const groups = groupComposedChecks(filtered, by, locales);

  // Where each edition stands.
  const status = locales.map((l) => ({ locale: l, entry: editions.entries[l] }));
  const loading = status.filter((s) => s.entry?.status === 'loading' || s.entry === undefined);
  const failed = status.filter((s) => s.entry?.status === 'error');
  const name = (l: string) => (l ? localeDisplayName(l, uiLocale) : '?');

  const jump = (c: ComposedCheck) => {
    requestFrameJump({ ...jumpFor(c), presetId: editions.presetId });
  };

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b border-(--rule)" data-composed-checks="">
      <Collapsible.Trigger
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-start text-xs font-semibold text-(--foreground) transition-colors',
          'hover:bg-(--surface) focus-visible:outline-2 focus-visible:-outline-offset-2 outline-(--brand)',
        )}
      >
        <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-(--slate) rtl:-scale-x-100" style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 200ms ease' }} />
        <span className="min-w-0 flex-1">{labels.composedChecksTitle}</span>
        <span className="rounded-full bg-(--surface) px-1.5 text-[0.62rem] font-medium text-(--slate) tabular-nums">{checks.length}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel data-postext-collapsible="">
        <div className="flex flex-col gap-1.5 px-3 pb-2">
          <SegmentedControl<ComposedGroupBy>
            value={by}
            onValueChange={setBy}
            ariaLabel={labels.composedChecksGroupBy}
            size="sm"
            fill
            options={[
              { value: 'page', label: labels.composedChecksByPage },
              { value: 'frame', label: labels.composedChecksByFrame },
              { value: 'locale', label: labels.composedChecksByLocale },
            ]}
          />
          <div className="grid grid-cols-3 gap-1">
            <Select<string>
              size="sm"
              value={locale}
              onValueChange={setLocale}
              ariaLabel={labels.composedChecksFilterLocale}
              options={[{ value: ALL, label: `${labels.composedChecksFilterLocale}: ${labels.composedChecksAll}` }, ...locales.map((l) => ({ value: l, label: name(l) }))]}
            />
            <Select<string>
              size="sm"
              value={page}
              onValueChange={setPage}
              ariaLabel={labels.composedChecksFilterPage}
              options={[{ value: ALL, label: `${labels.composedChecksFilterPage}: ${labels.composedChecksAll}` }, ...pageOptions]}
            />
            <Select<string>
              size="sm"
              value={frame}
              onValueChange={setFrame}
              ariaLabel={labels.composedChecksFilterFrame}
              options={[{ value: ALL, label: `${labels.composedChecksFilterFrame}: ${labels.composedChecksAll}` }, ...frameOptions]}
            />
          </div>
          <p className="m-0 flex items-center gap-1.5 text-[0.66rem] text-(--slate)" aria-live="polite">
            {loading.length > 0 && <Loader2 size={12} aria-hidden="true" className="shrink-0 animate-spin" />}
            {loading.length > 0
              ? labels.composedChecksChecking.replace('__locale__', loading.map((s) => name(s.locale)).join(', '))
              : locales.length > 1
                ? labels.composedChecksChecked.replace('__locales__', locales.map(name).join(', '))
                : labels.composedChecksOneEdition}
          </p>
          {failed.map((s) => (
            <p key={s.locale} className="m-0 text-[0.66rem] text-(--destructive)">
              {labels.composedChecksEditionError.replace('__locale__', name(s.locale)).replace('__error__', s.entry?.error ?? '')}
            </p>
          ))}
        </div>
        {filtered.length === 0 ? (
          <p className="m-0 px-3 pb-2 text-[0.7rem] text-(--slate)">{labels.composedChecksEmpty}</p>
        ) : groups.map((g) => (
          <div key={g.key} className="pb-1">
            <h4 className="m-0 px-3 pt-1 text-[0.64rem] font-semibold uppercase tracking-[0.04em] text-(--slate)">
              <GroupHeading group={g} by={by} labels={labels} uiLocale={uiLocale} locales={locales} />
            </h4>
            <ul className="m-0 list-none p-0">
              {g.items.map((c) => {
                const t = title(c.warning);
                const where = [
                  c.locale ? name(c.locale) : null,
                  c.page !== null ? labels.preflightPage.replace('__page__', String(c.page)) : null,
                  c.frame,
                ].filter(Boolean).join(' · ');
                return (
                  <li key={c.key}>
                    <ListRow
                      onSelect={() => jump(c)}
                      ariaLabel={labels.composedChecksJump.replace('__check__', t).replace('__where__', where)}
                      alignTop
                      leading={<LayoutTemplate size={16} aria-hidden="true" style={{ color: c.warning.payload.kind === 'frameOverflow' ? 'var(--destructive)' : 'var(--brand)', marginTop: 1 }} />}
                      title={t}
                      subtitle={detail(c.warning)}
                      tags={(
                        <span className="ms-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {c.locale && <RowTag label={name(c.locale)}>{localeShortTag(c.locale, locales).text}</RowTag>}
                          {c.page !== null && <span className="text-[10px] font-medium text-(--slate) tabular-nums">{labels.preflightPage.replace('__page__', String(c.page))}</span>}
                          {c.frame && <span className="text-[10px] font-medium text-(--slate)">{c.frame}</span>}
                        </span>
                      )}
                      className="mx-2 my-0.5"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
