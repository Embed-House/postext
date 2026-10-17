import type { SandboxState } from '../../context/SandboxContext';
import { frameStyleLibrary } from '../../frameStyles/library';
import { stylesAfterMerging, type CompareOptions } from '../../frameStyles/styleCompare';
import { planMerges, type MergeGroup } from '../../frameStyles/styleMerge';
import { applyStyleRewrite } from '../../frameStyles/applyRewrite';
import type { UsageChapter } from '../../frameStyles/styleUsage';
import type { SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';
import { layoutAnswer } from './book';

/** The chapters with the text each holds now (the one in the editor from
 *  the editor's text). */
function bookTexts(s: SandboxState): UsageChapter[] {
  return s.chapters.map((c) => ({ id: c.id, title: c.title, markdown: c.id === s.activeChapterId ? s.markdown : c.markdown }));
}

function compareArgs(args: Record<string, unknown>): CompareOptions {
  const out: CompareOptions = {};
  if (typeof args.maxFields === 'number') out.maxFields = Math.max(0, Math.round(args.maxFields));
  if (typeof args.lookOnly === 'boolean') out.ignorePosition = args.lookOnly;
  return out;
}

const COMPARE_PROPERTIES = {
  maxFields: { type: 'number', description: 'Most settings two styles may differ in and still be suggested (default 2; the four sides of a padding count once).' },
  lookOnly: { type: 'boolean', description: 'Also compare styles whose :::callout boxes stand at different places, on their look alone; merging those moves the boxes (default false).' },
} as const;

/** The frame-style library (#873) for agents: the same answer as Design ›
 *  Boxes › Frame styles, and its merge. */
export function frameStyleTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  const list: WebMcpTool = {
    name: 'sandbox_frame_styles',
    title: 'Sandbox: the box styles, where they are used, merges',
    description: 'The callout styles of the book (they also dress the frames of page templates) with where each is used: the template frames that name it, the composed pages laid with those templates and the :::callout fences of each chapter (by chapter position, 1-based). Also the merges the Frame styles section suggests for near-identical styles: lengths within 0.5 mm and colours within ΔE 2 are equal, at most maxFields settings may differ. Merge with sandbox_merge_styles.',
    inputSchema: { type: 'object', properties: { ...COMPARE_PROPERTIES }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: (args) => {
      const s = store.getSnapshot();
      const chapters = bookTexts(s);
      const lib = frameStyleLibrary(s.config, chapters, compareArgs(args), s.locale);
      return {
        stored: lib.stored,
        styles: lib.styles.map((st) => {
          const u = lib.usage.get(st.id);
          return {
            id: st.id,
            ...(st.name && st.name !== st.id ? { name: st.name } : {}),
            boxes: u?.fenceCount ?? 0,
            ...(u && u.fences.length > 0 ? { byChapter: u.fences.map((f) => ({ chapter: f.chapterIndex + 1, boxes: f.offsets.length, ...(f.implicit > 0 ? { withoutType: f.implicit } : {}) })) } : {}),
            ...(u && u.frames.length > 0 ? { frames: u.frames } : {}),
            ...(u && u.pageCount > 0 ? { composedPages: u.pageCount } : {}),
          };
        }),
        suggestions: lib.suggestions,
        stylesAfterMerging: stylesAfterMerging(lib.styles.length, lib.suggestions),
      };
    },
  };

  const merge: WebMcpTool = {
    name: 'sandbox_merge_styles',
    title: 'Sandbox: merge box styles',
    description: 'Merge callout styles into the one kept: every template frame style and every :::callout{type} fence of every chapter naming a merged style is rewritten to the kept one, and the merged styles leave the list. Give groups ({ keep, merge: [ids] }), or all: true for every suggestion sandbox_frame_styles makes with the same maxFields / lookOnly. It enters the undo history as one step per chapter rewritten and one for the styles (undoSteps): sandbox_undo that many times puts the book back.',
    inputSchema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: { keep: { type: 'string' }, merge: { type: 'array', items: { type: 'string' } } },
            required: ['keep', 'merge'],
            additionalProperties: false,
          },
        },
        all: { type: 'boolean', description: 'Take every suggestion.' },
        ...COMPARE_PROPERTIES,
        wait: { type: 'boolean', description: 'Wait for the book to be laid out again (default true).' },
      },
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      if (!s.config.calloutStyles) throw new ToolError('The book stores no callout styles (it uses the built-in one): there is nothing to merge.');
      const chapters = bookTexts(s);
      const lib = frameStyleLibrary(s.config, chapters, compareArgs(args), s.locale);
      let groups: MergeGroup[];
      if (args.all === true) groups = lib.suggestions;
      else if (Array.isArray(args.groups)) groups = args.groups as MergeGroup[];
      else throw new ToolError('Give groups ({ keep, merge }) or all: true.');
      const ids = new Set(lib.styles.map((st) => st.id));
      for (const g of groups) {
        for (const id of [g.keep, ...g.merge]) {
          if (!ids.has(id)) throw new ToolError(`No callout style ${JSON.stringify(id)}. Read the ids with sandbox_frame_styles.`);
        }
      }
      if (groups.length === 0) return { merged: [], styles: lib.styles.length, note: 'No suggestion to take.' };
      const before = { calloutStyles: s.config.calloutStyles, pageTemplates: s.config.pageTemplates };
      const plan = planMerges(before, lib.styles, chapters, groups);
      const record = applyStyleRewrite(store.dispatch, before, plan, '', s.activeChapterId);
      return {
        merged: plan.from,
        styles: plan.calloutStyles.length,
        fencesRewritten: plan.fenceCount,
        inChapters: plan.chapters.map((c) => c.chapterIndex + 1),
        framesRewritten: plan.frames,
        // sandbox_undo takes the design back first, then each chapter.
        undoSteps: record.steps,
        ...(await layoutAnswer(host, args.wait, signal)),
      };
    },
  };

  return [list, merge];
}
