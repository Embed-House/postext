// Comic pages: where their panels, split lines and balloons lie, and the
// edits a person makes on them with the pointer in the viewers, by
// operation. Every edit is the one the viewers' own comic tools write
// (../../viewport/comics), on the layout the chapter has now.

import type { VDTComicBalloon, VDTPoint } from 'postext';
import { composeBookMemo, segmentForChapter } from '../../book/compose';
import { applyTextChanges, invertTextChanges, type TextChange } from '../../book/textChanges';
import { applyViewerEdit } from '../../editor/viewerEdits';
import { balloonGroup, boxCentre, dragBalloon, pageToTailTarget, pinAfterMove, pinToPage } from '../../viewport/comics/balloonDrag';
import { formatRotate } from '../../viewport/comics/balloonSource';
import { letterboxedPanels, movedPanels, nudgeSplitter, type SplitterPosition } from '../../viewport/comics/comicDrag';
import {
  balloonMoveChanges,
  balloonMoveOf,
  chapterEditOf,
  isSoundEffect,
  moveDropIssues,
  panelEditChanges,
  splitterMoveChanges,
  tailHandlePointOf,
  tailMoveChanges,
  tailMoveOf,
  tailTargetAt,
  unpinGroupChanges,
  untailChanges,
} from '../../viewport/comics/comicEdits';
import { canMergeNext, canSplitPanel } from '../../viewport/comics/comicSource';
import { chapterComics, describeComic, lineAt, outlineComic, partOf, pointOfPage, scriptItemOf, splitterRange, toPercent, type ChapterComic, type ComicPart } from '../comicModel';
import { chapterOf, dispatchAndWait, layOutChapter, pageIndexOf, type SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';
import { layoutAnswer } from './book';
import { screenPosition } from './view';

const CHAPTER_PARAM = {
  type: ['integer', 'string'],
  description: 'The chapter: its position in the book (from 1), its title or its id. The chapter the reader is at when left out.',
} as const;

const POINT_PARAM = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
} as const;

const ACTIONS = ['move_splitter', 'split_panel', 'merge_panel', 'move_balloon', 'unpin_balloon', 'rotate', 'move_tail', 'reset_tail'] as const;
type Action = (typeof ACTIONS)[number];

/** Most changed lines an edit answers with. */
const MAX_LINES = 12;

/** What an action came to: the changes it writes (offsets in the text the
 *  pages were laid out from; null or none when the comic already is as
 *  asked) and what the answer says about it. */
interface Outcome {
  changes: TextChange[] | null;
  answer: Record<string, unknown>;
  /** Why nothing is written, when nothing is. */
  unchanged: string;
}

