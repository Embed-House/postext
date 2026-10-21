/**
 * What the comic tools of the previews write, apart from how they are
 * driven: a balloon group or a tail on the move as the tools hold it, and
 * the source changes each gesture ends in (a split line let go, a group
 * dropped or turned, a tail aimed, a pin or a target taken off, a panel
 * split or merged), down to the chapter the changes belong to.
 *
 * Pure: no DOM, no state. The pointer and keyboard handling that builds
 * these moves is in `comicEditing.ts`; the geometry in `comicDrag.ts` and
 * `balloonDrag.ts`; the text changes in `comicSource.ts` and
 * `balloonSource.ts`.
 */

import type { BoundingBox, Resource, VDTComicBalloon, VDTComicPage, VDTComicPanel, VDTComicSplitter, VDTPoint } from 'postext';
import type { ComposedBook } from '../../book/types.js';
import { segmentAtOffset } from '../../book/compose.js';
import { shiftTextChanges, type TextChange } from '../../book/textChanges.js';
import type { SplitterPosition } from './comicDrag.js';
import { canMergeNext, mergePanelChanges, moveSplitterChanges, splitPanelChanges } from './comicSource.js';
import {
  balloonDropIssues,
  balloonEm,
  balloonGrabCentre,
  balloonGroup,
  balloonKeepOut,
  balloonPanel,
  groupBox,
  pageToTailTarget,
  pinAfterMove,
  pinToPage,
  tailTargetNow,
  type BalloonDropIssues,
} from './balloonDrag.js';
import { comicBalloonItem, pinLineChanges, rotateLineChanges, tailLineChanges, unpinLineChanges, untailLineChanges } from './balloonSource.js';

/** A balloon group held by the pointer, or moved from the keyboard. */
export interface BalloonMove {
  page: number;
  comic: VDTComicPage;
  /** The group, its first balloon (whose line is pinned) first. */
  members: VDTComicBalloon[];
  panel: VDTComicPanel;
  /** The centre the move carries (the written pin, else the first
   *  balloon's box centre). */
  centre: VDTPoint;
  /** The box round the group (kept inside the panel). */
  box: BoundingBox;
  /** Sheet travel so far. */
  delta: VDTPoint;
  /** A sound effect's rotation now, and as laid out (degrees). */
  rotate: number;
  rotate0: number;
  /** What the panel's picture keeps clear (faces, avoid zones). */
  keepOut: { faces: BoundingBox[]; avoid: BoundingBox[] };
  /** The line is written with `break`: it may cross the border. */
  breakBorder: boolean;
}

/** A tail on the move: the balloon that carries it, its panel, and the
 *  point it would aim at (sheet px). */
export interface TailMove {
  page: number;
  comic: VDTComicPage;
  balloon: VDTComicBalloon;
  panel: VDTComicPanel;
  /** Where it aims as laid out, and where it would aim now. */
  from: VDTPoint;
  target: VDTPoint;
}

const resourceOf = (resources: readonly Resource[] | null | undefined, id: string | undefined): Resource | undefined =>
  (id ? resources?.find((r) => r.id === id) : undefined);

/** Whether a balloon is a sound effect (by its kind; by its style for a
 *  document laid out before balloons carried one). */
export const isSoundEffect = (b: VDTComicBalloon): boolean => (b.kind ?? (b.style === 'sfx' ? 'sfx' : 'balloon')) === 'sfx';

/** A group to move: its members, its panel and the centre the move
 *  carries; null when its line cannot be found in `markdown` (the text the
 *  page was laid out from). */
export function balloonMoveOf(markdown: string, resources: readonly Resource[] | null | undefined, page: number, comic: VDTComicPage, b: VDTComicBalloon): BalloonMove | null {
  const members = balloonGroup(comic, b);
  const first = members[0];
  const panel = first ? balloonPanel(comic, first) : null;
  if (!first || !panel) return null;
  const item = comicBalloonItem(markdown, comic, first.sourceStart);
  if (!item) return null;
  const rotate = first.rotate ?? 0;
  const keepOut = balloonKeepOut(panel, resourceOf(resources, panel.art?.resourceId), balloonEm(first));
  return {
    page, comic, members, panel,
    centre: balloonGrabCentre(panel, first, item.at),
    box: groupBox(members),
    delta: { x: 0, y: 0 },
    rotate,
    rotate0: rotate,
    keepOut,
    breakBorder: item.break === true,
  };
}

/** What is wrong where a group on the move would land (nothing while it
 *  only turns). `slack`: how far out of its panel it may run before that
 *  counts (sheet px). */
export function moveDropIssues(m: BalloonMove, slack: number): BalloonDropIssues | null {
  if (m.rotate !== m.rotate0) return null;
  const issues = balloonDropIssues(m.members, m.delta, m.panel, m.keepOut, { breakBorder: m.breakBorder, slack });
  return issues.face || issues.avoid || issues.outside ? issues : null;
}

/** The changes that write where a group was moved (or how far it was
 *  turned) on its first line, in `comic` as it is laid out now; null when
 *  it did neither, or its line is gone. */
export function balloonMoveChanges(markdown: string, comic: VDTComicPage, m: BalloonMove): TextChange[] | null {
  const item = comicBalloonItem(markdown, comic, m.members[0]!.sourceStart);
  if (!item) return null;
  if (Math.abs(m.rotate - m.rotate0) >= 0.05) return rotateLineChanges(markdown, item, m.rotate);
  if (Math.hypot(m.delta.x, m.delta.y) < 1e-6) return null;
  return pinLineChanges(markdown, item, pinAfterMove(m.panel, m.centre, m.delta));
}

