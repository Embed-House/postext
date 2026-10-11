// The Sandbox side of a Word import: pictures stored as blobs and turned
// into bitmap / SVG resources, tables into table resources, and the import
// templates kept in the browser.

import { useCallback, useState } from 'react';
import { bitmapInfo, type PostextConfig, type Resource, type ResourceType } from 'postext';
import { newChapter } from '../book/chapterOps';
import type { Chapter } from '../book/types';
import type { SandboxAction } from '../context/SandboxContext';
import { putBlob } from '../storage/blobStore';
import { generateId } from '../storage/ids';
import { isValidSvg, svgIntrinsicSize } from '../panels/resources/svgIntrinsic';
import {
  characterTargetOf,
  lookup,
  paragraphTargetOf,
  parseTemplate,
  pictureResolution,
  wordToPostext,
  type FindingId,
  type ImportResult,
  type ParagraphTarget,
  type QualityReport,
  type WordDocument,
  type WordTemplate,
} from 'postext/word';
import type { SandboxLabels } from '../types';

/** Where an import's text goes: into the open chapter in place of its
 *  text, as new chapters after it, or as the whole book. */
export type WordDestination = 'chapter' | 'append' | 'book';

/** The label that words each finding of the quality report. */
export const FINDING_LABEL: Record<FindingId, keyof SandboxLabels> = {
  allNormal: 'wordFindingAllNormal',
  directFormatting: 'wordFindingDirectFormatting',
  manualHeadings: 'wordFindingManualHeadings',
  lineBreaks: 'wordFindingLineBreaks',
  pageBreaks: 'wordFindingPageBreaks',
  emptyParagraphs: 'wordFindingEmptyParagraphs',
  typedNumbering: 'wordFindingTypedNumbering',
  spacing: 'wordFindingSpacing',
  trackedChanges: 'wordFindingTrackedChanges',
  comments: 'wordFindingComments',
  textBoxes: 'wordFindingTextBoxes',
  unsupportedPictures: 'wordFindingUnsupportedPictures',
  equations: 'wordFindingEquations',
  hiddenText: 'wordFindingHiddenText',
};

/** A count in words: the `…One` label for 1, the other one otherwise. */
export function counted(labels: SandboxLabels, key: keyof SandboxLabels, count: number): string {
  const one = `${String(key)}One` as keyof SandboxLabels;
  const text = (count === 1 && typeof labels[one] === 'string' ? labels[one] : labels[key]) as string;
  return text.replace('__count__', String(count));
}

/** Where a document goes unless asked: a whole book exported from the
 *  Sandbox (chapter markers) comes back as a book; anything else goes
 *  into the open chapter. */
export function defaultWordDestination(doc: WordDocument, template: WordTemplate, config: PostextConfig): WordDestination {
  return doc.blocks.some((b) => b.type === 'paragraph' && paragraphTargetOf(doc, b.styleId, template, config).kind === 'chapter') ? 'book' : 'chapter';
}

/** The document as Postext chapters for `destination`: one chapter to
 *  replace the open one, else a chapter at each of its chapter breaks.
 *  `untitledChapter` names the text before the first break when the
 *  document has no title. */
export function convertWordDocument(
  doc: WordDocument,
  settings: { template: WordTemplate; config: PostextConfig; destination: WordDestination; existingIds: ReadonlySet<string>; untitledChapter: string },
): ImportResult {
  return wordToPostext(doc, {
    template: settings.template,
    config: settings.config,
    chapters: settings.destination === 'chapter' ? 'single' : 'split',
    existingIds: settings.existingIds,
    untitledChapter: doc.title || settings.untitledChapter,
  });
}

/** What a paragraph style named `name` becomes under `template`. */
export function paragraphTargetByName(doc: WordDocument, name: string, template: WordTemplate, config: PostextConfig): ParagraphTarget {
  const styleId = [...doc.styles.values()].find((s) => s.type === 'paragraph' && s.name === name)?.id ?? '';
  return lookup(template.paragraphs, name) ?? paragraphTargetOf(doc, styleId, template, config);
}

/** `template` with every style the document uses written out, so a saved
 *  template says what each one became. */
export function materializedTemplate(doc: WordDocument, template: WordTemplate, report: Pick<QualityReport, 'paragraphStyles' | 'characterStyles'>, config: PostextConfig): WordTemplate {
  const paragraphs = { ...template.paragraphs };
  const characters = { ...template.characters };
  for (const s of report.paragraphStyles) paragraphs[s.name] = paragraphTargetByName(doc, s.name, template, config);
  for (const s of report.characterStyles) characters[s.name] = characterTargetOf(doc, s.name, template, config);
  return { ...template, paragraphs, characters };
}

/** The changes that put an import's chapters into the book: the open
 *  chapter's text replaced, new chapters after it (the first one shown),
 *  or the whole book replaced. */
