'use client';

/**
 * Canvas › Reflow (#868): what the layout moved on each composed page and
 * why, over the canvas. The switch shows the panel and the marks on the
 * pages (`reflowMarks.ts`: the declared boxes dashed, arrows to the boxes
 * as laid, a numbered badge per frame); the panel lists the pages whose
 * frames changed, each frame under its number with its changes in words
 * («dinero grew 8.2 mm to hold its content», «gasto moved down 8.2 mm to
 * make room for dinero»), and under a frame that still does not fit, its
 * fixes as one-click actions. Pointing at a frame in the list draws it
 * stronger on its page; a click turns to that page.
 */

import { useMemo } from 'react';
import { MoveDiagonal, X } from 'lucide-react';
import type { VDTDocument } from 'postext';
import { useSandboxDocRef, useSandboxLabels, useSandboxSelector, useSandboxWarnings } from '../../context/SandboxContext';
import { IconButton } from '../../ui';
import { fill } from '../../print/fillTokens';
import { ProposalActions } from '../../warnings/ProposalButtons';
import type { Warning } from '../../warnings/types';
import { documentReflow } from './reflowText';
import { setReflowFocus, useReflowShown } from './reflowView';


/** Whether the document on screen has composed pages (the switch, in the
 *  editions rail, shows only then). */
export function hasComposedPages(doc: VDTDocument | null): boolean {
  return !!doc?.pages.some((p) => p.composed);
}

/** The `frameOverflow` check of a frame on a page of `doc`, from the
 *  Checks panel's warnings (the same layout). */
function overflowCheck(warnings: readonly Warning[], doc: VDTDocument, pageIndex: number, fenceIndex: number, frame: string): Warning | undefined {
  const candidates = warnings.filter((w) => w.payload.kind === 'frameOverflow' && w.payload.fenceIndex === fenceIndex && w.payload.frame === frame);
  const page = pageIndex + 1 + (doc.pageIndexOffset ?? 0);
  return candidates.find((w) => w.payload.kind === 'frameOverflow' && w.payload.page === page) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

export function ReflowPanel({ currentPage, onJumpToPage }: { currentPage: number; onJumpToPage: (pageIndex: number) => void }) {
  const labels = useSandboxLabels();
  const uiLocale = useSandboxSelector((s) => s.locale);
  const docVersion = useSandboxSelector((s) => s.docVersion);
  const docRef = useSandboxDocRef();
  const warnings = useSandboxWarnings();
  const [shown, setShown] = useReflowShown();
  const doc = docRef.current;
  const pages = useMemo(
    () => (doc ? documentReflow(doc, labels, uiLocale) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the doc ref is read again on each new document (`docVersion`)
    [doc, docVersion, labels, uiLocale],
  );
  if (!shown || !doc || !hasComposedPages(doc)) return null;

  const go = (pageIndex: number, frame?: string) => {
    onJumpToPage(pageIndex);
    if (frame) setReflowFocus({ pageIndex, frame });
  };

  return (
    <section
      aria-label={labels.reflowTitle}
      className="absolute start-2 top-11 z-20 flex max-h-[min(70%,560px)] w-[min(360px,calc(100%-16px))] flex-col overflow-hidden rounded-md border shadow-md pt-large:top-16"
      style={{ borderColor: 'var(--rule)', background: 'var(--background)' }}
      data-reflow-panel=""
      onMouseLeave={() => setReflowFocus(null)}
    >
      <header className="flex items-center gap-2 border-b px-3 py-1.5" style={{ borderColor: 'var(--rule)' }}>
        <MoveDiagonal size={14} aria-hidden="true" className="shrink-0 text-(--brand)" />
        <h3 className="m-0 min-w-0 flex-1 text-xs font-semibold text-(--foreground)">{labels.reflowTitle}</h3>
        <IconButton label={labels.reflowClose} icon={<X size={14} />} onClick={() => setShown(false)} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" style={{ scrollbarWidth: 'none' }}>
        <p className="m-0 px-2 pt-1.5 text-[0.66rem] text-(--slate)">{labels.reflowLegend}</p>
        {pages.length === 0 ? (
          <p className="m-0 px-2 py-2 text-[0.72rem] text-(--slate)">{labels.reflowEmpty}</p>
        ) : pages.map((pr) => {
          const onScreen = pr.pageIndex === currentPage;
          return (
            <div key={pr.pageIndex} className="pt-1.5" data-reflow-page={pr.pageLabel}>
              <button
                type="button"
                onClick={() => go(pr.pageIndex)}
                className="flex w-full cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-2 py-0.5 text-start text-[0.64rem] font-semibold uppercase tracking-[0.04em] text-(--slate) hover:bg-(--surface) focus-visible:outline-2 outline-(--brand)"
              >
                <span className="min-w-0 flex-1">{fill(labels.reflowPage, { page: pr.pageLabel, template: pr.template })}</span>
                {onScreen && <span className="rounded-full bg-(--surface) px-1.5 text-[0.6rem] font-medium normal-case tracking-normal">{labels.reflowOnScreen}</span>}
              </button>
              <ol className="m-0 list-none p-0">
                {pr.entries.map((entry) => {
                  const overflow = entry.events.some((e) => e.kind === 'overflow') ? overflowCheck(warnings, doc, pr.pageIndex, pr.fenceIndex, entry.frame) : undefined;
                  return (
                    <li key={entry.frame} data-reflow-frame={entry.frame}>
                      <button
                        type="button"
                        onClick={() => go(pr.pageIndex, entry.frame)}
                        onMouseEnter={() => setReflowFocus({ pageIndex: pr.pageIndex, frame: entry.frame })}
                        onFocus={() => setReflowFocus({ pageIndex: pr.pageIndex, frame: entry.frame })}
                        className="flex w-full cursor-pointer items-start gap-2 rounded border-0 bg-transparent px-2 py-1 text-start hover:bg-(--surface) focus-visible:outline-2 outline-(--brand)"
                      >
                        <span aria-hidden="true" className="mt-px flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold text-white" style={{ background: '#6741d9' }}>
                          {entry.number}
                        </span>
                        <span className="flex min-w-0 flex-col text-[0.72rem] leading-snug text-(--foreground)">
                          {entry.lines.map((line, i) => <span key={i}>{line}</span>)}
                        </span>
                      </button>
                      {overflow && <ProposalActions warning={overflow} onScreen />}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}
