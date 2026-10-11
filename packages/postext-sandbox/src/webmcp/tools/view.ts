// How the book is shown: the viewer tab and its settings, the side panel,
// the guides drawn on the pages, and the page on screen.

import { resolveDebugConfig } from 'postext';
import type { PostextConfig } from 'postext';
import { requestSettingsGroup } from '../../context/settingsNavigation';
import { printPreviewOn, setPrintPreview } from '../../print/printPreviewToggle';
import { SETTINGS_GROUPS, isSettingsGroupId } from '../../sidebar/sections/registry';
import { saveSettingsGroup } from '../../storage/persistence';
import { VIEWPORT_TABS, readViewHash, viewHashFragment } from '../../storage/viewHash';
import type { PanelId, ViewportTab } from '../../types';
import { folioSupported } from '../../viewport/folioSupport';
import { viewerControls, type ViewerControls, type ViewerSettings } from '../../viewport/viewerControls';
import { chapterOf, dispatchAndWait, layOutChapter, pageIndexOf, whenSettled, type SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';
import { pagesOfOffset } from '../pageText';

const PANELS: readonly PanelId[] = ['projects', 'chapters', 'markdown', 'resources', 'fonts', 'config', 'warnings'];

/** The viewer settings each tab takes. */
const VIEWER_SETTINGS: Record<keyof ViewerSettings, readonly ViewportTab[]> = {
  zoom: ['canvas'],
  fit: ['canvas'],
  pages: ['canvas'],
  fontScale: ['html', 'epub'],
  columns: ['html'],
  interaction: ['folio'],
  toolbarPinned: ['canvas', 'pdf', 'folio', 'html', 'epub'],
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The controls of `tab` once it is on screen (a tab's code may load on
 *  first use). */
export async function controlsOf(tab: ViewportTab, timeoutMs = 8000): Promise<ViewerControls> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const controls = viewerControls(tab);
    if (controls) return controls;
    if (Date.now() >= deadline) throw new ToolError(`The ${tab} viewer did not come up in time; call again.`);
    await sleep(50);
  }
}

/** The guides the configuration draws on the pages, as switches. */
function guidesOf(config: PostextConfig): Record<string, unknown> {
  const debug = resolveDebugConfig(config.debug);
  return {
    baselineGrid: config.page?.baselineGrid?.enabled ?? false,
    characterGrid: config.cjk?.grid?.show ?? false,
    looseLines: debug.looseLineHighlight.enabled,
    looseLineThreshold: debug.looseLineHighlight.threshold,
    pageNegative: debug.pageNegative.enabled,
    cursorSync: debug.cursorSync.enabled,
    selectionSync: debug.selectionSync.enabled,
  };
}

/** The chapter (its position in the book, from 0) and the page number the
 *  reader is at: what the address carries — a viewer showing the whole
 *  book scrolls through chapters without changing the one being edited —
 *  or the chapter on screen. */
export function screenPosition(host: SandboxToolHost): { chapterIndex: number; page: number | null } {
  const s = host.store.getSnapshot();
  const hash = readViewHash();
  const active = s.chapters.findIndex((c) => c.id === s.activeChapterId);
  const chapterIndex = hash.chapter !== null && hash.chapter >= 0 && hash.chapter < s.chapters.length ? hash.chapter : active;
  return { chapterIndex, page: hash.page };
}

/** How the book is shown right now. */
export function viewState(host: SandboxToolHost): Record<string, unknown> {
  const s = host.store.getSnapshot();
  const at = screenPosition(host);
  const status = viewerControls(s.activeViewport)?.status();
  return {
    viewer: s.activeViewport,
    panel: s.activePanel ?? 'none',
    sidebarWidth: s.sidebarPercent,
    scope: s.activeViewport === 'pdf' ? s.pdfScope : s.canvasScope,
    epubLayout: s.epubLayout,
    chapter: at.chapterIndex + 1,
    ...(at.page !== null ? { page: at.page } : {}),
    printPreview: printPreviewOn(),
    largeTargets: host.largeTargets.get(),
    guides: guidesOf(s.config),
    ...(status ? { [s.activeViewport]: status } : {}),
  };
}