export function comicTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  /** A chapter laid out, with the text its pages were laid out from and
   *  the comics found on them. */
  const laidOut = async (chapterRef: unknown, signal?: AbortSignal) => {
    const { chapter, index } = chapterOf(store.getSnapshot(), chapterRef ?? screenPosition(host).chapterIndex + 1);
    const { doc, state, settled } = await layOutChapter(host, chapter.id, signal);
    const book = composeBookMemo(state.chapters, chapter.id);
    return { chapter, index, doc, state, settled, book, comics: chapterComics(doc, book.markdown), lineOffset: segmentForChapter(book, chapter.id)?.lineStart ?? 0 };
  };

  const noComics = (chapter: number): string =>
    `Chapter ${chapter} has no comic: no :::page or :::strip block is laid out on its pages. A comic page is written in the chapter's source (the format is documented at /docs/comics); sandbox_edit_text adds one.`;

  const inspectComic: WebMcpTool = {
    name: 'sandbox_inspect_comic',
    title: "Sandbox: a comic page's panels and balloons",
    description: 'The comic pages and strips of a chapter (:::page and :::strip blocks) as data: where their panels, the split lines between them and their balloons lie on the page, which is what a person grabs with the pointer in the viewers. Without a page or a comic: the chapter\'s comics, one line each (number, first source line, pages, split, how many panels, split lines and balloons). With page, position or comic: each comic in full, with every panel (its box, its picture, whether it can be split or merged with the next), every split line (where it is, the range it may move in) and every balloon, caption and sound effect (its script line and line number, kind, speaker, box, pin, tail, rotation). Their numbers, from 1, are the ones sandbox_edit_comic takes. Spaces: box, picture, frame, outline, from, to and tail.tip are fractions of the page from its top left corner, as the crop of sandbox_render_page (a box can be handed to it as it is); picture is where a panel\'s whole picture lies, past the panel where it is cropped; inComic is a panel\'s box in fractions of the comic\'s frame; a split line\'s start, end and range are percent of the cell it cuts, as the fence\'s split writes them (from the top for axis "rows", from the side the page is read from for "columns"); a balloon\'s centre, at and tail.to are percent of its panel\'s picture as stored (of the panel\'s box when it has no picture), as the script writes at="x% y%". It waits for the layout to follow the last change. sandbox_inspect_pages puts the rest of a page into words; sandbox_read_text gives the script.',
    inputSchema: {
      type: 'object',
      properties: {
        chapter: CHAPTER_PARAM,
        page: { type: 'integer', description: 'The comics on the page with this number, as printed on the page.' },
        position: { type: 'integer', minimum: 1, description: "The comics on the page at this position among the chapter's pages (from 1)." },
        comic: { type: 'integer', minimum: 1, description: 'One comic by its number in the chapter (from 1), whatever page it is on.' },
        textLength: { type: 'integer', minimum: 0, maximum: 2000, description: "Characters of each balloon's script line to give (default 160)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const at = await laidOut(args.chapter, signal);
      const base = {
        chapter: at.index + 1,
        title: at.chapter.title,
        chapterPages: at.doc.pages.length,
        ...(at.settled ? {} : { note: 'The chapters before this one were still being laid out: page numbers may change.' }),
      };
      if (at.comics.length === 0) return { ...base, comics: [], note: noComics(at.index + 1) };
      const detail = (list: readonly ChapterComic[]) => list.map((c) => describeComic(c, at.book.markdown, at.lineOffset, (args.textLength as number | undefined) ?? 160));
      if (args.comic !== undefined) {
        const comic = at.comics[(args.comic as number) - 1];
        if (!comic) throw new ToolError(`Chapter ${at.index + 1} has ${at.comics.length} comic(s); comic ${args.comic as number} is not one of them.`);
        return { ...base, comics: detail([comic]) };
      }
      if (args.position === undefined && args.page === undefined) {
        return { ...base, comics: at.comics.map((c) => outlineComic(c, at.book.markdown, at.lineOffset)) };
      }
      const pageIndex = pageIndexOf(at.doc, { position: args.position as number | undefined, number: args.page as number | undefined });
      const onPage = at.comics.filter((c) => c.parts.some((p) => p.pageIndex === pageIndex));
      return {
        ...base,
        position: pageIndex + 1,
        page: at.doc.pages[pageIndex]!.pageLabel,
        comics: detail(onPage),
        ...(onPage.length === 0 ? { note: `No comic on this page. The chapter's comics are on the pages at positions ${[...new Set(at.comics.flatMap((c) => c.parts.map((p) => p.pageIndex + 1)))].join(', ')}.` } : {}),
      };
    },
  };

  const editComic: WebMcpTool = {
    name: 'sandbox_edit_comic',
    title: 'Sandbox: edit a comic page',
    description: 'One edit of a comic page or strip, as a person makes it with the pointer in the viewers: it is written into the chapter\'s source (the fence\'s split, an attribute of a script line) and the reader can undo it with Ctrl/Cmd+Z over the pages. The comic and its panel, split line or balloon are named by their numbers in sandbox_inspect_comic. Actions: move_splitter moves a split line to start, in percent of the cell it cuts (the line keeps its slant), or each of its ends with end too (a slanted line), within the range that leaves every cell 5 %; split_panel cuts a panel in two (direction "rows": one above the other; "columns": side by side) and adds an empty ::panel after it; merge_panel merges a panel with the next one of its row or column, keeping the first one\'s picture and both scripts; move_balloon pins a balloon with its centre at a point (at="x% y%" on its line), kept inside its panel, and balloons joined in one outline move together, the pin written on the first; unpin_balloon takes the pin off, so the engine places the balloon again; rotate turns a sound effect to degrees (clockwise, 0 upright); move_tail points a balloon\'s tail at a point (to="x% y%"); reset_tail points it back at its speaker. A point (at, to) is in percent of the panel\'s picture as the script writes it (0 0 its top left corner, 100 100 its bottom right; of the panel\'s box when it has no picture) or, with space "page", in fractions of the page from its top left corner, as read off a picture from sandbox_render_page. It answers with the source lines as they are now, the position written, clamped when it was held back, issues when a balloon lands on a face or on a part of the picture kept clear or runs out of its panel, letterboxed with the panels whose picture no longer fills its cell with the line there, and the pages the book came to. Nothing is written when the comic already is as asked (changed: false). To rewrite the script or the split by hand, sandbox_edit_text.',
    inputSchema: {
      type: 'object',
      properties: {
        chapter: CHAPTER_PARAM,
        comic: { type: 'integer', minimum: 1, description: 'The comic by its number in the chapter (from 1), as sandbox_inspect_comic gives it.' },
        action: { type: 'string', enum: ACTIONS },
        splitter: { type: 'integer', minimum: 1, description: 'move_splitter: the split line (from 1).' },
        start: { type: 'number', minimum: 0, maximum: 100, description: 'move_splitter: where the line goes, in percent of the cell it cuts (its start end, when end is given too).' },
        end: { type: 'number', minimum: 0, maximum: 100, description: 'move_splitter: where the far end of the line goes, for a slanted line. Left out, the line moves whole and keeps its slant.' },
        panel: { type: 'integer', minimum: 1, description: 'split_panel, merge_panel: the panel (from 1, in reading order).' },
        direction: { type: 'string', enum: ['rows', 'columns'], description: 'split_panel: "rows" cuts with a horizontal line (one panel above the other), "columns" with a vertical one.' },
        balloon: { type: 'integer', minimum: 1, description: 'move_balloon, unpin_balloon, rotate, move_tail, reset_tail: the balloon, caption or sound effect (from 1, in reading order).' },
        at: { ...POINT_PARAM, description: 'move_balloon: where the centre of the balloon goes.' },
        to: { ...POINT_PARAM, description: 'move_tail: the point the tail aims at.' },
        space: { type: 'string', enum: ['picture', 'page'], description: 'What at and to are measured in: "picture" (default), percent of the panel\'s picture (of its box when it has none); "page", fractions (0 to 1) of the page the balloon is on, from its top left corner.' },
        degrees: { type: 'number', minimum: -360, maximum: 360, description: 'rotate: the angle, clockwise.' },
        wait: { type: 'boolean', description: 'Wait for the book to be laid out again and answer with the pages each chapter came to (default true). False answers at once.' },
      },
      required: ['comic', 'action'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const at = await laidOut(args.chapter, signal);
      const action = args.action as Action;
      const chapterNumber = at.index + 1;
      if (at.comics.length === 0) throw new ToolError(noComics(chapterNumber));
      const comic = at.comics[(args.comic as number) - 1];
      if (!comic) throw new ToolError(`Chapter ${chapterNumber} has ${at.comics.length} comic(s); comic ${args.comic as number} is not one of them. sandbox_inspect_comic lists them.`);
      if (!comic.source) throw new ToolError('The source no longer holds this comic where the layout read it. Call again.');
      const markdown = at.book.markdown;
      const { whole } = comic;
      const dpi = (at.doc.config as { page?: { dpi?: number } }).page?.dpi ?? 300;

      /** The argument an action cannot do without. */
      const need = <T>(name: string, what: string): T => {
        if (args[name] === undefined) throw new ToolError(`${action} needs "${name}": ${what}.`);
        return args[name] as T;
      };
      /** The element an argument numbers (from 1). */
      const pick = <T>(list: readonly T[], name: 'splitter' | 'balloon', noun: string): T => {
        const n = need<number>(name, `the ${noun}'s number in sandbox_inspect_comic`);
        const found = list[n - 1];
        if (!found) throw new ToolError(`Comic ${comic.number} has ${list.length} ${noun}(s); ${noun} ${n} is not one of them.`);
        return found;
      };
      /** A point given in the space asked for, on the sheet. */
      const pointOf = (name: 'at' | 'to', part: ComicPart, panel: Parameters<typeof pinToPage>[0]): VDTPoint => {
        const p = need<{ x: number; y: number }>(name, name === 'at' ? 'the point the centre of the balloon goes to' : 'the point the tail aims at');
        if (args.space !== 'page') return pinToPage(panel, { x: p.x / 100, y: p.y / 100 });
        if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) throw new ToolError(`With space "page", ${name} is in fractions of the page: x and y from 0 to 1.`);
        return pointOfPage(part.page, p);
      };
      const percentPoint = (p: { x: number; y: number }) => ({ x: toPercent(p.x), y: toPercent(p.y) });
      const far = (a: VDTPoint, b: VDTPoint): boolean => Math.hypot(a.x - b.x, a.y - b.y) > 0.5;

      const panelAction = (kind: 'rows' | 'columns' | 'merge'): Outcome => {
        const n = need<number>('panel', "the panel's number in sandbox_inspect_comic");
        const index = whole.panels.findIndex((p) => p.index === n - 1);
        if (index < 0) throw new ToolError(`Comic ${comic.number} has ${whole.panels.length} panel(s); panel ${n} is not one of them.`);
        if (!canSplitPanel(markdown, whole, index)) {
          throw new ToolError(`Panel ${n} fills no cell of the page's split (an inset panel is laid over the panel before it), so it can be neither split nor merged. Its inset attribute is edited in the source, with sandbox_edit_text.`);
        }
        if (kind === 'merge' && !canMergeNext(markdown, whole, index)) {
          throw new ToolError(`Panel ${n} has no panel to merge with: it is the last of its row or column, or the cell after it is split further (merge the panels of that cell first). canMergeNext in sandbox_inspect_comic says which panels have one.`);
        }
        const changes = panelEditChanges(markdown, whole, index, kind);
        if (!changes || changes.length === 0) throw new ToolError(`Panel ${n} could not be ${kind === 'merge' ? 'merged' : 'split'}: the page's split value could not be rewritten.`);
        return { changes, answer: { panel: n }, unchanged: '' };
      };

      /** The balloon an action names, on the page it is laid out on. */
      const balloonAt = () => {
        const b = pick(whole.balloons, 'balloon', 'balloon');
        return { b, n: whole.balloons.indexOf(b) + 1, part: partOf(comic, b) };
      };
      const numberOf = (b: VDTComicBalloon): number => whole.balloons.indexOf(b) + 1;
      const notScript = (n: number): string => `Balloon ${n} is text written outside a script line (no "key:" before it), so it has no attributes to write. Give it a key in the source (caption: …) with sandbox_edit_text first.`;

      const outcome = ((): Outcome => {
        switch (action) {
          case 'move_splitter': {
            const s = pick(whole.splitters, 'splitter', 'splitter');
            const start = need<number>('start', 'where the line goes, in percent of the cell it cuts');
            const end = args.end as number | undefined;
            const from: SplitterPosition = { start: s.startPercent, end: s.endPercent };
            let pos: SplitterPosition;
            if (end === undefined) pos = nudgeSplitter(whole, s, from, start - from.start);
            else {
              const first = nudgeSplitter(whole, s, from, start - from.start, { only: 'start' });
              pos = nudgeSplitter(whole, s, first, end - first.end, { only: 'end' });
            }
            const clamped = Math.abs(pos.start - start) > 0.05 || (end !== undefined && Math.abs(pos.end - end) > 0.05);
            const part = partOf(comic, s);
            const letterboxed = letterboxedPanels(part.comic, movedPanels(part.comic, s, pos), at.state.resources);
            return {
              changes: splitterMoveChanges(markdown, whole, s, pos),
              answer: {
                splitter: whole.splitters.indexOf(s) + 1,
                start: pos.start,
                end: pos.end,
                ...(clamped ? { clamped: true, range: splitterRange(comic, s) } : {}),
                // The panels whose picture's safe area no longer fits their cell.
                ...(letterboxed.length > 0 ? { letterboxed: letterboxed.map((i) => i + 1) } : {}),
              },
              unchanged: 'The line is already there.',
            };
          }
          case 'split_panel':
            return panelAction(need<'rows' | 'columns'>('direction', '"rows" (one panel above the other) or "columns" (side by side)'));
          case 'merge_panel':
            return panelAction('merge');
          case 'move_balloon': {
            const { b, n, part } = balloonAt();
            const m = balloonMoveOf(markdown, at.state.resources, part.pageIndex, part.comic, b);
            if (!m) throw new ToolError(notScript(n));
            const target = pointOf('at', part, m.panel);
            // The group travels as far as the balloon named does.
            const grabbed = b === m.members[0] ? m.centre : boxCentre(b.bbox);
            const want = { x: m.centre.x + target.x - grabbed.x, y: m.centre.y + target.y - grabbed.y };
            const moved = { ...m, delta: dragBalloon(m.centre, m.centre, want, m.panel.bbox, { box: m.box }) };
            const issues = moveDropIssues(moved, dpi / 96);
            return {
              changes: balloonMoveChanges(markdown, part.comic, moved),
              answer: {
                balloon: numberOf(m.members[0]!),
                at: percentPoint(pinAfterMove(m.panel, m.centre, moved.delta)),
                ...(far({ x: m.centre.x + moved.delta.x, y: m.centre.y + moved.delta.y }, want) ? { clamped: true } : {}),
                ...(issues ? { issues: [...(issues.face ? ['It covers a face.'] : []), ...(issues.avoid ? ['It covers a part of the picture kept clear.'] : []), ...(issues.outside ? ['It runs out of the panel.'] : [])] } : {}),
              },
              unchanged: 'The balloon is already there.',
            };
          }
          case 'unpin_balloon': {
            const { b, n, part } = balloonAt();
            const first = balloonGroup(part.comic, b)[0] ?? b;
            return { changes: unpinGroupChanges(markdown, part.comic, b), answer: { balloon: numberOf(first) }, unchanged: `Balloon ${n} is not pinned: its line writes no at.` };
          }
          case 'rotate': {
            const { b, n, part } = balloonAt();
            const degrees = need<number>('degrees', 'the angle, clockwise');
            const m = balloonMoveOf(markdown, at.state.resources, part.pageIndex, part.comic, b);
            if (!m) throw new ToolError(notScript(n));
            if (m.members.length !== 1 || !isSoundEffect(m.members[0]!)) {
              throw new ToolError(`Only a sound effect turns (a script line whose key is sfx); balloon ${n} is a ${b.kind}.`);
            }
            return {
              changes: balloonMoveChanges(markdown, part.comic, { ...m, rotate: degrees }),
              answer: { balloon: n, rotate: Number(formatRotate(degrees)) },
              unchanged: 'The sound effect is already at that angle.',
            };
          }
          case 'move_tail': {
            const { b, n, part } = balloonAt();
            // The balloon of the group that carries the tail.
            const tailed = [b, ...balloonGroup(part.comic, b)].find((o) => tailHandlePointOf(markdown, part.comic, o) !== undefined);
            const m = tailed ? tailMoveOf(markdown, at.state.resources, part.pageIndex, part.comic, tailed) : null;
            if (!m) throw new ToolError(`Balloon ${n} has no tail to aim: a caption, a sound effect, or a balloon whose style or tail=none draws none. tail in sandbox_inspect_comic says which balloons have one.`);
            const asked = pointOf('to', part, m.panel);
            const target = tailTargetAt(m.panel, asked);
            return {
              changes: tailMoveChanges(markdown, part.comic, { ...m, target }),
              answer: { balloon: numberOf(m.balloon), to: percentPoint(pageToTailTarget(m.panel, target)), ...(far(target, asked) ? { clamped: true } : {}) },
              unchanged: 'The tail already aims there.',
            };
          }
          case 'reset_tail': {
            const { b, n, part } = balloonAt();
            const written = [b, ...balloonGroup(part.comic, b)].find((o) => scriptItemOf(comic.source, o)?.to !== undefined);
            return {
              changes: written ? untailChanges(markdown, part.comic, written) : null,
              answer: { balloon: written ? numberOf(written) : n },
              unchanged: `Balloon ${n}'s tail already points at its speaker: its line writes no to.`,
            };
          }
          default:
            throw new ToolError(`Unknown action ${JSON.stringify(action)}. The actions: ${ACTIONS.join(', ')}.`);
        }
      })();

      const head = { chapter: chapterNumber, comic: comic.number, action, ...outcome.answer };
      if (!outcome.changes || outcome.changes.length === 0) return { ...head, changed: false, note: outcome.unchanged };
      const edit = chapterEditOf(at.book, whole, outcome.changes);
      if (!edit) throw new ToolError('The edit reaches outside the chapter the comic is in, so nothing was written.');
      const stale = 'The chapter changed while its comic was being read, so nothing was written. Call again.';
      const s = store.getSnapshot();
      const before = edit.chapterId === s.activeChapterId ? s.markdown : s.chapters.find((c) => c.id === edit.chapterId)?.markdown;
      if (before === undefined || before.length !== edit.baseLength) throw new ToolError(stale);
      // The edit goes the way the viewers send theirs, so the reader's undo
      // over the pages takes it back; `dispatchAndWait` only waits for it.
      const landed = dispatchAndWait(host, []);
      applyViewerEdit(store.dispatch, edit.chapterId, edit.changes, edit.baseLength);
      const after = await landed;
      const now = edit.chapterId === after.activeChapterId ? after.markdown : after.chapters.find((c) => c.id === edit.chapterId)?.markdown;
      if (now !== applyTextChanges(before, edit.changes)) throw new ToolError(stale);
      return { ...head, changed: true, lines: changedLines(now, edit.changes), ...(await layoutAnswer(host, args.wait, signal)) };
    },
  };

  return [inspectComic, editComic];
}

/** The lines of `text` (a chapter after `changes`) the changes wrote on,
 *  each with its number: where text was only taken out, the line it was
 *  taken from. */
function changedLines(text: string, changes: readonly TextChange[]): { line: number; text: string }[] {
  const all = text.split('\n');
  const lines = new Set<number>();
  for (const c of invertTextChanges(changes)) {
    const first = lineAt(text, c.from);
    // A change that ends with its line's break stops on that line.
    const last = lineAt(text, c.to > c.from && text[c.to - 1] === '\n' ? c.to - 1 : c.to);
    for (let line = first; line <= Math.min(last, all.length); line++) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b).slice(0, MAX_LINES).map((line) => ({ line, text: all[line - 1] ?? '' }));
}
