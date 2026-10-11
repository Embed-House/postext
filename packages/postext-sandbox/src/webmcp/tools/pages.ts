// The laid-out pages: as pictures, and in words.

import { chapterOf, layOutChapter, layoutConfig, pageIndexOf, type SandboxToolHost } from '../host';
import { ToolError, imageResult, type WebMcpTool } from '../modelContext';
import { pageImage, preparePainting, printPreviewFor } from '../pageImage';
import { outlinePages, summarisePage } from '../pageText';
import { screenPosition } from './view';

const CHAPTER_PARAM = {
  type: ['integer', 'string'],
  description: 'The chapter: its position in the book (from 1), its title or its id. The chapter the reader is at when left out.',
} as const;

/** Most pages one call paints. */
const MAX_PAGES = 6;

export function pageTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  /** The page the reader is looking at, as an index into the document of
   *  the chapter it is in; the chapter's first page with content when the
   *  reader is elsewhere. */
  const pageOnScreen = (chapterIndex: number, doc: { pages: readonly { pageNumberValue: number; blankForParity?: boolean; blankForForce?: boolean }[] }): number => {
    const at = screenPosition(host);
    if (at.page !== null && at.chapterIndex === chapterIndex) {
      const found = doc.pages.findIndex((p) => p.pageNumberValue === at.page);
      if (found >= 0) return found;
    }
    return Math.max(0, doc.pages.findIndex((p) => !p.blankForParity && !p.blankForForce));
  };

  const renderPage: WebMcpTool = {
    name: 'sandbox_render_page',
    title: 'Sandbox: a page as a picture',
    description: 'A picture of a page of the book as it is laid out now — the way to see the effect of a change. It waits for the layout to follow the last change, so it can be called right after one. Without a page it gives the one on screen; count gives the pages after it too (2 for a spread). crop magnifies a part of the page for a close look at type and spacing. The picture shows what the settings draw on the page (baseline grid, crop marks), not the caret or the selection. The result is a list of content parts: a JSON text describing each page, then one image per page.',
    inputSchema: {
      type: 'object',
      properties: {
        chapter: CHAPTER_PARAM,
        page: { type: 'integer', description: 'The page number as printed on the page and shown in the viewer\'s page field.' },
        position: { type: 'integer', minimum: 1, description: 'The page by its position among the chapter\'s pages (from 1).' },
        count: { type: 'integer', minimum: 1, maximum: MAX_PAGES, description: `How many consecutive pages, from that one (default 1, at most ${MAX_PAGES}).` },
        width: { type: 'integer', minimum: 160, maximum: 2400, description: 'Width of each picture in pixels (default 900). A crop is given at this width too, so it shows more detail.' },
        format: { type: 'string', enum: ['jpeg', 'png', 'webp'], description: 'Default jpeg.' },
        quality: { type: 'number', minimum: 0.3, maximum: 1, description: 'JPEG or WebP quality (default 0.82).' },
        crop: {
          type: 'object',
          description: 'A part of the page, as fractions of its width and height from the top left corner: { x: 0, y: 0, width: 1, height: 0.5 } is the top half.',
          properties: {
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            width: { type: 'number', minimum: 0.02, maximum: 1 },
            height: { type: 'number', minimum: 0.02, maximum: 1 },
          },
          required: ['x', 'y', 'width', 'height'],
          additionalProperties: false,
        },
        trimmed: { type: 'boolean', description: 'Leave out the margin with the bleed and crop marks, when the layout has cut lines.' },
        printPreview: { type: 'boolean', description: 'Paint the soft proof of the print output profile, with the trim, bleed and safe-zone guides and the preflight marks.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args, { signal }) => {
      const { chapter, index } = chapterOf(store.getSnapshot(), args.chapter ?? screenPosition(host).chapterIndex + 1);
      const { doc, state, settled } = await layOutChapter(host, chapter.id, signal);
      const first = args.position === undefined && args.page === undefined
        ? pageOnScreen(index, doc)
        : pageIndexOf(doc, { position: args.position as number | undefined, number: args.page as number | undefined });
      const count = Math.min((args.count as number | undefined) ?? 1, doc.pages.length - first);
      const crop = args.crop as { x: number; y: number; width: number; height: number } | undefined;
      if (crop && (crop.x + crop.width > 1.0001 || crop.y + crop.height > 1.0001)) {
        throw new ToolError('The crop reaches past the page: x + width and y + height must stay within 1.');
      }
      const config = layoutConfig(state);
      await preparePainting(config, chapter.markdown, state.resources);
      const printPreview = args.printPreview ? await printPreviewFor(config, state.resources, doc).catch((err: Error) => {
        throw new ToolError(`The print preview could not be set up: ${err.message}.`);
      }) : undefined;
      const images = [];
      const pages = [];
      for (let i = first; i < first + count; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const page = doc.pages[i]!;
        const image = pageImage(page, doc, {
          width: (args.width as number | undefined) ?? 900,
          format: (args.format as 'jpeg' | 'png' | 'webp' | undefined) ?? 'jpeg',
          quality: (args.quality as number | undefined) ?? 0.82,
          ...(crop ? { crop } : {}),
          trimmed: !!args.trimmed,
          ...(printPreview ? { printPreview } : {}),
        });
        images.push(image);
        pages.push({
          position: i + 1,
          page: page.pageLabel,
          ...(page.blankForParity || page.blankForForce ? { blank: true } : {}),
          width: image.width,
          height: image.height,
          ...(image.missingImages > 0 ? { picturesNotLoaded: image.missingImages } : {}),
        });
        // Let the page breathe between two paintings.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return imageResult({
        ok: true,
        chapter: index + 1,
        title: chapter.title,
        chapterPages: doc.pages.length,
        ...(settled ? {} : { note: 'The chapters before this one were still being laid out: page numbers may change.' }),
        ...(crop ? { crop } : {}),
        pages,
      }, images);
    },
  };

  const inspectPages: WebMcpTool = {
    name: 'sandbox_inspect_pages',
    title: 'Sandbox: the pages in words',
    description: 'What the layout engine put on the pages of a chapter, as data. Without a page: one line per page of the chapter (its number, whether it is blank, how many lines and figures, how it starts) — the map to pick pages from. With a page: every block on it with its text, column, number of lines, hyphenated lines, loose justified lines and how wide their spaces are, where it sits on the page, plus how full each column is. It waits for the layout to follow the last change.',
    inputSchema: {
      type: 'object',
      properties: {
        chapter: CHAPTER_PARAM,
        page: { type: 'integer', description: 'The page number as printed on the page.' },
        position: { type: 'integer', minimum: 1, description: 'The page by its position among the chapter\'s pages (from 1).' },
        count: { type: 'integer', minimum: 1, maximum: 12, description: 'How many consecutive pages to detail, from that one (default 1).' },
        textLength: { type: 'integer', minimum: 0, maximum: 4000, description: 'Characters of each block\'s text to give (default 240).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const { chapter, index } = chapterOf(store.getSnapshot(), args.chapter ?? screenPosition(host).chapterIndex + 1);
      const { doc, settled } = await layOutChapter(host, chapter.id, signal);
      const base = {
        chapter: index + 1,
        title: chapter.title,
        chapterPages: doc.pages.length,
        converged: doc.converged,
        ...(settled ? {} : { note: 'The chapters before this one were still being laid out: page numbers may change.' }),
      };
      if (args.position === undefined && args.page === undefined) return { ...base, pages: outlinePages(doc) };
      const first = pageIndexOf(doc, { position: args.position as number | undefined, number: args.page as number | undefined });
      const count = Math.min((args.count as number | undefined) ?? 1, doc.pages.length - first);
      const textLength = (args.textLength as number | undefined) ?? 240;
      return { ...base, pages: Array.from({ length: count }, (_, i) => summarisePage(doc, first + i, textLength)) };
    },
  };

  return [renderPage, inspectPages];
}
