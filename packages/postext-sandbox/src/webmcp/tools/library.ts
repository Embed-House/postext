// The books: the samples the Sandbox ships and the reader's own projects,
// the files a book is exported to, and what the Checks panel has to say.

import { emptyTemplate, postextToDocx } from 'postext/word';
import { slugify } from '../../panels/resources/slugify';
import { detailFor, titleFor } from '../../sidebar/WarningsPanel';
import { downloadBytes, exportConfigToJson, exportMarkdownFile } from '../../storage/persistence';
import type { ViewportTab } from '../../types';
import { WARNING_CATEGORY_ORDER, warningCategory } from '../../warnings/categories';
import { bookPagesSummary, chapterOf, dispatchAndWait, whenSettled, type SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';
import { bookIdentity } from './book';
import { readFileInput, type FileInput } from './resources';
import { controlsOf } from './view';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Largest file handed back inside a result, in bytes; larger ones are
 *  downloaded. */
const MAX_DATA_BYTES = 12 * 1024 * 1024;
/** How long a PDF or an EPUB may take to write. */
const GENERATE_TIMEOUT_MS = 10 * 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function libraryTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;
  const projects = store.projectActions;

  const bookName = (): string => {
    const identity = bookIdentity(host);
    return (identity.name as string | null) ?? 'document';
  };

  const listBooks: WebMcpTool = {
    name: 'sandbox_list_books',
    title: 'Sandbox: the books',
    description: "The books the Sandbox can open: the samples it ships (each in one or more languages; one the reader edited keeps their version) and the reader's own projects, stored in this browser. Says which one is on screen.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => {
      const s = store.getSnapshot();
      return {
        onScreen: bookIdentity(host),
        samples: s.presetSummaries.map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.description ? { description: p.description } : {}),
          ...(p.locales?.length ? { languages: p.locales } : p.locale ? { languages: [p.locale] } : {}),
          ...(p.available ? {} : { available: false }),
          ...(s.hiddenPresetIds.includes(p.id) ? { hidden: true } : {}),
          ...(s.presetDrafts.some((d) => d.presetId === p.id) ? { edited: true } : {}),
        })),
        projects: s.projects.map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.description ? { description: p.description } : {}),
          ...(p.locale ? { language: p.locale } : {}),
          chapters: p.chapterCount,
          updated: new Date(p.updatedAt).toISOString(),
          ...(p.sourcePresetId ? { madeFrom: p.sourcePresetId } : {}),
        })),
      };
    },
  };

  const openBook: WebMcpTool = {
    name: 'sandbox_open_book',
    title: 'Sandbox: open a book',
    description: "Open another book in the Sandbox: a sample (in one of its languages) or one of the reader's projects. The book on screen is saved first. Answers once the new book is laid out, with its chapters and pages.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['sample', 'project'] },
        id: { type: 'string', description: 'The id, as sandbox_list_books gives it.' },
        language: { type: 'string', description: 'A sample in several languages: the one to open (en, es, zh-Hans…). The language of the interface when left out.' },
      },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      if (args.kind === 'sample') {
        const preset = s.presetSummaries.find((p) => p.id === args.id);
        if (!preset) throw new ToolError(`No sample with id ${JSON.stringify(args.id)}. The samples: ${s.presetSummaries.map((p) => p.id).join(', ')}.`);
        if (!preset.available) throw new ToolError('That sample cannot be loaded right now (its files did not answer).');
        const opened = await store.loadPreset(preset.id, args.language as string | undefined);
        if (!opened) throw new ToolError(store.getSnapshot().presetError ?? 'The sample did not open.');
      } else {
        if (!s.projects.some((p) => p.id === args.id)) throw new ToolError(`No project with id ${JSON.stringify(args.id)}. The projects: ${s.projects.map((p) => `${p.id} (${p.name})`).join(', ') || 'none'}.`);
        await projects.activate(args.id as string);
      }
      await sleep(50);
      const laidOut = await whenSettled(host, { signal });
      return { opened: bookIdentity(host), laidOut, book: bookPagesSummary(host) };
    },
  };

  const saveBook: WebMcpTool = {
    name: 'sandbox_save_book',
    title: 'Sandbox: make, copy or rename a book',
    description: "Make a project — the reader's own book, kept in this browser — or tend the list of books: new_blank starts an empty book; copy_current keeps the book on screen as a new project (how a sample becomes the reader's own); duplicate copies a sample or a project without opening the original; rename changes a project's name or description; hide_sample and show_sample take a sample off the list and put it back. A new book is opened at once.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['new_blank', 'copy_current', 'duplicate', 'rename', 'hide_sample', 'show_sample'] },
        kind: { type: 'string', enum: ['sample', 'project'], description: 'duplicate: what the id names.' },
        id: { type: 'string', description: 'duplicate, rename, hide_sample, show_sample: the book.' },
        language: { type: 'string', description: 'duplicate a sample: the language to copy.' },
        name: { type: 'string', description: 'new_blank, copy_current, rename: the name.' },
        description: { type: 'string', description: 'rename: the description (empty clears it).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const name = (args.name as string | undefined)?.trim();
      switch (args.action) {
        case 'new_blank':
        case 'copy_current': {
          const id = await projects.create({ from: args.action === 'new_blank' ? 'blank' : 'current', ...(name ? { name } : {}) });
          await sleep(50);
          const laidOut = await whenSettled(host, { signal });
          return { project: id, opened: bookIdentity(host), laidOut };
        }
        case 'duplicate': {
          if (args.id === undefined || args.kind === undefined) throw new ToolError('duplicate needs the kind and the id of the book to copy.');
          const id = await projects.duplicate({ kind: args.kind === 'sample' ? 'preset' : 'project', id: args.id as string, ...(args.language ? { locale: args.language as string } : {}) });
          await sleep(50);
          const laidOut = await whenSettled(host, { signal });
          return { project: id, opened: bookIdentity(host), laidOut };
        }
        case 'rename': {
          const id = (args.id as string | undefined) ?? s.activeProjectId;
          if (!id || !s.projects.some((p) => p.id === id)) throw new ToolError('rename works on a project: give its id, or open one (a sample becomes a project with copy_current).');
          const current = s.projects.find((p) => p.id === id)!;
          await projects.rename(id, name ?? current.name, args.description as string | undefined);
          return { project: id, name: name ?? current.name };
        }
        case 'hide_sample':
        case 'show_sample': {
          if (!s.presetSummaries.some((p) => p.id === args.id)) throw new ToolError(`No sample with id ${JSON.stringify(args.id)}.`);
          await dispatchAndWait(host, { type: args.action === 'hide_sample' ? 'HIDE_PRESET' : 'UNHIDE_PRESET', payload: args.id as string });
          return { sample: args.id, hidden: store.getSnapshot().hiddenPresetIds.includes(args.id as string) };
        }
        default:
          throw new ToolError(`Unknown action ${JSON.stringify(args.action)}.`);
      }
    },
  };

  const deleteBook: WebMcpTool = {
    name: 'sandbox_delete_book',
    title: 'Sandbox: delete a project',
    description: "Delete one of the reader's projects from this browser, with its chapters, resources and fonts. It cannot be undone (export it first to keep a copy). A sample cannot be deleted, only hidden.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The project\'s id.' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { consequentialHint: true },
    execute: async (args) => {
      const project = store.getSnapshot().projects.find((p) => p.id === args.id);
      if (!project) throw new ToolError(`No project with id ${JSON.stringify(args.id)}.`);
      await projects.remove(project.id);
      await sleep(50);
      return { deleted: project.id, name: project.name, onScreen: bookIdentity(host) };
    },
  };

  const importBook: WebMcpTool = {
    name: 'sandbox_import_book',
    title: 'Sandbox: import a .postext book',
    description: 'Import a .postext file (a book with its chapters, design, resources and fonts in one archive) as a new project, and open it.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'object',
          description: 'The .postext file: where to fetch it (url) or its bytes (base64).',
          properties: { url: { type: 'string' }, base64: { type: 'string' }, fileName: { type: 'string' } },
          additionalProperties: false,
        },
        language: { type: 'string', description: 'A file in several languages: the one to open.' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const file = await readFileInput(args.file as FileInput, signal);
      let id: string;
      try {
        id = await projects.importBundleBytes(await file.arrayBuffer(), file.name, args.language ? { locale: args.language as string } : undefined);
      } catch (err) {
        throw new ToolError(`The file could not be imported: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(50);
      const laidOut = await whenSettled(host, { signal });
      return { project: id, opened: bookIdentity(host), laidOut, book: bookPagesSummary(host) };
    },
  };

  /** The PDF or the EPUB of the book as it is now: the tab is shown, and
   *  its file written again when the book changed since. */
  const generated = async (tab: Extract<ViewportTab, 'pdf' | 'epub'>, signal?: AbortSignal): Promise<{ bytes: Uint8Array; name: string; mime: string }> => {
    if (store.getSnapshot().activeViewport !== tab) await dispatchAndWait(host, { type: 'SET_VIEWPORT', payload: tab });
    const controls = await controlsOf(tab);
    const deadline = Date.now() + GENERATE_TIMEOUT_MS;
    const idle = async (): Promise<void> => {
      // The tab's state follows its last render.
      await sleep(80);
      while (controls.status().generating) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (Date.now() > deadline) throw new ToolError(`The ${tab.toUpperCase()} is taking more than ${GENERATE_TIMEOUT_MS / 60_000} minutes; it is still being written in the ${tab} tab.`);
        await sleep(200);
      }
    };
    await whenSettled(host, { signal });
    await idle();
    let status = controls.status();
    if (status.stale || status.error || !controls.file?.()) {
      await controls.regenerate();
      await idle();
      status = controls.status();
    }
    if (status.error) throw new ToolError(`The ${tab.toUpperCase()} could not be written: ${status.error}`);
    const file = controls.file?.();
    if (!file) throw new ToolError(`The ${tab.toUpperCase()} was not written.`);
    return file;
  };

  const exportBook: WebMcpTool = {
    name: 'sandbox_export',
    title: 'Sandbox: export the book',
    description: "Write the book on screen to a file: pdf (the chapter on screen or the whole book, print-ready), epub (reflowable, or fixed to the printed pages), postext (the whole project in one archive, to open again or hand to the postext command line), docx (Word), markdown (the chapter's source) or config (the design settings as JSON). The file is downloaded by the reader's browser, or — pdf and epub — handed back base64-encoded with deliver: \"data\". Exporting a pdf or an epub shows that viewer tab.",
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['pdf', 'epub', 'postext', 'docx', 'markdown', 'config'] },
        scope: { type: 'string', enum: ['chapter', 'book'], description: 'pdf, docx: the chapter on screen or the whole book (default: as the PDF tab stands; docx: book).' },
        epubLayout: { type: 'string', enum: ['reflowable', 'fixed'], description: 'epub: the rendition (default: as the EPUB tab stands).' },
        chapter: { type: ['integer', 'string'], description: 'markdown: the chapter (position from 1, title or id); the one on screen when left out.' },
        deliver: { type: 'string', enum: ['download', 'data'], description: 'download (default) saves the file through the browser; data hands a pdf or an epub back in the result.' },
      },
      required: ['format'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const format = args.format as string;
      const deliver = (args.deliver as string | undefined) ?? 'download';
      if (deliver === 'data' && format !== 'pdf' && format !== 'epub') {
        throw new ToolError(`Only a pdf or an epub is handed back as data. The ${format} is downloaded; its content is also at hand through ${format === 'markdown' ? 'sandbox_read_text' : format === 'config' ? 'sandbox_get_config' : 'the download'}.`);
      }
      if (format === 'pdf' || format === 'epub') {
        if (format === 'pdf' && args.scope !== undefined && args.scope !== s.pdfScope) await dispatchAndWait(host, { type: 'SET_PDF_SCOPE', payload: args.scope as 'chapter' | 'book' });
        if (format === 'epub' && args.epubLayout !== undefined && args.epubLayout !== s.epubLayout) await dispatchAndWait(host, { type: 'SET_EPUB_LAYOUT', payload: args.epubLayout as 'fixed' | 'reflowable' });
        const file = await generated(format, signal);
        const answer = { format, file: file.name, bytes: file.bytes.byteLength, mimeType: file.mime };
        if (deliver === 'data') {
          if (file.bytes.byteLength > MAX_DATA_BYTES) throw new ToolError(`The ${format} is ${Math.round(file.bytes.byteLength / 1048576)} MB, too large to hand back in a result; ask for it as a download.`);
          return { ...answer, base64: toBase64(file.bytes) };
        }
        downloadBytes(file.bytes, file.name, file.mime);
        return { ...answer, downloaded: true };
      }
      switch (format) {
        case 'postext':
          await projects.exportProject();
          return { format, downloaded: true, file: `${slugify(bookName()) || 'project'}.postext`, ...(store.getSnapshot().projectNotice ? { notice: store.getSnapshot().projectNotice } : {}) };
        case 'docx': {
          const whole = (args.scope ?? 'book') === 'book';
          const active = s.chapters.find((c) => c.id === s.activeChapterId)!;
          const list = (whole ? s.chapters : [active]).map((c) => ({ title: c.title, markdown: c.id === s.activeChapterId ? s.markdown : c.markdown }));
          const bytes = postextToDocx(list, {
            template: emptyTemplate(),
            config: s.config,
            book: whole && s.chapters.length > 1,
            title: bookName(),
            names: { callout: s.labels.wordStyleCallout, calloutTitle: s.labels.wordStyleCalloutTitle, chip: s.labels.wordStyleChip },
          });
          const file = `${slugify(whole ? bookName() : active.title) || 'document'}.docx`;
          downloadBytes(bytes, file, DOCX_MIME);
          return { format, downloaded: true, file, bytes: bytes.byteLength };
        }
        case 'markdown': {
          const { chapter } = chapterOf(s, args.chapter);
          const file = `${slugify(chapter.title) || 'document'}.md`;
          exportMarkdownFile(chapter.id === s.activeChapterId ? s.markdown : chapter.markdown, file);
          return { format, downloaded: true, file };
        }
        case 'config':
          exportConfigToJson(s.config);
          return { format, downloaded: true, file: 'postext-config.json' };
        default:
          throw new ToolError(`Unknown format ${JSON.stringify(format)}.`);
      }
    },
  };

  const getWarnings: WebMcpTool = {
    name: 'sandbox_get_warnings',
    title: 'Sandbox: what the checks found',
    description: "What the Sandbox's Checks panel lists for the chapter on screen, worded as the panel words it: missing fonts and pictures, markup the engine could not read, design elements that do not fit, typesetting faults (loose lines, widows, overflowing boxes) and print preflight. Each comes with its category, the line of the source it points at and, where it names one, the setting or the resource. It waits for the layout to follow the last change. The typesetting checks read the pages of the viewer on screen, so they are current on the canvas, folio and html tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: WARNING_CATEGORY_ORDER, description: 'Only this category.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Most warnings to list (default 100).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const laidOut = await whenSettled(host, { signal });
      // The viewer publishes its document a moment after the layout lands.
      await sleep(120);
      const s = store.getSnapshot();
      const all = store.getWarnings(s);
      const counts: Record<string, number> = {};
      for (const w of all) {
        const category = warningCategory(w.payload.kind);
        counts[category] = (counts[category] ?? 0) + 1;
      }
      const limit = (args.limit as number | undefined) ?? 100;
      const wanted = all.filter((w) => args.category === undefined || warningCategory(w.payload.kind) === args.category);
      return {
        laidOut,
        chapter: s.chapters.findIndex((c) => c.id === s.activeChapterId) + 1,
        viewer: s.activeViewport,
        total: all.length,
        byCategory: counts,
        warnings: wanted.slice(0, limit).map((w) => {
          const payload = w.payload as Record<string, unknown>;
          return {
            kind: w.payload.kind,
            category: warningCategory(w.payload.kind),
            title: titleFor(w.payload, s.labels),
            detail: detailFor(w.payload, s.labels),
            ...(w.chapterIndex !== undefined ? { chapter: w.chapterIndex + 1 } : {}),
            ...(w.chapterLine ?? w.line ? { line: w.chapterLine ?? w.line } : {}),
            ...(typeof payload.path === 'string' ? { setting: payload.path } : {}),
            ...(typeof payload.resourceId === 'string' ? { resource: payload.resourceId } : {}),
            ...(typeof payload.page === 'number' ? { page: payload.page } : {}),
          };
        }),
        ...(wanted.length > limit ? { more: wanted.length - limit } : {}),
      };
    },
  };

  return [listBooks, openBook, saveBook, deleteBook, importBook, exportBook, getWarnings];
}
