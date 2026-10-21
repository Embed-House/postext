/**
 * The checks of composed pages (#867), across a book's editions: what the
 * Checks panel lists by page, frame and language, and where each one
 * takes the reader (the edition, the chapter, the page, the frame and the
 * slot in the text). Pure: the panel and the canvas read it, the tests
 * too.
 *
 * A composed page is found again in every edition by its fence: the
 * `::::page` fence's ordinal in its chapter (`fenceIndex`) and the frame's
 * name are the same in every language (frame ids are `cp<fence>:<name>`,
 * #857), while the page number may differ from one edition to another.
 */

import type { PostextConfig, VDTDocument, VDTFrame, VDTPage } from 'postext';
import type { Warning, WarningPayload } from './types.js';
import { overlapFocusOf, type OverlapFocusOf } from '../editions/overlapFocus.js';

/** The page-template kinds of the engine's configuration warnings (#853). */
export const PAGE_TEMPLATE_KINDS = [
  'templateDuplicate', 'templateExtendsCycle', 'templateExtendsUnknown', 'frameDuplicate', 'frameStyleUnknown',
  'frameAnchorUnknown', 'frameMinMax', 'groupFrameUnknown', 'groupFrameTwice', 'frameChainLoop',
  'overflowTargetUnknown', 'labelStyleUnknown',
] as const satisfies readonly WarningPayload['kind'][];

/** The kinds a composed book is checked for in every edition: overflow
 *  (and a continuation past its page limit), slots, fences, the contents
 *  cut between columns, figure labels at anchors (#860), design text that
 *  is content, and the templates themselves. */
const COMPOSED_KINDS: ReadonlySet<WarningPayload['kind']> = new Set<WarningPayload['kind']>([
  'frameOverflow', 'frameContinuationLimit', 'continueTargetMissing', 'frameCovered', 'frameOutsideArea', 'repeatOverflow', 'lookUnknown', 'moduleUnknown', 'moduleAsPage', 'moduleNested', 'moduleNameRejected', 'slotUnknown', 'slotEmpty', 'templateUnknown', 'spreadMismatch', 'pageFenceLength',
  'tocGroupSplit', 'labelAnchorUnknown', 'anchorUnlabelled', 'labelOverflow', 'labelOverlap', 'contentInConfig', ...PAGE_TEMPLATE_KINDS,
]);

export function isComposedCheckKind(kind: WarningPayload['kind']): boolean {
  return COMPOSED_KINDS.has(kind);
}

/** One check of one edition, placed. */
export interface ComposedCheck {
  /** Unique across editions. */
  key: string;
  /** The edition's locale tag (`es`, `en`, `ca`); `''` when the book on
   *  screen names none. */
  locale: string;
  warning: Warning;
  /** 0-based chapter, null for the whole book (a template, the design). */
  chapterIndex: number | null;
  /** The number printed on the page (`pageNumberValue`), null when the
   *  check has no page. */
  page: number | null;
  /** The page's index in its chapter's document. */
  pageIndex: number | null;
  /** The `::::page` fence's ordinal in its chapter. */
  fenceIndex: number | null;
  template: string | null;
  /** The frame's name in its template, and its id on the page. */
  frame: string | null;
  frameId: string | null;
}

/** One chapter of an edition, as laid out: its document and its warnings
 *  (chapter-local offsets, as `attributeToChapters` writes them, or the
 *  chapter's own book offsets). */
export interface EditionChapterChecks {
  index: number;
  doc: VDTDocument | null;
  warnings: readonly Warning[];
}

/** The fence a payload names, when it names one. */
function fenceOf(p: WarningPayload): number | null {
  return 'fenceIndex' in p && typeof p.fenceIndex === 'number' ? p.fenceIndex : null;
}

/** The frame a payload names: the frame that overflows or is left empty,
 *  the flow frame that takes an unknown slot's content. */
function frameNameOf(p: WarningPayload): string | null {
  if (p.kind === 'frameOverflow' || p.kind === 'frameContinuationLimit' || p.kind === 'continueTargetMissing' || p.kind === 'slotEmpty' || p.kind === 'frameCovered' || p.kind === 'frameOutsideArea' || p.kind === 'repeatOverflow' || p.kind === 'lookUnknown') return p.frame;
  if (p.kind === 'slotUnknown') return p.frame ?? null;
  return null;
}

