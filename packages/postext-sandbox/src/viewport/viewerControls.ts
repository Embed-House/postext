'use client';

// What each viewer tab lets code outside it do: read its own settings
// (zoom, spreads, reader type size — kept in the tab, not in the sandbox
// state), change them, turn its pages and run its buttons. The tab on
// screen registers its controls here; the WebMCP tools (../webmcp) are
// what calls them, so an agent works the viewers the reader sees.

import { useEffect, useRef } from 'react';
import type { ViewportTab } from '../types';

/** The settings a viewer keeps for itself. Each tab takes its own and
 *  ignores the rest. */
export interface ViewerSettings {
  /** Canvas: magnification, applied when `fit` is `none`. */
  zoom?: number;
  /** Canvas: the page fitted to the width or the height of the viewer. */
  fit?: 'none' | 'width' | 'height';
  /** Canvas: one page per row, or facing pages. */
  pages?: 'single' | 'spread';
  /** HTML and EPUB (reflowable): the reader's type size, 1 as designed. */
  fontScale?: number;
  /** HTML: one scrolling column, or screen-high columns paged sideways. */
  columns?: 'single' | 'multi';
  /** Folio: what the pointer does on the book. */
  interaction?: 'hand' | 'orbit' | 'select' | 'magnify';
  /** The floating bar kept on screen. */
  toolbarPinned?: boolean;
}

export interface ViewerStatus extends ViewerSettings {
  /** A layout or a file is being made. */
  generating: boolean;
  /** PDF and EPUB: the book changed since the file on screen was made. */
  stale?: boolean;
  error?: string | null;
  /** Pages of the document on screen. */
  pageCount?: number;
  /** The page on screen: its position in that document (0-based) and the
   *  number it carries in the book. */
  pageIndex?: number;
  pageNumber?: number;
  /** PDF and EPUB: size of the file on screen, in bytes. */
  fileSize?: number | null;
  /** EPUB: the document on screen in the reading order (1-based). */
  position?: number;
  positionCount?: number;
}

export interface ViewerControls {
  status: () => ViewerStatus;
  set: (settings: ViewerSettings) => void;
  /** Lay the document out again, or write the file again. Resolves when
   *  the PDF or the EPUB is written; at once for the previews. */
  regenerate: () => void | Promise<void>;
  /** Show the page at this position of the document on screen (0-based). */
  goToPage?: (pageIndex: number) => void;
  /** The next page, spread, column or document (1), or the one before (-1). */
  step?: (delta: 1 | -1) => void;
  /** PDF and EPUB: the file on screen. */
  file?: () => { bytes: Uint8Array; name: string; mime: string } | null;
  download?: () => void;
  print?: () => void;
  /** Folio: the view the settings give, and the view on screen kept as
   *  the book's (`folio.tilt`, `folio.yaw`). */
  resetView?: () => void;
  saveView?: () => void;
}

const registered = new Map<ViewportTab, ViewerControls>();

/** The controls of the tab on screen, or null while it is not mounted. */
export function viewerControls(tab: ViewportTab): ViewerControls | null {
  return registered.get(tab) ?? null;
}

/** Registers `controls` for `tab` while the calling viewer is mounted.
 *  The object may be new on every render: calls reach the latest one. */
export function useViewerControls(tab: ViewportTab, controls: ViewerControls): void {
  const latest = useRef(controls);
  latest.current = controls;
  useEffect(() => {
    const proxy: ViewerControls = {
      status: () => latest.current.status(),
      set: (settings) => latest.current.set(settings),
      regenerate: () => latest.current.regenerate(),
      goToPage: (pageIndex) => latest.current.goToPage?.(pageIndex),
      step: (delta) => latest.current.step?.(delta),
      file: () => latest.current.file?.() ?? null,
      download: () => latest.current.download?.(),
      print: () => latest.current.print?.(),
      resetView: () => latest.current.resetView?.(),
      saveView: () => latest.current.saveView?.(),
    };
    registered.set(tab, proxy);
    return () => {
      if (registered.get(tab) === proxy) registered.delete(tab);
    };
  }, [tab]);
}