export function wordImportActions(
  result: Pick<ImportResult, 'chapters'>,
  destination: WordDestination,
  book: { chapters: readonly Chapter[]; activeChapterId: string },
): SandboxAction[] {
  if (destination === 'chapter') return [{ type: 'SET_MARKDOWN', payload: result.chapters[0]?.markdown ?? '' }];
  const made = result.chapters.map((c) => newChapter(generateId('chapter'), c.title, c.markdown));
  if (destination === 'book') return [{ type: 'SET_BOOK', payload: { chapters: made, activeChapterId: made[0]!.id } }];
  const at = Math.max(0, book.chapters.findIndex((c) => c.id === book.activeChapterId)) + 1;
  return made.map((chapter, k) => ({ type: 'ADD_CHAPTER', payload: { chapter, index: at + k, activate: k === 0 } }));
}

const BITMAP_FORMATS: Record<string, 'png' | 'jpeg' | 'webp' | 'gif'> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const typeFor = (types: readonly ResourceType[], wanted: string): string =>
  types.find((t) => t.id === wanted)?.id ?? types[0]?.id ?? wanted;

/** Copy into a buffer of its own (a zip entry is a view on the archive). */
const own = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

/** Resources for the pictures and tables of an import, blobs stored. */
export async function importedResources(result: ImportResult, types: readonly ResourceType[]): Promise<Resource[]> {
  const now = Date.now();
  const out: Resource[] = [];
  const figure = typeFor(types, 'figure');
  for (const pic of result.pictures) {
    const meta = {
      ...(pic.caption ? { caption: pic.caption } : {}),
      ...(pic.alt ? { altText: pic.alt } : {}),
      createdAt: now,
      updatedAt: now,
    };
    try {
      if (pic.media.contentType === 'image/svg+xml') {
        const text = new TextDecoder().decode(pic.media.bytes);
        if (!isValidSvg(text)) continue;
        const fileId = await putBlob(own(pic.media.bytes), 'image/svg+xml');
        out.push({ id: pic.id, typeId: figure, kind: 'svg', svg: { fileId, ...svgIntrinsicSize(text) }, ...meta });
        continue;
      }
      const format = BITMAP_FORMATS[pic.media.contentType];
      if (!format) continue;
      const info = bitmapInfo(pic.media.bytes);
      let width = info?.width ?? 0;
      let height = info?.height ?? 0;
      try {
        const bitmap = await createImageBitmap(new Blob([own(pic.media.bytes)], { type: pic.media.contentType }));
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        // Undecodable here (an odd GIF): the header's size stands.
      }
      // The resolution Word printed it at (its extent), else the file's (#631).
      const fileResolution = pictureResolution(pic, width) ?? info?.resolution?.x;
      const fileId = await putBlob(own(pic.media.bytes), pic.media.contentType);
      out.push({ id: pic.id, typeId: figure, kind: 'bitmap', bitmap: { fileId, format, width, height, ...(fileResolution ? { fileResolution } : {}) }, ...meta });
    } catch {
      // A picture that cannot be stored is left out; its `::resource` line
      // stays and the warnings panel names the missing resource.
    }
  }
  const table = typeFor(types, 'table');
  for (const t of result.tables) {
    out.push({
      id: t.id,
      typeId: table,
      kind: 'table',
      table: { model: t.model },
      ...(t.caption ? { caption: t.caption } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  return out;
}

const LAST_TEMPLATE_KEY = 'postext-sandbox-word-last-template';

export function loadLastTemplateId(): string | null {
  try {
    return window.localStorage.getItem(LAST_TEMPLATE_KEY);
  } catch {
    return null;
  }
}

export function saveLastTemplateId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(LAST_TEMPLATE_KEY, id);
    else window.localStorage.removeItem(LAST_TEMPLATE_KEY);
  } catch {
    // A private window keeps no choice; the dialog falls back to automatic.
  }
}

/** The saved import templates, newest first. `save` and `remove` answer
 *  whether the browser kept the change. */
export function useWordTemplates(): {
  templates: WordTemplate[];
  save: (t: WordTemplate) => boolean;
  remove: (id: string) => boolean;
} {
  const [templates, setTemplates] = useState<WordTemplate[]>(() => loadTemplates());
  const save = useCallback((t: WordTemplate): boolean => {
    const { templates: list, kept } = storeTemplate(t);
    setTemplates(list);
    return kept;
  }, []);
  const remove = useCallback((id: string): boolean => {
    const { templates: list, kept } = removeTemplate(id);
    setTemplates(list);
    return kept;
  }, []);
  return { templates, save, remove };
}

/** Keep `t` among the saved templates, first, in place of the one with
 *  its id. Answers with the list and whether the browser kept it. */
export function storeTemplate(t: WordTemplate): { templates: WordTemplate[]; kept: boolean } {
  const templates = [t, ...loadTemplates().filter((x) => x.id !== t.id)];
  return { templates, kept: saveTemplates(templates) };
}

/** Take the template `id` out of the saved ones. */
export function removeTemplate(id: string): { templates: WordTemplate[]; kept: boolean } {
  const templates = loadTemplates().filter((x) => x.id !== id);
  return { templates, kept: saveTemplates(templates) };
}

// ---------------------------------------------------------------------------
// Browser storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'postext-sandbox-word-templates';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTemplates(): WordTemplate[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map(parseTemplate).filter((t): t is WordTemplate => !!t && !!t.id);
  } catch {
    return [];
  }
}

export function saveTemplates(list: readonly WordTemplate[]): boolean {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