/** `/pageTemplates/3/frames/2/style` → template 3, frame 2. */
export function templatePathParts(path: string): { template: number; frame: number | null } | null {
  const m = /^\/pageTemplates\/(\d+)(?:\/frames\/(\d+))?/.exec(path);
  if (!m) return null;
  return { template: Number(m[1]), frame: m[2] !== undefined ? Number(m[2]) : null };
}

/** The template id and frame name a template warning's path points at. */
function templateTarget(config: PostextConfig | undefined, path: string): { template: string | null; frame: string | null } {
  const parts = templatePathParts(path);
  if (!parts) return { template: null, frame: null };
  const t = (config?.pageTemplates as { id?: unknown; frames?: { name?: unknown }[] }[] | undefined)?.[parts.template];
  const template = typeof t?.id === 'string' ? t.id : null;
  const name = parts.frame !== null ? t?.frames?.[parts.frame]?.name : undefined;
  return { template, frame: typeof name === 'string' ? name : null };
}

/** The page of `doc` that sets fence `fenceIndex` (the one holding
 *  `frame`, on a spread), or -1. */
export function composedPageIndex(doc: Pick<VDTDocument, 'pages'>, fenceIndex: number, frame?: string | null): number {
  let first = -1;
  for (let i = 0; i < doc.pages.length; i++) {
    const c = doc.pages[i]!.composed;
    if (!c || c.fenceIndex !== fenceIndex) continue;
    if (first < 0) first = i;
    if (!frame) return i;
    // On a spread both pages carry the fence: the frame is read on the
    // page holding its blocks (a facing copy has none).
    if (c.frames.some((f) => f.name === frame && !(f.facingBlocks && f.blockIds.length === 0))) return i;
  }
  return first;
}

/** The first page of `doc` set with template `template`, or -1. */
function templatePageIndex(doc: Pick<VDTDocument, 'pages'>, template: string): number {
  return doc.pages.findIndex((p) => p.composed?.template === template);
}

/** The document page a warning's book page (`pageIndex + 1 + offset`)
 *  names, or -1. */
function docPageOf(doc: Pick<VDTDocument, 'pages' | 'pageIndexOffset'>, bookPage: number): number {
  const i = bookPage - 1 - (doc.pageIndexOffset ?? 0);
  return i >= 0 && i < doc.pages.length ? i : -1;
}

/** The frame of a composed page that sets resource `resourceId` (a
 *  figure whose labels a warning names), or null. */
function frameWithResource(doc: Pick<VDTDocument, 'blocks'>, page: VDTPage | undefined, resourceId: string): VDTFrame | null {
  if (!page?.composed) return null;
  const blocks = [...(page.floats ?? []), ...doc.blocks];
  for (const frame of page.composed.frames) {
    const ids = new Set(frame.blockIds);
    if (blocks.some((b) => ids.has(b.id) && b.resourceBlock?.resource.id === resourceId)) return frame;
  }
  return null;
}

function frameOn(page: VDTPage | undefined, name: string | null): VDTFrame | null {
  if (!page?.composed || !name) return null;
  return page.composed.frames.find((f) => f.name === name) ?? null;
}

/** The composed checks of one edition: every warning of a composed kind,
 *  with its chapter, page, fence and frame. */
