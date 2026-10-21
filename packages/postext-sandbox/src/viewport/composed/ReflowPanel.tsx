'use client';

/**
 * Canvas › Reflow (#868): what the layout moved on each composed page and
 * why, over the canvas. The switch shows the panel and the marks on the
 * pages (`reflowMarks.ts`: the declared boxes dashed, arrows to the boxes
 * as laid, a numbered badge per frame); the panel lists the pages whose
 * frames changed, each frame under its number with its changes in words
 * («dinero grew 8.2 mm to hold its content», «gasto moved down 8.2 mm to
 * make room for dinero»), and under a frame that still does not fit, its
 * fixes as one-click actions, as under a frame that lies under another
 * or runs past its edge (#1066; a click on it draws the overlap).
 * Pointing at a frame in the list draws it stronger on its page; a click
 * turns to that page.
 */

import { useMemo } from 'react';
import { MoveDiagonal, X } from 'lucide-react';
import type { ReflowEvent, VDTDocument } from 'postext';
import { useSandboxDocRef, useSandboxLabels, useSandboxSelector, useSandboxWarnings } from '../../context/SandboxContext.js';
import { IconButton } from '../../ui/index.js';
import { fill } from '../../print/fillTokens.js';
import { ProposalActions } from '../../warnings/ProposalButtons.js';
import type { Warning } from '../../warnings/types.js';
import { documentReflow } from './reflowText.js';
import { setReflowFocus, useReflowShown } from './reflowView.js';
import { overlapFocusOf, setOverlapFocus } from '../../editions/overlapFocus.js';


/** Whether the document on screen has composed pages (the switch, in the
 *  editions rail, shows only then). */
export function hasComposedPages(doc: VDTDocument | null): boolean {
  return !!doc?.pages.some((p) => p.composed);
}

/** The checks of a frame on a page of `doc` that come with fixes, from the
 *  Checks panel's warnings (the same layout): its `frameOverflow` (#868)
 *  and its overlap checks (#1053, #1066), as the page's log names them. */
export function frameFixChecks(warnings: readonly Warning[], doc: Pick<VDTDocument, 'pageIndexOffset'>, pageIndex: number, fenceIndex: number, frame: string, events: readonly ReflowEvent[]): Warning[] {
  const page = pageIndex + 1 + (doc.pageIndexOffset ?? 0);
  const out: Warning[] = [];
  const kinds = new Set(events.map((e) => e.kind));
  const pick = (kind: 'frameOverflow' | 'frameCovered' | 'frameOutsideArea', extra: (w: Warning) => boolean = () => true): void => {
    const candidates = warnings.filter((w) => w.payload.kind === kind && w.payload.fenceIndex === fenceIndex && w.payload.frame === frame && extra(w));
    const onPage = candidates.filter((w) => 'page' in w.payload && w.payload.page === page);
    out.push(...(onPage.length > 0 ? onPage : candidates.length === 1 ? candidates : []));
  };
  if (kinds.has('overflow')) pick('frameOverflow');
  // One covered event per frame painted over it.
  for (const e of events) if (e.kind === 'covered') pick('frameCovered', (w) => w.payload.kind === 'frameCovered' && w.payload.coveredBy === e.cause);
  if (kinds.has('outside')) pick('frameOutsideArea');
  return out;
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

  const go = (pageIndex: number, frame?: string, checks: readonly Warning[] = []) => {
    onJumpToPage(pageIndex);
    if (frame) setReflowFocus({ pageIndex, frame });
    // A frame under another or past its edge: the overlap on its page.
    const overlap = checks.map((w) => overlapFocusOf(w.payload)).find(Boolean);
    setOverlapFocus(overlap ? { ...overlap, pageIndex } : null);
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
                  const checks = frameFixChecks(warnings, doc, pr.pageIndex, pr.fenceIndex, entry.frame, entry.events);
                  return (
                    <li key={entry.frame} data-reflow-frame={entry.frame}>
                      <button
                        type="button"
                        onClick={() => go(pr.pageIndex, entry.frame, checks)}
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
                      {checks.map((w) => <ProposalActions key={w.id} warning={w} onScreen />)}
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
