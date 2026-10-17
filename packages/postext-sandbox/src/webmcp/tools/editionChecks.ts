// The composed pages' checks of every edition of the book on screen
// (#952): what the Checks panel lists under "Composed pages", for the
// languages of a preset's bundle or of a local project, laid out for the
// tool itself so that the answer does not depend on the panel being open.

import { bookEditionsOf } from '../../editions/bookLocales';
import { layOutLoadedEdition, loadPresetEdition, loadProjectEdition } from '../../editions/editionStore';
import type { EditionLayout } from '../../editions/editionLayout';
import { sameContentLocale, sameLocaleTag } from '../../presets/locale';
import { detailFor, titleFor } from '../../sidebar/WarningsPanel';
import { composedChecksOf, type ComposedCheck } from '../../warnings/composedChecks';
import { warningCategory } from '../../warnings/categories';
import type { SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';

/** An edition's tag as the tool names it (`''` is a book with no language). */
const tagOf = (locale: string): string => locale || 'und';

export function editionCheckTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  const getComposedChecks: WebMcpTool = {
    name: 'sandbox_get_composed_checks',
    title: 'Sandbox: the composed pages checks of every language',
    description: "The checks of a composed book in every edition it has: frames that do not fit, slots, page fences, the contents cut between columns, figure labels and the templates themselves, listed by language, chapter, page and frame as the Checks panel lists them under \"Composed pages\". A preset's bundle or a local project can carry several languages (sandbox_list_books says which); sandbox_get_warnings checks only the chapter you name in the language on screen. Every edition is laid out for this call, the other languages on the layout worker at background priority, so the answer is the same whether the Checks panel is open or not, and a long multilingual book takes a while. language limits it to one edition (a locale tag such as ca, or es-ES); without it all of them are checked. Nothing is switched or changed on screen. To go to a check, open the book in that language with sandbox_open_book (language) and use the chapter and page given here.",
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Only this edition: a locale tag the book carries (sandbox_list_books lists them). All of them when left out.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Most checks to list (default 100).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const book = bookEditionsOf(s);
      let locales = book.locales;
      if (args.language !== undefined) {
        const asked = String(args.language);
        const found = book.locales.find((l) => sameLocaleTag(l, asked)) ?? book.locales.find((l) => sameContentLocale(l, asked));
        if (found === undefined) {
          throw new ToolError(`The book has no edition in ${JSON.stringify(asked)}. Its editions: ${book.locales.map(tagOf).join(', ')}.`);
        }
        locales = [found];
      }
      const clientId = `webmcp-editions:${book.bookKey}`;
      const editions: Record<string, unknown>[] = [];
      const all: { locale: string; check: ComposedCheck }[] = [];
      for (const locale of locales) {
        const onScreen = sameLocaleTag(locale, book.activeLocale) || (locale === '' && book.activeLocale === '');
        try {
          let loaded;
          if (onScreen) {
            // The book on screen, as it is now.
            loaded = {
              source: {
                locale,
                chapters: s.chapters,
                config: s.config,
                resources: s.resources,
                layouts: s.chapterLayouts,
                ...(s.bookStart ? { start: s.bookStart } : {}),
              },
            };
          } else if (book.presetId !== null) {
            const provider = store.presetProvider(book.presetId);
            if (!provider) throw new Error('the sample is not available');
            loaded = await loadPresetEdition(provider, locale, s.presetDrafts);
          } else {
            loaded = await loadProjectEdition(book.projectId!, locale);
          }
          const layout: EditionLayout = await layOutLoadedEdition(host.layout, clientId, loaded, { other: !onScreen, signal });
          const found = composedChecksOf(locale, layout.chapters);
          for (const check of found) all.push({ locale, check });
          editions.push({
            language: tagOf(locale),
            ...(onScreen ? { onScreen: true } : {}),
            chapters: layout.chapters.length,
            laidOut: layout.chapters.filter((c) => c.doc !== null).length,
            settled: layout.settled,
            checks: found.length,
          });
        } catch (err) {
          if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
          editions.push({ language: tagOf(locale), ...(onScreen ? { onScreen: true } : {}), error: err instanceof Error ? err.message : String(err) });
        }
      }
      const limit = (args.limit as number | undefined) ?? 100;
      const { labels, locale: uiLocale } = store.getSnapshot();
      return {
        book: book.presetId !== null ? { sample: book.presetId } : { project: book.projectId },
        editions,
        total: all.length,
        checks: all.slice(0, limit).map(({ locale, check }) => ({
          language: tagOf(locale),
          kind: check.warning.payload.kind,
          category: warningCategory(check.warning.payload.kind),
          title: titleFor(check.warning.payload, labels),
          detail: detailFor(check.warning.payload, labels, uiLocale),
          ...(check.chapterIndex !== null ? { chapter: check.chapterIndex + 1 } : {}),
          ...(check.page !== null ? { page: check.page } : {}),
          ...(check.template !== null ? { template: check.template } : {}),
          ...(check.frame !== null ? { frame: check.frame } : {}),
        })),
        ...(all.length > limit ? { more: all.length - limit } : {}),
      };
    },
  };

  return [getComposedChecks];
}
