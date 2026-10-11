// The book's text: what is open, its chapters, reading and editing them.

import { newChapter, wordCount } from '../../book/chapterOps';
import { chapterPageLabels } from '../../book/pagination';
import { minimalChange } from '../../book/textChanges';
import { generateChapterId } from '../../storage/projects';
import { bookPagesSummary, chapterOf, dispatchAndWait, isSettled, layOutChapter, whenSettled, type SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';
import { pagesOfOffset } from '../pageText';
import { applyFindReplace, findInText, numberedLines } from '../textEdits';
import { viewState } from './view';

const CHAPTER_PARAM = {
  type: ['integer', 'string'],
  description: 'The chapter: its position in the book (from 1), its title or its id. The chapter on screen when left out.',
} as const;

const WAIT_PARAM = {
  type: 'boolean',
  description: 'Wait for the book to be laid out again and answer with the pages each chapter came to (default true). False answers at once.',
} as const;

/** What a tool that changed the book answers with: its pages once laid
 *  out again, or `laidOut: false` when it was told not to wait. */
export async function layoutAnswer(host: SandboxToolHost, wait: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (wait === false) return { laidOut: false };
  const laidOut = await whenSettled(host, { signal });
  return { laidOut, book: bookPagesSummary(host) };
}

/** The book on screen: a project of the reader's, or a sample. */
export function bookIdentity(host: SandboxToolHost): Record<string, unknown> {
  const s = host.store.getSnapshot();
  if (s.activeProjectId) {
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    return { kind: 'project', id: s.activeProjectId, name: project?.name ?? null, ...(project?.locale ? { language: project.locale } : {}) };
  }
  const preset = s.presetSummaries.find((p) => p.id === s.activePresetId);
  const language = s.presetApplied?.presetId === s.activePresetId ? s.presetApplied.locale : undefined;
  return { kind: 'sample', id: s.activePresetId, name: preset?.name ?? null, ...(language ? { language } : {}) };
}

export function bookTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  const getState: WebMcpTool = {
    name: 'sandbox_get_state',
    title: 'Sandbox: what is open',
    description: 'The book open in the Postext Sandbox and how it is shown: its chapters with their page ranges, the chapter and page on screen, the viewer tab and its display settings, the open side panel, and how many warnings the layout has. Start here, and call it again to see where things stand.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => {
      const s = store.getSnapshot();
      const plan = store.getPlan(s);
      const summary = bookPagesSummary(host, s);
      return {
        ready: s.storeReady && !s.booting && !s.bookLoading,
        laidOut: isSettled(host, s),
        book: bookIdentity(host),
        pages: summary.pages,
        chapters: s.chapters.map((c, i) => {
          const pages = plan.bookPages[c.id];
          const labels = pages ? chapterPageLabels(pages) : null;
          return {
            chapter: i + 1,
            id: c.id,
            title: c.title,
            ...(c.id === s.activeChapterId ? { onScreen: true } : {}),
            characters: c.markdown.length,
            words: wordCount(c.markdown),
            pages: plan.byId[c.id]?.layout?.pageCount ?? null,
            ...(labels ? { firstPage: labels.from, lastPage: labels.to } : {}),
          };
        }),
        view: viewState(host),
        resources: s.resources.length,
        warnings: store.getWarnings(s).length,
      };
    },
  };

  const readText: WebMcpTool = {
    name: 'sandbox_read_text',
    title: 'Sandbox: read a chapter',
    description: "A chapter's Markdown source, each line behind its number. Postext's Markdown has its own extensions (directives such as ::resource, :ref, :::callout, front matter on the first chapter): the format is documented at /docs/document-format. Long chapters can be read in parts with fromLine and toLine.",
    inputSchema: {
      type: 'object',
      properties: {
        chapter: CHAPTER_PARAM,
        fromLine: { type: 'integer', minimum: 1, description: 'First line to read (from 1).' },
        toLine: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive.' },
        plain: { type: 'boolean', description: 'Give the text as it is, without line numbers.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (args) => {
      const s = store.getSnapshot();
      const { chapter, index } = chapterOf(s, args.chapter);
      const text = chapter.id === s.activeChapterId ? s.markdown : chapter.markdown;
      const part = numberedLines(text, args.fromLine as number | undefined, args.toLine as number | undefined);
      return {
        chapter: index + 1,
        title: chapter.title,
        lines: part.total,
        fromLine: part.from,
        toLine: part.to,
        text: args.plain ? text.split('\n').slice(part.from - 1, part.to).join('\n') : part.text,
      };
    },
  };

  const writeText: WebMcpTool = {
    name: 'sandbox_write_text',
    title: 'Sandbox: replace a chapter',
    description: "Replace a chapter's whole Markdown source with new text. For a change to part of a chapter, sandbox_edit_text keeps the rest untouched.",
    inputSchema: {
      type: 'object',
      properties: {
        chapter: CHAPTER_PARAM,
        markdown: { type: 'string', description: "The chapter's new Markdown source." },
        wait: WAIT_PARAM,
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const { chapter, index } = chapterOf(s, args.chapter);
      const before = chapter.id === s.activeChapterId ? s.markdown : chapter.markdown;
      const change = minimalChange(before, args.markdown as string);
      if (change) await dispatchAndWait(host, { type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: chapter.id, changes: [change], baseLength: before.length } });
      return { chapter: index + 1, changed: change !== null, characters: (args.markdown as string).length, ...(await layoutAnswer(host, args.wait, signal)) };
    },
  };

  const editText: WebMcpTool = {
    name: 'sandbox_edit_text',
    title: 'Sandbox: edit a chapter',
    description: "Change passages of a chapter's Markdown source: each edit finds an exact passage and puts another in its place. The passage must match the source exactly and occur once (or set all to change every occurrence). Edits apply in order. Nothing is changed unless every edit applies.",
    inputSchema: {
      type: 'object',
      properties: {
        chapter: CHAPTER_PARAM,
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'The exact text to replace, as it is in the source.' },
              replace: { type: 'string', description: 'The text that takes its place (empty to delete).' },
              all: { type: 'boolean', description: 'Replace every occurrence.' },
            },
            required: ['find', 'replace'],
            additionalProperties: false,
          },
        },
        wait: WAIT_PARAM,
      },
      required: ['edits'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const { chapter, index } = chapterOf(s, args.chapter);
      const before = chapter.id === s.activeChapterId ? s.markdown : chapter.markdown;
      const { text, applied } = applyFindReplace(before, args.edits as { find: string; replace: string; all?: boolean }[]);
      const change = minimalChange(before, text);
      if (change) await dispatchAndWait(host, { type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: chapter.id, changes: [change], baseLength: before.length } });
      return { chapter: index + 1, changed: change !== null, edits: applied, ...(await layoutAnswer(host, args.wait, signal)) };
    },
  };

  const searchText: WebMcpTool = {
    name: 'sandbox_search_text',
    title: 'Sandbox: find text in the book',
    description: 'Where a word or passage occurs in the Markdown source: the chapter, the line and the line itself, and, with pages set, the page each occurrence is set on (the chapters that hold one are laid out for it).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text to look for.' },
        chapter: { ...CHAPTER_PARAM, description: 'Search this chapter only (position from 1, title or id). Every chapter when left out.' },
        matchCase: { type: 'boolean' },
        pages: { type: 'boolean', description: 'Also say which page each occurrence is set on.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Most occurrences to list (default 40).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const only = args.chapter === undefined ? null : chapterOf(s, args.chapter).index;
      const limit = (args.limit as number | undefined) ?? 40;
      const matches: Record<string, unknown>[] = [];
      for (const [i, c] of s.chapters.entries()) {
        if (only !== null && only !== i) continue;
        const text = c.id === s.activeChapterId ? s.markdown : c.markdown;
        const found = findInText(text, args.query as string, { matchCase: !!args.matchCase, limit: limit - matches.length });
        if (found.length === 0) continue;
        const doc = args.pages ? (await layOutChapter(host, c.id, signal)).doc : null;
        for (const m of found) {
          const on = doc ? pagesOfOffset(doc, m.offset) : [];
          matches.push({
            chapter: i + 1,
            line: m.line,
            text: m.text,
            ...(doc ? { pagePositions: on, pageLabels: on.map((p) => doc.pages[p - 1]!.pageLabel) } : {}),
          });
        }
        if (matches.length >= limit) break;
      }
      return { matches, ...(matches.length >= limit ? { more: true } : {}) };
    },
  };

  const manageChapters: WebMcpTool = {
    name: 'sandbox_manage_chapters',
    title: 'Sandbox: arrange the chapters',
    description: "Add a chapter, rename one, move one to another position, split one in two (at a passage, or at every level-1 heading), merge one into the chapter before it, or show one on screen. A chapter's title is its name in the interface, not text of the book.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'rename', 'move', 'split', 'split_at_headings', 'merge_with_previous', 'show'] },
        chapter: CHAPTER_PARAM,
        title: { type: 'string', description: 'add, rename: the title.' },
        markdown: { type: 'string', description: 'add: the new chapter\'s Markdown source.' },
        position: { type: 'integer', minimum: 1, description: 'add, move: where in the book (from 1). add puts the chapter after the one on screen when left out.' },
        before: { type: 'string', description: 'split: the exact passage the second chapter starts with; it must occur once in the chapter.' },
        wait: WAIT_PARAM,
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const action = args.action as string;
      if (action === 'add') {
        const title = (args.title as string | undefined)?.trim() || s.labels.chapterUntitled.replace('__n__', String(s.chapters.length + 1));
        const chapter = newChapter(generateChapterId(), title, (args.markdown as string | undefined) ?? '');
        const index = args.position === undefined ? undefined : Math.min(s.chapters.length, (args.position as number) - 1);
        await dispatchAndWait(host, { type: 'ADD_CHAPTER', payload: { chapter, ...(index !== undefined ? { index } : {}) } });
        const at = store.getSnapshot().chapters.findIndex((c) => c.id === chapter.id);
        return { added: at + 1, id: chapter.id, title, ...(await layoutAnswer(host, args.wait, signal)) };
      }
      const { chapter, index } = chapterOf(s, args.chapter);
      switch (action) {
        case 'rename': {
          const title = (args.title as string | undefined)?.trim();
          if (!title) throw new ToolError('rename needs a title.');
          await dispatchAndWait(host, { type: 'RENAME_CHAPTER', payload: { id: chapter.id, title } });
          return { chapter: index + 1, title };
        }
        case 'move': {
          if (args.position === undefined) throw new ToolError('move needs the position to move the chapter to (from 1).');
          await dispatchAndWait(host, { type: 'MOVE_CHAPTER', payload: { id: chapter.id, to: (args.position as number) - 1 } });
          const at = store.getSnapshot().chapters.findIndex((c) => c.id === chapter.id);
          return { chapter: at + 1, title: chapter.title, ...(await layoutAnswer(host, args.wait, signal)) };
        }
        case 'split': {
          const text = chapter.id === s.activeChapterId ? s.markdown : chapter.markdown;
          const passage = args.before as string | undefined;
          if (!passage) throw new ToolError('split needs "before": the exact passage the second chapter starts with. To split at every level-1 heading, the action is split_at_headings.');
          const first = text.indexOf(passage);
          if (first < 0) throw new ToolError('The passage to split before is not in the chapter; it must match the source exactly.');
          if (text.indexOf(passage, first + 1) >= 0) throw new ToolError('The passage to split before occurs more than once in the chapter; give more of it.');
          if (first === 0) throw new ToolError('The chapter already starts with that passage.');
          const newId = generateChapterId();
          await dispatchAndWait(host, { type: 'SPLIT_CHAPTER', payload: { id: chapter.id, at: first, newId } });
          return { chapter: index + 1, newChapter: index + 2, id: newId, ...(await layoutAnswer(host, args.wait, signal)) };
        }
        case 'split_at_headings': {
          const text = chapter.id === s.activeChapterId ? s.markdown : chapter.markdown;
          const headings = (text.match(/^#\s+\S/gm) ?? []).length;
          if (headings < 2) throw new ToolError(`The chapter has ${headings} level-1 heading(s); it takes at least two to split at them.`);
          const before = s.chapters.length;
          await dispatchAndWait(host, { type: 'SPLIT_CHAPTER_AT_HEADINGS', payload: { id: chapter.id, newIds: Array.from({ length: headings - 1 }, generateChapterId) } });
          return { chapter: index + 1, chaptersMade: store.getSnapshot().chapters.length - before, ...(await layoutAnswer(host, args.wait, signal)) };
        }
        case 'merge_with_previous': {
          if (index === 0) throw new ToolError('The first chapter has none before it to merge into.');
          await dispatchAndWait(host, { type: 'MERGE_CHAPTER_WITH_PREVIOUS', payload: chapter.id });
          return { mergedInto: index, ...(await layoutAnswer(host, args.wait, signal)) };
        }
        case 'show':
          await dispatchAndWait(host, { type: 'SET_ACTIVE_CHAPTER', payload: chapter.id });
          return { chapter: index + 1, title: chapter.title };
        default:
          throw new ToolError(`Unknown action ${JSON.stringify(action)}.`);
      }
    },
  };

  const removeChapter: WebMcpTool = {
    name: 'sandbox_remove_chapter',
    title: 'Sandbox: delete a chapter',
    description: 'Delete a chapter and its text from the book. It cannot be undone; a book keeps at least one chapter.',
    inputSchema: {
      type: 'object',
      properties: { chapter: { ...CHAPTER_PARAM, description: 'The chapter to delete: its position in the book (from 1), its title or its id.' }, wait: WAIT_PARAM },
      required: ['chapter'],
      additionalProperties: false,
    },
    annotations: { consequentialHint: true },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      if (s.chapters.length < 2) throw new ToolError('This is the only chapter of the book; a book keeps at least one. Its text can be emptied with sandbox_write_text.');
      const { chapter, index } = chapterOf(s, args.chapter);
      await dispatchAndWait(host, { type: 'REMOVE_CHAPTER', payload: chapter.id });
      return { removed: index + 1, title: chapter.title, ...(await layoutAnswer(host, args.wait, signal)) };
    },
  };

  return [getState, readText, writeText, editText, searchText, manageChapters, removeChapter];
}
