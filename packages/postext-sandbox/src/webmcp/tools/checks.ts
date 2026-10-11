// What the Checks panel has to say — of any chapter, or of the whole
// book. The panel lists the chapter on screen and reads the pages of the
// viewer on screen; here each chapter asked for is laid out for the tool
// itself, so the checks do not depend on what the reader is looking at.

import { resolvePdfGenerationConfig, resolvePrintConfig } from 'postext';
import type { PostextConfig, Resource } from 'postext';
import { composeBookMemo } from '../../book/compose';
import { pdfFontChecksFor } from '../../controls/pdfFontWarnings';
import { svgFontIssues, unavailableResourceImages } from '../../controls/resourceImages';
import { onPreflightInputsChange, preflightInputs, type PreflightInputs } from '../../print/preflightInputs';
import { detailFor, titleFor } from '../../sidebar/WarningsPanel';
import { hasIndexedDB } from '../../storage/blobStore';
import { WARNING_CATEGORY_ORDER, warningCategory } from '../../warnings/categories';
import { computeWarnings } from '../../warnings/compute';
import type { Warning } from '../../warnings/types';
import { chapterOf, layOutChapter, type SandboxToolHost } from '../host';
import type { WebMcpTool } from '../modelContext';
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
          };
        }),
        ...(wanted.length > limit ? { more: wanted.length - limit } : {}),
      };
    },
  };

  return [getWarnings];
}
