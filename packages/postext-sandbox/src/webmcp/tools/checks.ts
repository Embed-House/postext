// What the Checks panel has to say — of any chapter, or of the whole
// book. The panel lists the chapter on screen and reads the pages of the
// viewer on screen; here each chapter asked for is laid out for the tool
// itself, so the checks do not depend on what the reader is looking at.

import { describeFrameOverflowProposal, resolvePdfGenerationConfig, resolvePrintConfig } from 'postext';
import type { FrameOverflowProposal, PostextConfig, Resource } from 'postext';
import { composeBookMemo } from '../../book/compose';
import { pdfFontChecksFor } from '../../controls/pdfFontWarnings';
import { svgFontIssues, unavailableResourceImages } from '../../controls/resourceImages';
import { onPreflightInputsChange, preflightInputs, type PreflightInputs } from '../../print/preflightInputs';
import { detailFor, titleFor } from '../../sidebar/WarningsPanel';
import { hasIndexedDB } from '../../storage/blobStore';
import { WARNING_CATEGORY_ORDER, warningCategory } from '../../warnings/categories';
import { computeComposedWarnings, computeWarnings } from '../../warnings/compute';
import { planProposal, proposalContextOf, valueInWords } from '../../warnings/proposalActions';
import type { Warning } from '../../warnings/types';
import { applyViewerEdit } from '../../editor/viewerEdits';
import { chapterText, stateReaches } from '../chapterEdits';
import { chapterOf, dispatchAndWait, layOutChapter, type SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';
import { preparePainting } from '../pageImage';
import { screenPosition } from './view';

/** How long the checks wait for the print profile of a book set up for
 *  print, in milliseconds. */
const PROFILE_WAIT_MS = 6000;

/** What the preflight and the contrast on paper read beyond the pages:
 *  the separation of the output profile, loaded on first use. A book set
 *  up for print waits for it; `pending` says it did not come in time. */
async function preflightFor(config: PostextConfig, resources: readonly Resource[], signal?: AbortSignal): Promise<{ inputs: PreflightInputs; pending: boolean }> {
  const print = resolvePrintConfig(config.print);
  const pdf = resolvePdfGenerationConfig(config.pdfGeneration);
  const forPrint = print.standard !== 'none' || (pdf.forceColorSpace && pdf.colorSpace === 'cmyk') || config.page?.cutLines?.enabled === true;
  let inputs = preflightInputs(config.print, resources);
  if (!forPrint || !print.preflight.enabled || inputs.transform) return { inputs, pending: false };
  const deadline = Date.now() + PROFILE_WAIT_MS;
  while (!inputs.transform && Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise<void>((resolve) => {
      const off = onPreflightInputsChange(() => { off(); clearTimeout(timer); resolve(); });
      const timer = setTimeout(() => { off(); resolve(); }, 250);
    });
    inputs = preflightInputs(config.print, resources);
  }
  return { inputs, pending: !inputs.transform };
}

export function checkTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  const getWarnings: WebMcpTool = {
    name: 'sandbox_get_warnings',
    title: 'Sandbox: what the checks found',
    description: "What the Sandbox's checks find in a chapter, or in the whole book, worded as the Checks panel words it: missing fonts and pictures, markup the engine could not read, design elements that do not fit, text too faint against its ground, typesetting faults (loose lines, widows, overflowing boxes) and print preflight. The chapter is laid out for the check itself, so the answer is the same whatever viewer and chapter are on screen, and it follows the last change. Each warning comes with its category, the chapter and the line of the source it points at (and the offsets, for sandbox_select_text), the page where it has one and, where it names one, the setting or the resource. scope \"book\" checks every chapter, which lays each of them out: on a long book that takes a while.",
    inputSchema: {
      type: 'object',
      properties: {
        chapter: { type: ['integer', 'string'], description: 'The chapter to check: its position in the book (from 1), its title or its id. The chapter the reader is at when left out.' },
        scope: { type: 'string', enum: ['chapter', 'book'], description: 'book checks every chapter (default chapter).' },
        category: { type: 'string', enum: WARNING_CATEGORY_ORDER, description: 'Only this category.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Most warnings to list (default 100).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const first = store.getSnapshot();
      const whole = args.scope === 'book';
      const targets = whole
        ? first.chapters.map((chapter, index) => ({ chapter, index }))
        : [chapterOf(first, args.chapter ?? screenPosition(host).chapterIndex + 1)];
      // The faces and pictures the checks ask about, read as a viewer
      // would read them: a picture that cannot be decoded is only known
      // once something tried.
      await preparePainting(first.config, targets.map((t) => t.chapter.markdown), first.resources).catch(() => undefined);
      const { inputs: preflight, pending } = await preflightFor(first.config, first.resources, signal);

      const all: { warning: Warning; chapter: number | null }[] = [];
      const seen = new Set<string>();
      const perChapter: { chapter: number; title: string; warnings: number }[] = [];
      let laidOut = true;
      for (const target of targets) {
        const { doc, state, settled } = await layOutChapter(host, target.chapter.id, signal);
        laidOut &&= settled;
        const book = composeBookMemo(state.chapters, target.chapter.id);
        const fontChecks = pdfFontChecksFor(state);
        const found = computeWarnings({
          markdown: book.markdown,
          config: state.config,
          doc,
          resources: state.resources,
          storageUnavailable: !hasIndexedDB(),
          unavailableImages: unavailableResourceImages(),
          svgFontIssues: svgFontIssues(),
          book,
          chapterTitles: new Map(state.chapters.map((c) => [c.id, c.title])),
          pdfFontChecks: fontChecks.checks,
          pdfFontChecksStale: fontChecks.stale,
          preflight,
        });
        let own = 0;
        for (const warning of found) {
          // A warning that points at no place in the text or on a page
          // is the book's: listed once however many chapters raise it.
          const placed = warning.sourceStart !== undefined || typeof (warning.payload as { page?: unknown }).page === 'number';
          const key = placed ? `${target.index}:${warning.id}` : warning.id;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({ warning, chapter: placed ? (warning.chapterIndex ?? target.index) + 1 : null });
          if (placed) own++;
        }
        perChapter.push({ chapter: target.index + 1, title: target.chapter.title, warnings: own });
      }

      const counts: Record<string, number> = {};
      for (const { warning } of all) {
        const category = warningCategory(warning.payload.kind);
        counts[category] = (counts[category] ?? 0) + 1;
      }
      const limit = (args.limit as number | undefined) ?? 100;
      const wanted = all.filter(({ warning }) => args.category === undefined || warningCategory(warning.payload.kind) === args.category);
      const { labels } = store.getSnapshot();
      return {
        laidOut,
        scope: whole ? 'book' : 'chapter',
        ...(whole ? { chapters: perChapter } : { chapter: targets[0]!.index + 1, title: targets[0]!.chapter.title }),
        total: all.length,
        byCategory: counts,
        ...(pending ? { note: 'The print profile had not loaded in time: the ink checks and the contrast on paper are not in this answer. Call again in a moment.' } : {}),
        warnings: wanted.slice(0, limit).map(({ warning: w, chapter }) => {
          const payload = w.payload as Record<string, unknown>;
          return {
            id: w.id,
            kind: w.payload.kind,
            category: warningCategory(w.payload.kind),
            title: titleFor(w.payload, labels),
            detail: detailFor(w.payload, labels),
            ...(chapter !== null ? { chapter } : {}),
            ...(w.chapterLine ?? w.line ? { line: w.chapterLine ?? w.line } : {}),
            ...(w.chapterStart !== undefined ? { offset: w.chapterStart, toOffset: w.chapterEnd ?? w.chapterStart } : {}),
            ...(typeof payload.path === 'string' ? { setting: payload.path } : {}),
            ...(typeof payload.resourceId === 'string' ? { resource: payload.resourceId } : {}),
            ...(typeof payload.page === 'number' ? { page: payload.page } : {}),
            // A frame that does not fit: its fixes, numbered as
            // sandbox_apply_proposal takes them (#868).
            ...(w.payload.kind === 'frameOverflow' ? { frame: w.payload.frame, proposals: proposalList(w.payload.proposals) } : {}),
          };
        }),
        ...(wanted.length > limit ? { more: wanted.length - limit } : {}),
      };
    },
  };

  /** The frame of a chapter that does not fit, as the checks found it
   *  on a layout made for the tool. */
  const overflowOf = async (args: Record<string, unknown>, signal?: AbortSignal) => {
    const { chapter, index } = chapterOf(store.getSnapshot(), args.chapter ?? screenPosition(host).chapterIndex + 1);
    const { doc, state } = await layOutChapter(host, chapter.id, signal);
    const book = composeBookMemo(state.chapters, chapter.id);
    const found = computeComposedWarnings({ markdown: book.markdown, config: state.config, doc, resources: state.resources, book })
      .filter((w): w is Warning & { payload: Extract<Warning['payload'], { kind: 'frameOverflow' }> } => w.payload.kind === 'frameOverflow');
    return { chapter, index, found };
  };

  const applyProposal: WebMcpTool = {
    name: 'sandbox_apply_proposal',
    title: 'Sandbox: make a frame fit by a proposed fix',
    description: "Make a frame of a composed page fit with one of the fixes the layout proposes for it: the proposals of its frameOverflow warning in sandbox_get_warnings, by their number there (from 1) or their kind. allowShrink lets its text shrink further (fit.minScale, and fit.shrinkText when it was off), raiseMax raises its maxHeight, lowerMin lowers the minHeight of another frame of its group, continueNextPage sets overflow.continueIn to next-page, and useTemplate sets the page with another template (the fence's template attribute in the chapter's text). It is the one-click fix of the Checks panel and the Reflow panel, without the question they ask the reader: one step of the history that sandbox_undo takes back. A design change applies to every page set with the template. shortenText changes nothing: it selects the frame's text in the Manuscript panel and answers how many characters to cut and where, for sandbox_write_text. Answers what was changed and whether the frame fits now, laid out again.",
    inputSchema: {
      type: 'object',
      properties: {
        chapter: { type: ['integer', 'string'], description: 'The chapter of the page: its position in the book (from 1), its title or its id. The chapter the reader is at when left out.' },
        frame: { type: 'string', description: "The frame that does not fit, by its name in the template (the warning's frame)." },
        page: { type: 'integer', description: 'The page number as printed, when the frame does not fit on more than one page of the chapter.' },
        proposal: { type: ['integer', 'string'], description: 'The fix: its number in the warning\'s proposals (from 1) or its kind (allowShrink, raiseMax, lowerMin, continueNextPage, useTemplate, shortenText).' },
      },
      required: ['frame', 'proposal'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const { chapter, index, found } = await overflowOf(args, signal);
      const frame = String(args.frame);
      const mine = found.filter((w) => w.payload.frame === frame && (args.page === undefined || w.payload.page === args.page));
      if (mine.length === 0) {
        const others = [...new Set(found.map((w) => `${w.payload.frame} (page ${w.payload.page})`))];
        throw new ToolError(others.length > 0
          ? `"${frame}" fits${args.page !== undefined ? ` on page ${String(args.page)}` : ''} in chapter ${index + 1}. The frames that do not fit: ${others.join(', ')}.`
          : `Every frame of chapter ${index + 1} fits: there is nothing to fix.`);
      }
      if (mine.length > 1) throw new ToolError(`"${frame}" does not fit on pages ${mine.map((w) => w.payload.page).join(', ')}: say which with page.`);
      const warning = mine[0]!;
      const list = warning.payload.proposals;
      const proposal = typeof args.proposal === 'number'
        ? list[args.proposal - 1]
        : list.find((p) => p.kind === args.proposal);
      if (!proposal) {
        throw new ToolError(`No such fix for "${frame}". Its fixes: ${list.map((p, i) => `${i + 1}. ${p.kind} (${describeFrameOverflowProposal(p)})`).join('; ') || 'none'}.`);
      }
      const plan = planProposal(warning, proposal, proposalContextOf(store.getSnapshot()));
      const words = describeFrameOverflowProposal(proposal);
      if (plan.kind === 'stale') throw new ToolError('The book changed after the layout proposed this fix, so nothing was changed. Call sandbox_get_warnings again for the fixes as they are now.');
      if (plan.kind === 'select') {
        await dispatchAndWait(host, [
          { type: 'SET_PANEL', payload: 'markdown' },
          { type: 'SET_PENDING_EDITOR_FOCUS', payload: { chapterId: plan.chapterId, anchor: plan.from, head: plan.to, selectWord: false } },
        ]);
        return { changed: false, fix: { kind: proposal.kind, words }, chapter: index + 1, selected: { offset: plan.from, toOffset: plan.to }, cutCharacters: plan.chars };
      }
      if (plan.kind === 'config') {
        await dispatchAndWait(host, { type: 'UPDATE_CONFIG', payload: plan.patch, history: { merge: false } });
      } else {
        const before = chapterText(store.getSnapshot(), plan.chapterId);
        applyViewerEdit((a) => store.dispatch(a), plan.chapterId, plan.changes, plan.baseLength);
        const landed = await stateReaches(host, () => chapterText(store.getSnapshot(), plan.chapterId) !== before, 5000);
        if (!landed) throw new ToolError('The chapter changed while the fix was on its way, so nothing was changed. Call sandbox_get_warnings again.');
      }
      const after = await overflowOf({ chapter: chapter.id }, signal);
      const still = after.found.find((w) => w.payload.frame === frame && w.payload.fenceIndex === warning.payload.fenceIndex);
      return {
        changed: true,
        fix: { kind: proposal.kind, words },
        chapter: index + 1,
        ...(plan.kind === 'config'
          ? { settings: plan.leaves.map((l, i) => ({ pointer: l.pointer, setting: plan.settings[i], value: valueInWords(l.value) })) }
          : { text: { template: plan.template, from: warning.payload.template } }),
        fits: !still,
        ...(still ? { stillShortMm: still.payload.overflowMm, proposals: proposalList(still.payload.proposals) } : {}),
        undo: 'sandbox_undo takes it back.',
      };
    },
  };

  return [getWarnings, applyProposal];
}

/** A warning's fixes as the tools list them. */
function proposalList(list: readonly FrameOverflowProposal[]): { number: number; kind: string; words: string }[] {
  return list.map((p, i) => ({ number: i + 1, kind: p.kind, words: describeFrameOverflowProposal(p) }));
}
