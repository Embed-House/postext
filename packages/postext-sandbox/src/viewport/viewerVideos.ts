// The videos a viewer plays on its pages, as the tools name them: which
// one a caller means among those the viewer can play. No DOM here; the
// Folio and HTML previews hand in what they hold.

/** A video a viewer can play now. */
export interface PlayableVideo<T> {
  /** The id of the video resource. */
  resource: string;
  /** Position of its page in the viewer's document (0-based). */
  pageIndex: number;
  /** Whether a point of its page lies on its picture (`x`, `y` as
   *  fractions of the page's width and height from its top left corner). */
  contains: (x: number, y: number) => boolean;
  /** What the viewer plays it through. */
  item: T;
}

/** The video of a viewer's document a caller means; every part left out
 *  matches any video. */
export interface VideoPick {
  resource?: string;
  pageIndex?: number;
  x?: number;
  y?: number;
}

/** The first of `videos` that `pick` names, or null. */
export function pickVideo<T>(videos: readonly PlayableVideo<T>[], pick: VideoPick): PlayableVideo<T> | null {
  return videos.find((v) =>
    (pick.resource === undefined || v.resource === pick.resource)
    && (pick.pageIndex === undefined || v.pageIndex === pick.pageIndex)
    && (pick.x === undefined || pick.y === undefined || v.contains(pick.x, pick.y))) ?? null;
}

/** What a preview answers when asked to play a video (page positions are
 *  in its own document; the tab turns them into book page numbers). */
export interface PreviewVideoResult {
  played: boolean;
  resource?: string;
  pageIndex?: number;
  already?: boolean;
  muted?: boolean;
  loading?: boolean;
  reason?: 'none' | 'elsewhere' | 'refused';
  /** Where the video is, when the viewer does not show it now. */
  pageIndexes?: number[];
}

/** A video of a preview and whether it plays. */
export interface PreviewVideo {
  resource: string;
  pageIndex: number;
  state: 'playing' | 'paused' | 'stopped';
}