export function composedChecksOf(locale: string, chapters: readonly EditionChapterChecks[]): ComposedCheck[] {
  const out: ComposedCheck[] = [];
  const seenBookWide = new Set<string>();
  for (const ch of chapters) {
    for (const w of ch.warnings) {
      const p = w.payload;
      if (!isComposedCheckKind(p.kind)) continue;
      const doc = ch.doc;
      let fenceIndex = fenceOf(p);
      let frame = frameNameOf(p);
      let template: string | null = 'template' in p && typeof p.template === 'string' ? p.template : null;
      let pageIndex = -1;
      let chapterIndex: number | null = ch.index;
      if (p.kind === 'contentInConfig' || (PAGE_TEMPLATE_KINDS as readonly string[]).includes(p.kind)) {
        // The configuration's: once per edition, whichever chapter found it.
        const id = `${p.kind}|${'path' in p ? p.path : ''}|${'value' in p ? p.value : ''}`;
        if (seenBookWide.has(id)) continue;
        seenBookWide.add(id);
        chapterIndex = null;
        if (p.kind !== 'contentInConfig' && 'path' in p) {
          const target = templateTarget(doc?.config, p.path);
          template = target.template;
          frame = target.frame;
        }
      }
      if (doc) {
        if (p.kind === 'frameOverflow' || p.kind === 'frameContinuationLimit' || p.kind === 'continueTargetMissing' || p.kind === 'frameCovered' || p.kind === 'frameOutsideArea') {
          const i = docPageOf(doc, p.page);
          pageIndex = i >= 0 && doc.pages[i]!.composed?.fenceIndex === p.fenceIndex ? i : composedPageIndex(doc, p.fenceIndex, p.frame);
        } else if (p.kind === 'labelAnchorUnknown' || p.kind === 'anchorUnlabelled' || p.kind === 'labelOverflow' || p.kind === 'labelOverlap') {
          // A figure's label (#860): its page, the frame that sets the figure.
          pageIndex = docPageOf(doc, p.page);
          const page = pageIndex >= 0 ? doc.pages[pageIndex] : undefined;
          const holder = frameWithResource(doc, page, p.resourceId);
          if (page?.composed) {
            fenceIndex = page.composed.fenceIndex;
            template = page.composed.template;
          }
          if (holder) frame = holder.name;
        } else if (p.kind === 'tocGroupSplit') {
          pageIndex = docPageOf(doc, p.page);
        } else if (fenceIndex !== null) {
          pageIndex = composedPageIndex(doc, fenceIndex, frame);
        } else if (template !== null && chapterIndex === null) {
          // A template's own warning: where the edition first sets it.
          pageIndex = templatePageIndex(doc, template);
        }
      }
      const page = doc && pageIndex >= 0 ? doc.pages[pageIndex] : undefined;
      if (page?.composed && fenceIndex === null && template !== null && chapterIndex === null) {
        fenceIndex = page.composed.fenceIndex;
        chapterIndex = ch.index;
      }
      const placed = frameOn(page, frame);
      out.push({
        key: `${locale}|${ch.index}|${w.id}`,
        locale,
        warning: w,
        chapterIndex,
        page: page ? page.pageNumberValue : 'page' in p && typeof p.page === 'number' ? p.page : null,
        pageIndex: page ? pageIndex : null,
        fenceIndex,
        template,
        frame,
        frameId: placed?.id ?? (fenceIndex !== null && frame ? `cp${fenceIndex}:${frame}` : null),
      });
    }
  }
  return out;
}

export type ComposedGroupBy = 'page' | 'frame' | 'locale';

export interface ComposedGroup {
  key: string;
  /** What the group's heading names. */
  chapterIndex: number | null;
  fenceIndex: number | null;
  /** The pages its checks are on, in each edition (one number when the
   *  editions agree). */
  pages: number[];
  frame: string | null;
  locale: string | null;
  items: ComposedCheck[];
}

/** The key of a check's composed page: its fence when it has one (the
 *  same page in every edition), else its page number, else the book. */
export function pageKeyOf(c: ComposedCheck): string {
  if (c.chapterIndex !== null && c.fenceIndex !== null) return `c${c.chapterIndex}:f${c.fenceIndex}`;
  if (c.chapterIndex !== null && c.page !== null) return `c${c.chapterIndex}:p${c.page}`;
  return 'book';
}

/** The key of a check's frame (`book` when it names none). */
export function frameKeyOf(c: ComposedCheck): string {
  return c.frame !== null ? `${pageKeyOf(c)}:${c.frame}` : pageKeyOf(c);
}

function keyFor(c: ComposedCheck, by: ComposedGroupBy): string {
  return by === 'locale' ? `l:${c.locale}` : by === 'frame' ? frameKeyOf(c) : pageKeyOf(c);
}

/** Book order: chapter, page (fence), then template order of frames as the
 *  checks come. Book-wide checks last. */
function compareChecks(a: ComposedCheck, b: ComposedCheck): number {
  const ca = a.chapterIndex ?? Number.MAX_SAFE_INTEGER;
  const cb = b.chapterIndex ?? Number.MAX_SAFE_INTEGER;
  if (ca !== cb) return ca - cb;
  const fa = a.fenceIndex ?? Number.MAX_SAFE_INTEGER;
  const fb = b.fenceIndex ?? Number.MAX_SAFE_INTEGER;
  if (fa !== fb) return fa - fb;
  return (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER);
}

/** The checks grouped by composed page, by frame, or by edition. Groups
 *  follow the book (by page and frame) or `locales` (by edition); inside
 *  a group, the editions keep the order of `locales`. */