/** The changes that take a group's pin off (the `at` of its first line);
 *  null when that line has none. */
export function unpinGroupChanges(markdown: string, comic: VDTComicPage, b: VDTComicBalloon): TextChange[] | null {
  const first = balloonGroup(comic, b)[0] ?? b;
  const item = comicBalloonItem(markdown, comic, first.sourceStart);
  return item ? unpinLineChanges(markdown, item) : null;
}

/** Where a balloon's tail handle goes: its tip, else (a target the
 *  lettering drew no tail to, too close to the body) its written `to`;
 *  undefined for a balloon with neither. */
export function tailHandlePointOf(markdown: string | null, comic: VDTComicPage, b: VDTComicBalloon): VDTPoint | undefined {
  if (b.tailTip) return b.tailTip;
  const panel = balloonPanel(comic, b);
  const to = panel && markdown !== null ? comicBalloonItem(markdown, comic, b.sourceStart)?.to : undefined;
  return panel && to ? pinToPage(panel, to) : undefined;
}

/** A tail to move: the balloon that carries it, its panel and where it
 *  aims now (its `to`, else its speaker's mouth, else its tip); null for a
 *  balloon with no tail and no target, or whose line is gone. */
export function tailMoveOf(markdown: string, resources: readonly Resource[] | null | undefined, page: number, comic: VDTComicPage, b: VDTComicBalloon): TailMove | null {
  const panel = balloonPanel(comic, b);
  const item = panel ? comicBalloonItem(markdown, comic, b.sourceStart) : null;
  if (!panel || !item) return null;
  const tip = b.tailTip ?? (item.to ? pinToPage(panel, item.to) : undefined);
  if (!tip) return null;
  const anchor = item.speaker ? resourceOf(resources, panel.art?.resourceId)?.anchors?.find((a) => a.id === item.speaker) : undefined;
  const from = tailTargetNow(panel, tip, item.to, anchor ? { x: anchor.x, y: anchor.y } : undefined);
  return { page, comic, balloon: b, panel, from, target: from };
}

/** Where a tail would aim at a sheet point: on its panel's picture (or
 *  cell), as written. */
export const tailTargetAt = (panel: VDTComicPanel, p: VDTPoint): VDTPoint => pinToPage(panel, pageToTailTarget(panel, p));

/** The changes that write where a tail aims (`to` on its balloon's line),
 *  in `comic` as it is laid out now; null when it aims where it did, or
 *  its line is gone. */
export function tailMoveChanges(markdown: string, comic: VDTComicPage, m: TailMove): TextChange[] | null {
  if (Math.hypot(m.target.x - m.from.x, m.target.y - m.from.y) < 1e-6) return null;
  const item = comicBalloonItem(markdown, comic, m.balloon.sourceStart);
  if (!item) return null;
  return tailLineChanges(markdown, item, pageToTailTarget(m.panel, m.target));
}

/** The changes that point a tail back at its speaker (`to` taken off its
 *  balloon's line); null when the line has none. */
export function untailChanges(markdown: string, comic: VDTComicPage, b: VDTComicBalloon): TextChange[] | null {
  const item = comicBalloonItem(markdown, comic, b.sourceStart);
  return item ? untailLineChanges(markdown, item) : null;
}

/** The changes that write a split line let go at `pos`: nothing when it
 *  is where it was laid out (to a twentieth of a percent); its far end
 *  written too when the line is, or was, slanted. */
export function splitterMoveChanges(markdown: string, comic: VDTComicPage, s: VDTComicSplitter, pos: SplitterPosition): TextChange[] | null {
  if (Math.abs(pos.start - s.startPercent) < 0.05 && Math.abs(pos.end - s.endPercent) < 0.05) return null;
  const slanted = Math.abs(pos.end - pos.start) > 0.05 || Math.abs(s.endPercent - s.startPercent) > 0.05;
  return moveSplitterChanges(markdown, comic, s, pos.start, slanted ? pos.end : undefined);
}

/** The changes that split a panel in two (`'rows'`: one above the other)
 *  or merge it with the next; null when the panel takes neither. */
export function panelEditChanges(markdown: string, comic: VDTComicPage, panelIndex: number, kind: 'rows' | 'columns' | 'merge'): TextChange[] | null {
  if (kind === 'merge' && !canMergeNext(markdown, comic, panelIndex)) return null;
  return kind === 'merge'
    ? mergePanelChanges(markdown, comic, panelIndex)
    : splitPanelChanges(markdown, comic, panelIndex, kind);
}

/** A source edit as the chapter it belongs to takes it
 *  (`EDIT_CHAPTER_MARKDOWN`): chapter offsets, and the chapter's length
 *  when the changes were computed. */
export interface ChapterEdit {
  chapterId: string;
  changes: TextChange[];
  baseLength: number;
}

/** A comic's source edit (offsets in `book`, the text its page was laid
 *  out from) handed to the chapter the comic is in; null when there is
 *  nothing to write, or a change reaches outside that chapter. */
export function chapterEditOf(book: ComposedBook | null, comic: Pick<VDTComicPage, 'sourceStart'>, changes: TextChange[] | null): ChapterEdit | null {
  if (!changes || changes.length === 0) return null;
  if (!book || book.segments.length === 0) return null;
  const seg = segmentAtOffset(book, comic.sourceStart);
  if (changes.some((c) => c.from < seg.start || c.to > seg.end)) return null;
  return { chapterId: seg.chapterId, changes: shiftTextChanges(changes, -seg.start), baseLength: seg.end - seg.start };
}