export function viewTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  const setView: WebMcpTool = {
    name: 'sandbox_set_view',
    title: 'Sandbox: change how the book is shown',
    description: 'Change what the reader sees of the Sandbox, any number of settings at once: the viewer tab (canvas, pdf, folio, html, epub), the side panel, whether a viewer shows the chapter or the whole book, the EPUB rendition, the Canvas magnification, fit and facing pages, the type size and columns of the HTML and EPUB readers, the Folio pointer mode, the print preview, pinned toolbars, large touch targets, and the guides drawn on the pages (baseline grid, character grid, loose-line highlight, pages in negative). Answers with the view as it stands afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', enum: VIEWPORT_TABS, description: 'The viewer tab to show.' },
        panel: { type: 'string', enum: [...PANELS, 'none'], description: 'The side panel to open (projects = Books, markdown = Manuscript, config = Design, warnings = Checks), or none to close it.' },
        sidebarWidth: { type: 'number', minimum: 5, maximum: 80, description: 'Width of the side panel, as a percentage of the window.' },
        settingsGroup: { type: 'string', enum: SETTINGS_GROUPS.map((g) => g.id), description: 'Open the Design panel on this group of settings.' },
        resource: { type: 'string', description: 'Open the Resources panel on the resource with this id.' },
        scope: { type: 'string', enum: ['chapter', 'book'], description: 'What the viewer lays out: the chapter on screen or the whole book. Applies to the PDF when that is the viewer, to Canvas, Folio and HTML otherwise.' },
        epubLayout: { type: 'string', enum: ['reflowable', 'fixed'], description: 'The EPUB rendition: text that reflows, or the printed pages kept.' },
        zoom: { type: 'number', minimum: 0.25, maximum: 4, description: 'Canvas: magnification (1 = 100%). Turns the fit off unless fit is given too.' },
        fit: { type: 'string', enum: ['width', 'height', 'none'], description: 'Canvas: fit the page to the width or height of the viewer.' },
        pages: { type: 'string', enum: ['single', 'spread'], description: 'Canvas: one page per row, or facing pages.' },
        fontScale: { type: 'number', minimum: 0.6, maximum: 2.5, description: 'HTML and reflowable EPUB: the reader\'s type size (1 = as designed).' },
        columns: { type: 'string', enum: ['single', 'multi'], description: 'HTML: one scrolling column, or columns paged sideways.' },
        interaction: { type: 'string', enum: ['hand', 'orbit', 'select', 'magnify'], description: 'Folio: what the pointer does on the 3D book.' },
        folioView: { type: 'string', enum: ['reset', 'save'], description: 'Folio: ease the camera back to the configured view, or keep the view on screen as the book\'s.' },
        toolbarPinned: { type: 'boolean', description: 'Keep the viewer\'s floating toolbar on screen.' },
        printPreview: { type: 'boolean', description: 'Canvas and Folio: the soft proof of the output profile with trim, bleed and safe-zone guides.' },
        largeTargets: { type: 'boolean', description: 'Controls at least 44 px, for touch.' },
        guides: {
          type: 'object',
          description: 'Guides drawn on the pages; they are settings of the book (debug.*, page.baselineGrid, cjk.grid).',
          properties: {
            baselineGrid: { type: 'boolean' },
            characterGrid: { type: 'boolean', description: 'The CJK character grid.' },
            looseLines: { type: 'boolean', description: 'Highlight justified lines with wide word spaces.' },
            looseLineThreshold: { type: 'number', minimum: 1, maximum: 5, description: 'How wide the spaces are, as a multiple of the normal space, before a line is highlighted.' },
            pageNegative: { type: 'boolean', description: 'Pages light on dark.' },
            cursorSync: { type: 'boolean', description: 'Show the editor\'s caret on the page.' },
            selectionSync: { type: 'boolean', description: 'Show the editor\'s selection on the page.' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      let s = store.getSnapshot();
      const viewer = (args.viewer as ViewportTab | undefined) ?? s.activeViewport;
      if (args.viewer === 'folio' && !folioSupported()) throw new ToolError('This browser cannot show the Folio (it needs WebGL 2). The canvas shows the same pages flat.');
      for (const [name, tabs] of Object.entries(VIEWER_SETTINGS) as [keyof ViewerSettings, readonly ViewportTab[]][]) {
        if (args[name] !== undefined && !tabs.includes(viewer)) {
          throw new ToolError(`${name} is a setting of the ${tabs.join(' and ')} viewer${tabs.length > 1 ? 's' : ''}, and the viewer is ${viewer}. Set "viewer" in the same call to switch.`);
        }
      }
      if (args.folioView !== undefined && viewer !== 'folio') throw new ToolError(`folioView is for the folio viewer, and the viewer is ${viewer}.`);
      if (args.settingsGroup !== undefined && !isSettingsGroupId(args.settingsGroup)) throw new ToolError('Unknown settings group.');
      if (args.resource !== undefined && !s.resources.some((r) => r.id === args.resource)) {
        throw new ToolError(`No resource with id ${JSON.stringify(args.resource)}. The ids: ${s.resources.map((r) => r.id).join(', ') || 'none'}.`);
      }

      if (args.viewer !== undefined && args.viewer !== s.activeViewport) s = await dispatchAndWait(host, { type: 'SET_VIEWPORT', payload: viewer });
      if (args.scope !== undefined) {
        const scope = args.scope as 'chapter' | 'book';
        s = await dispatchAndWait(host, { type: viewer === 'pdf' ? 'SET_PDF_SCOPE' : 'SET_CANVAS_SCOPE', payload: scope });
        if ((viewer === 'pdf' ? s.pdfScope : s.canvasScope) !== scope) throw new ToolError(`The whole book cannot be shown as one document here (${s.chapters.length} chapters); the scope stays "${viewer === 'pdf' ? s.pdfScope : s.canvasScope}".`);
      }
      if (args.epubLayout !== undefined) s = await dispatchAndWait(host, { type: 'SET_EPUB_LAYOUT', payload: args.epubLayout as 'fixed' | 'reflowable' });
      if (args.sidebarWidth !== undefined) s = await dispatchAndWait(host, { type: 'SET_SIDEBAR_PERCENT', payload: args.sidebarWidth as number });

      if (args.settingsGroup !== undefined) {
        // An open panel takes the request; a closed one opens on the group
        // stored for it.
        if (!requestSettingsGroup(args.settingsGroup)) saveSettingsGroup(args.settingsGroup);
        if (s.activePanel !== 'config') s = await dispatchAndWait(host, { type: 'SET_PANEL', payload: 'config' });
      } else if (args.resource !== undefined) {
        s = await dispatchAndWait(host, [{ type: 'SET_PANEL', payload: 'resources' }, { type: 'SET_ACTIVE_RESOURCE', payload: args.resource as string }]);
      } else if (args.panel !== undefined) {
        s = await dispatchAndWait(host, { type: 'SET_PANEL', payload: args.panel === 'none' ? null : (args.panel as PanelId) });
      }

      if (args.printPreview !== undefined) setPrintPreview(args.printPreview as boolean);
      if (args.largeTargets !== undefined) host.largeTargets.set(args.largeTargets as boolean);

      const settings: ViewerSettings = {};
      for (const name of Object.keys(VIEWER_SETTINGS) as (keyof ViewerSettings)[]) {
        if (args[name] !== undefined) (settings as Record<string, unknown>)[name] = args[name];
      }
      // A change of size or of what is drawn lays the viewer's pages out
      // again: the reader stays on the page they were on.
      const samePages = args.viewer === undefined && args.scope === undefined && (viewer === 'canvas' || viewer === 'html');
      const resized = settings.zoom !== undefined || settings.fit !== undefined || settings.pages !== undefined || settings.fontScale !== undefined || settings.columns !== undefined;
      const keepPage = samePages && (resized || args.guides !== undefined) ? viewerControls(viewer)?.status().pageIndex : undefined;
      if (Object.keys(settings).length > 0 || args.folioView !== undefined) {
        const controls = await controlsOf(viewer);
        if (Object.keys(settings).length > 0) controls.set(settings);
        if (args.folioView === 'reset') controls.resetView?.();
        if (args.folioView === 'save') controls.saveView?.();
      }

      const guides = args.guides as Record<string, unknown> | undefined;
      if (guides && Object.keys(guides).length > 0) {
        const { config } = store.getSnapshot();
        const patch: Partial<PostextConfig> = {};
        if (guides.baselineGrid !== undefined) {
          patch.page = { ...config.page, baselineGrid: { ...config.page?.baselineGrid, enabled: guides.baselineGrid as boolean } };
        }
        if (guides.characterGrid !== undefined) {
          patch.cjk = { ...config.cjk, grid: { ...config.cjk?.grid, show: guides.characterGrid as boolean } };
        }
        const debug = { ...config.debug };
        let debugChanged = false;
        const flag = (key: 'looseLineHighlight' | 'pageNegative' | 'cursorSync' | 'selectionSync', value: unknown) => {
          if (value === undefined) return;
          (debug as Record<string, unknown>)[key] = { ...(debug[key] as object | undefined), enabled: value };
          debugChanged = true;
        };
        flag('looseLineHighlight', guides.looseLines);
        flag('pageNegative', guides.pageNegative);
        flag('cursorSync', guides.cursorSync);
        flag('selectionSync', guides.selectionSync);
        if (guides.looseLineThreshold !== undefined) {
          debug.looseLineHighlight = {
            ...debug.looseLineHighlight,
            enabled: debug.looseLineHighlight?.enabled ?? resolveDebugConfig(config.debug).looseLineHighlight.enabled,
            threshold: guides.looseLineThreshold as number,
          };
          debugChanged = true;
        }
        if (debugChanged) patch.debug = debug;
        await dispatchAndWait(host, { type: 'UPDATE_CONFIG', payload: patch });
      }

      // The viewers take their settings on their next render.
      await sleep(60);
      if (keepPage !== undefined) {
        if (guides && Object.keys(guides).length > 0) await whenSettled(host);
        for (let tries = 0; tries < 12; tries++) {
          const controls = viewerControls(viewer);
          const status = controls?.status();
          if (controls && status && !status.generating && (status.pageCount ?? 0) > keepPage) {
            if (status.pageIndex === keepPage && tries > 0) break;
            controls.goToPage?.(keepPage);
          }
          await sleep(150);
        }
      }
      return { view: viewState(host) };
    },
  };

  const goToPage: WebMcpTool = {
    name: 'sandbox_go_to_page',
    title: 'Sandbox: go to a page',
    description: 'Show a page of the book in the viewer on screen: the next or previous one, a page by the number printed on it or by its position in a chapter, the first page of a chapter, or the page where a passage of the text is set (which also places the selection there when the Manuscript panel is open).',
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: ['next', 'previous'], description: 'Turn one page (or spread, column or EPUB document) forward or back.' },
        chapter: { type: ['integer', 'string'], description: 'The chapter: its position in the book (from 1), its title or its id. The chapter on screen when left out.' },
        page: { type: 'integer', description: 'The page number as printed on the page and shown in the viewer\'s page field.' },
        position: { type: 'integer', minimum: 1, description: 'The page by its position among the chapter\'s pages (from 1); for pages whose number repeats or that carry none.' },
        text: { type: 'string', description: 'Go to where this passage of the Markdown source is set.' },
      },
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      let s = store.getSnapshot();
      if (args.step !== undefined) {
        const controls = await controlsOf(s.activeViewport);
        if (!controls.step) throw new ToolError(`The ${s.activeViewport} viewer has no pages to turn from here; name the page instead.`);
        controls.step(args.step === 'next' ? 1 : -1);
        await sleep(120);
        return { view: viewState(host) };
      }
      const { chapter, index } = chapterOf(s, args.chapter ?? screenPosition(host).chapterIndex + 1);
      const { doc } = await layOutChapter(host, chapter.id, signal);
      let offset: number | null = null;
      let pageIndex = 0;
      if (typeof args.text === 'string' && args.text !== '') {
        const source = chapter.id === s.activeChapterId ? s.markdown : chapter.markdown;
        offset = source.indexOf(args.text);
        if (offset < 0) throw new ToolError(`That passage is not in chapter ${index + 1}; it must match the source exactly. sandbox_search_text finds the chapter a passage is in.`);
        const on = pagesOfOffset(doc, offset);
        if (on.length === 0) throw new ToolError('That passage is in the source but is not set on a page (text inside a directive, or a comment).');
        pageIndex = on[0]! - 1;
      } else {
        pageIndex = pageIndexOf(doc, { position: args.position as number | undefined, number: args.page as number | undefined }, 0);
        if (args.position === undefined && args.page === undefined) {
          // A chapter named alone opens on its first page with content.
          const firstContent = doc.pages.findIndex((p) => !p.blankForParity && !p.blankForForce);
          pageIndex = Math.max(0, firstContent);
        }
      }
      const page = doc.pages[pageIndex]!;
      if (s.activeViewport === 'epub') {
        throw new ToolError('The EPUB reader has no book pages to go to; it is turned with step, or switch the viewer to canvas, folio, html or pdf.');
      }
      // The viewers follow the fragment: the chapter is switched to when
      // it is another one, the page jumped to once it is laid out.
      const fragment = viewHashFragment({ ...readViewHash(), chapter: index, page: page.pageNumberValue });
      if (window.location.hash !== fragment) window.location.hash = fragment;
      if (offset !== null && s.activePanel === 'markdown') {
        await dispatchAndWait(host, { type: 'SET_PENDING_EDITOR_FOCUS', payload: { chapterId: chapter.id, anchor: offset, head: offset + (args.text as string).length, selectWord: false } });
      }
      await sleep(150);
      s = store.getSnapshot();
      return {
        chapter: index + 1,
        position: pageIndex + 1,
        page: page.pageLabel,
        chapterPages: doc.pages.length,
        ...(s.activeViewport === 'pdf' ? { note: 'The PDF opens at this page the next time it is generated.' } : {}),
      };
    },
  };

  return [setView, goToPage];
}