export function groupComposedChecks(checks: readonly ComposedCheck[], by: ComposedGroupBy, locales: readonly string[] = []): ComposedGroup[] {
  const rank = (l: string) => {
    const i = locales.indexOf(l);
    return i < 0 ? locales.length : i;
  };
  const sorted = [...checks].sort((a, b) => (by === 'locale' ? rank(a.locale) - rank(b.locale) || compareChecks(a, b) : compareChecks(a, b) || rank(a.locale) - rank(b.locale)));
  const groups = new Map<string, ComposedGroup>();
  for (const c of sorted) {
    const key = keyFor(c, by);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        chapterIndex: by === 'locale' ? null : c.chapterIndex,
        fenceIndex: by === 'locale' ? null : c.fenceIndex,
        pages: [],
        frame: by === 'frame' ? c.frame : null,
        locale: by === 'locale' ? c.locale : null,
        items: [],
      };
      groups.set(key, g);
    }
    g.items.push(c);
    if (by !== 'locale' && c.page !== null && !g.pages.includes(c.page)) g.pages.push(c.page);
  }
  return [...groups.values()];
}

export interface ComposedFilter {
  locale?: string | null;
  /** A {@link pageKeyOf} key. */
  page?: string | null;
  /** A {@link frameKeyOf} key. */
  frame?: string | null;
}

export function filterComposedChecks(checks: readonly ComposedCheck[], filter: ComposedFilter): ComposedCheck[] {
  return checks.filter((c) =>
    (filter.locale == null || c.locale === filter.locale)
    && (filter.page == null || pageKeyOf(c) === filter.page)
    && (filter.frame == null || frameKeyOf(c) === filter.frame));
}

/** Where a check takes the reader. */
export interface FrameJump {
  /** The edition (`''`: the one on screen). */
  locale: string;
  /** 0-based chapter, null: the chapter on screen. */
  chapterIndex: number | null;
  /** The page number in that edition, when known (the fence decides when
   *  the page moved). */
  page: number | null;
  fenceIndex: number | null;
  frame: string | null;
  /** The slot or construct in the chapter's text (chapter offsets). */
  chapterStart?: number;
  chapterEnd?: number;
  /** A check of the design with no page opens the Design panel. */
  panel: 'markdown' | 'config';
  /** An overlap check (#1066): what the canvas draws once there. */
  overlap?: OverlapFocusOf;
}

export function jumpFor(check: ComposedCheck): FrameJump {
  const w = check.warning;
  const start = w.chapterStart ?? w.sourceStart;
  const end = w.chapterEnd ?? w.sourceEnd ?? start;
  const located = start !== undefined;
  const designOnly = check.fenceIndex === null && check.page === null;
  const overlap = overlapFocusOf(w.payload);
  return {
    locale: check.locale,
    chapterIndex: check.chapterIndex,
    page: check.page,
    fenceIndex: check.fenceIndex,
    frame: check.frame,
    ...(located ? { chapterStart: start, chapterEnd: end } : {}),
    panel: designOnly && !located ? 'config' : 'markdown',
    ...(overlap ? { overlap } : {}),
  };
}

/** Where a jump lands in a laid-out chapter: the page, the frame and the
 *  text range to select (offsets of the document's own Markdown). */
export interface ResolvedJump {
  pageIndex: number;
  frame: VDTFrame | null;
  sourceStart?: number;
  sourceEnd?: number;
}

/** A jump resolved against the chapter's document: the page that sets the
 *  fence (else the page number), the frame on it and the frame's content
 *  in the source. Null when the document has neither. */
export function resolveJump(doc: Pick<VDTDocument, 'pages' | 'pageIndexOffset'>, jump: Pick<FrameJump, 'fenceIndex' | 'frame' | 'page'>): ResolvedJump | null {
  let pageIndex = jump.fenceIndex !== null ? composedPageIndex(doc, jump.fenceIndex, jump.frame) : -1;
  if (pageIndex < 0 && jump.page !== null) pageIndex = doc.pages.findIndex((p) => p.pageNumberValue === jump.page);
  if (pageIndex < 0) return null;
  const frame = frameOn(doc.pages[pageIndex], jump.frame);
  return {
    pageIndex,
    frame,
    ...(frame?.sourceStart !== undefined ? { sourceStart: frame.sourceStart, sourceEnd: frame.sourceEnd ?? frame.sourceStart } : {}),
  };
}

/** The composed page `pageIndex` of `doc` is fence `fenceIndex`; the same
 *  fence in another edition's chapter document. */
export function sameComposedPage(from: Pick<VDTDocument, 'pages'>, pageIndex: number, to: Pick<VDTDocument, 'pages'>): number {
  const c = from.pages[pageIndex]?.composed;
  if (!c) return -1;
  return composedPageIndex(to, c.fenceIndex);
}
