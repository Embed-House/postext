/**
 * The selection made on a page of the book (#865): what a click picked,
 * at which level, and the path from the page down to it.
 *
 * The page and the editors are two faces of one book. A click on a page
 * asks the engine's source map (`sourceAt`, #857) what lies there,
 * innermost first: a glyph, its paragraph, the boxes round it, its frame,
 * the frame's groups, the composed page and its template; or a design
 * element (decoration, a running head, a folio) and its slot. The
 * selection keeps that chain and a level in it. One click picks the
 * innermost element; a click again on the same spot, or Esc, climbs one
 * level; the breadcrumb picks any level.
 *
 * Every element of a composed page has a stable id (`cp<fence>:…`), the
 * same after a relayout and in every locale of the chapter, so a
 * selection is found again on the next layout ({@link resolveSelection}),
 * in another view, or after a locale switch.
 *
 * Pure: no DOM, no React. The store and the viewers build on it.
 */

import { elementsForSource, findElement, sourceAt, type SourceElement, type SourceLevel, type SourceMapOptions, type VDTBlock, type VDTDocument, type VDTFrame, type VDTPage } from 'postext';

/** The levels a selection climbs through. A line of text is not one of
 *  them: a click goes from the characters to their paragraph. */
export type PickLevel = Exclude<SourceLevel, 'line'>;

export interface PageSelection {
  /** The page of the document it was made on. */
  pageIndex: number;
  /** What lies at the point, innermost first (lines left out). */
  chain: SourceElement[];
  /** The element picked: an index into `chain`. */
  level: number;
  /** Where the click was (sheet px): a second click there climbs. */
  point: { x: number; y: number };
  /** Made on a page, or following the editor's caret. Only a selection
   *  made on a page climbs with Esc. */
  origin: 'page' | 'editor';
  /** The chapter the page belongs to, when the viewer knows it: the ids of
   *  composed pages are a chapter's own, so another chapter's page is not
   *  taken for it. */
  chapter?: string;
}

/** The chapter each page of a document belongs to (undefined: unknown). */
export type ChapterOfPage = (pageIndex: number) => string | undefined;

/** How near (sheet px) a second click must land to count as a click on
 *  the same spot when it hits another glyph. */
export const SAME_SPOT_PX = 4;

/** The chain of a source-map answer as the selection climbs it: lines
 *  left out, an element listed twice kept once. */
export function climbable(chain: readonly SourceElement[]): SourceElement[] {
  const seen = new Set<string>();
  const out: SourceElement[] = [];
  for (const el of chain) {
    if (el.level === 'line') continue;
    const key = `${el.level}|${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(el);
  }
  return out;
}

/** The element a selection picked. */
export function selectedElement(sel: PageSelection): SourceElement {
  return sel.chain[Math.max(0, Math.min(sel.level, sel.chain.length - 1))]!;
}

/**
 * The selection a click at `(x, y)` of page `pageIndex` makes, given the
 * one before it: the innermost element there, or, for a click again on
 * the spot of a selection made on the page, the element that holds the
 * one picked. Null where nothing is (off the page).
 */
export function pickAt(doc: VDTDocument, pageIndex: number, x: number, y: number, prev: PageSelection | null, options?: SourceMapOptions): PageSelection | null {
  const chain = climbable(sourceAt(doc, pageIndex, x, y, options));
  if (chain.length === 0) return null;
  const point = { x, y };
  if (prev && prev.origin === 'page' && prev.pageIndex === pageIndex) {
    const samePlace = prev.chain[0]?.id === chain[0]!.id
      || Math.hypot(prev.point.x - x, prev.point.y - y) <= SAME_SPOT_PX;
    const picked = selectedElement(prev);
    const k = samePlace ? chain.findIndex((e) => e.id === picked.id && e.level === picked.level) : -1;
    if (k >= 0) return { pageIndex, chain, level: Math.min(k + 1, chain.length - 1), point: prev.point, origin: 'page' };
  }
  return { pageIndex, chain, level: 0, point, origin: 'page' };
}

/** One level up (Esc, a click again): the element that holds the one
 *  picked. Null past the top: the selection is let go. */
export function climb(sel: PageSelection): PageSelection | null {
  if (sel.level + 1 >= sel.chain.length) return null;
  return { ...sel, level: sel.level + 1 };
}

/** The selection at another level of its chain (a breadcrumb item). */
export function atLevel(sel: PageSelection, level: number): PageSelection {
  return { ...sel, level: Math.max(0, Math.min(level, sel.chain.length - 1)) };
}

// ---------------------------------------------------------------------------
// After a relayout
// ---------------------------------------------------------------------------

const centre = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

const inRect = (r: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Where an element of a chain is on `doc`: by its stable id, else (body
 *  text of a page that is not composed, whose ids follow the layout) by
 *  the Markdown it was written in. */
function locate(doc: VDTDocument, el: SourceElement, options: SourceMapOptions | undefined, ofChapter: (pageIndex: number) => boolean): { pageIndex: number; rect?: SourceElement['rect'] } | null {
  if (el.level === 'text') return null;
  // A running head or folio of a page that is not composed: its id names
  // its page (`p<index>:header:<element>`).
  const flowHead = /^p(\d+):(header|footer)(?::(.+))?$/.exec(el.id);
  if (flowHead) {
    const page = doc.pages[Number(flowHead[1])];
    const slot = page?.[flowHead[2] as 'header' | 'footer'];
    if (!page || !slot || page.composed || !ofChapter(page.index)) return null;
    const block = flowHead[3] === undefined ? undefined : slot.blocks.find((b, i) => (b.elementId ?? `#${i}`) === flowHead[3]);
    return { pageIndex: page.index, rect: { ...(block ?? slot).bbox } };
  }
  const byId = findElement(doc, el.id, options);
  if (byId && ofChapter(byId.pageIndex)) return { pageIndex: byId.pageIndex, ...(byId.element.rect ? { rect: byId.element.rect } : {}) };
  if (byId) {
    // The same id on another chapter's page: look on the chapter's own.
    for (const page of doc.pages) {
      if (!ofChapter(page.index)) continue;
      const one = findElement({ ...doc, pages: [page], blocks: doc.blocks.filter((b) => b.pageIndex === page.index) }, el.id, options);
      if (one) return { pageIndex: page.index, ...(one.element.rect ? { rect: one.element.rect } : {}) };
    }
  }
  if (el.level === 'group') {
    // A group is where its frames are: the page of the first one found.
    const fence = /^cp(\d+):group:/.exec(el.id)?.[1];
    for (const page of doc.pages) {
      if (fence === undefined || page.composed?.fenceIndex !== Number(fence) || !ofChapter(page.index)) continue;
      return { pageIndex: page.index };
    }
    return null;
  }
  if (el.source.kind === 'markdown' && (el.level === 'block' || el.level === 'box')) {
    const { start, end } = el.source;
    const hit = elementsForSource(doc, start, end, options).find((m) => ofChapter(m.pageIndex) && m.element.level === el.level && m.element.source.kind === 'markdown' && m.element.source.start === start);
    if (hit) return { pageIndex: hit.pageIndex, ...(hit.element.rect ? { rect: hit.element.rect } : {}) };
  }
  return null;
}

/**
 * The same selection on another layout of the book (a relayout, a locale
 * switch, another view): the element picked found again by its stable id
 * (or the nearest element of its chain that is found), and its chain read
 * again where it now lies. Null when nothing of it is left.
 */
export function resolveSelection(doc: VDTDocument, sel: PageSelection, options?: SourceMapOptions, chapterOf?: ChapterOfPage): PageSelection | null {
  const picked = selectedElement(sel);
  // Only the pages of the selection's chapter, when the document has any
  // (a locale switch may give the chapter another id: then every page).
  const wanted = sel.chapter;
  const anyOfChapter = wanted !== undefined && chapterOf !== undefined && doc.pages.some((p) => chapterOf(p.index) === wanted);
  const ofChapter = (pageIndex: number) => !anyOfChapter || chapterOf!(pageIndex) === wanted;
  // The element picked first, then the ones holding it, then the ones in it.
  const order: number[] = [];
  for (let i = sel.level; i < sel.chain.length; i++) order.push(i);
  for (let i = sel.level - 1; i >= 0; i--) order.push(i);
  for (const i of order) {
    const el = sel.chain[i]!;
    const found = locate(doc, el, options, ofChapter);
    if (!found) continue;
    const page = doc.pages[found.pageIndex];
    if (!page) continue;
    // The click's point, moved as far as the element moved; else the
    // element's centre; else the page's.
    const candidates: { x: number; y: number }[] = [];
    if (found.rect && el.rect) {
      const p = { x: sel.point.x + found.rect.x - el.rect.x, y: sel.point.y + found.rect.y - el.rect.y };
      if (inRect(found.rect, p)) candidates.push(p);
    }
    if (found.rect) candidates.push(centre(found.rect));
    if (!found.rect && found.pageIndex === sel.pageIndex) candidates.push(sel.point);
    candidates.push({ x: page.width / 2, y: page.height / 2 });
    for (const p of candidates) {
      const chain = climbable(sourceAt(doc, found.pageIndex, p.x, p.y, options));
      const at = chain.findIndex((e) => e.id === el.id && e.level === el.level);
      if (at < 0) continue;
      const exact = chain.findIndex((e) => e.id === picked.id && e.level === picked.level);
      // The element picked keeps its level when found; else the nearest
      // element of its chain that was.
      const level = exact >= 0 ? exact : i >= sel.level ? at : Math.min(at, chain.length - 1);
      return { pageIndex: found.pageIndex, chain, level, point: p, origin: sel.origin, ...(sel.chapter !== undefined ? { chapter: chapterOf?.(found.pageIndex) ?? sel.chapter } : {}) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The path (breadcrumb)
// ---------------------------------------------------------------------------

/** What an item of the path names. */
export type CrumbKind =
  | 'page'
  | 'group'
  | 'frame'
  | 'box'
  | 'paragraph'
  | 'heading'
  | 'listItem'
  | 'quote'
  | 'code'
  | 'formula'
  | 'contents'
  | 'figure'
  | 'block'
  | 'picture'
  | 'label'
  | 'attr'
  | 'text'
  | 'decoration'
  | 'header'
  | 'footer'
  | 'design';

export interface Crumb {
  kind: CrumbKind;
  /** The index in the chain it selects; null for the page itself on a page
   *  that is not composed (nothing to select). */
  level: number | null;
  /** The name the book gives it (a frame's, a group's, a design element's,
   *  an attribute's), or the page's number. */
  name?: string;
  /** Its place among its kind in its frame (or on its page): «paragraph 2». */
  n?: number;
  /** Whether it is the element picked. */
  current: boolean;
  /** Inside the element picked (the levels a click went through on its
   *  way up): shown dimmer, to step back down. */
  inner?: true;
}

/** The last name of an id: `cp0:dinero` → `dinero`, `cp0:group:cajas` →
 *  `cajas`, `cp0:decoration:tema` → `tema`. */
export function idName(id: string): string {
  const at = id.lastIndexOf(':');
  return at >= 0 ? id.slice(at + 1) : id;
}

function blockById(doc: VDTDocument, page: VDTPage, id: string): VDTBlock | undefined {
  return page.floats?.find((b) => b.id === id) ?? doc.blocks.find((b) => b.id === id)
    ?? page.composed?.frames.flatMap((f) => f.facingBlocks ?? []).find((b) => b.id === id || b.id === `${id}-facing`);
}

function blockKind(block: VDTBlock | undefined): CrumbKind {
  if (!block) return 'block';
  if (block.tocEntry) return 'contents';
  if (block.resourceBlock) return 'figure';
  switch (block.type) {
    case 'paragraph': return 'paragraph';
    case 'heading': return 'heading';
    case 'listItem': return 'listItem';
    case 'blockquote': return 'quote';
    case 'code': return 'code';
    case 'mathDisplay': return 'formula';
    default: return 'block';
  }
}

/** The blocks an element is counted among: its frame's, else its page's. */
function siblingsOf(doc: VDTDocument, page: VDTPage, frame: VDTFrame | undefined): VDTBlock[] {
  if (frame) {
    const out: VDTBlock[] = [];
    for (const id of frame.blockIds) {
      const b = blockById(doc, page, id);
      if (b) out.push(b);
    }
    return out;
  }
  const onPage = doc.blocks.filter((b) => b.pageIndex === page.index);
  return [...onPage, ...(page.floats ?? []).filter((f) => !onPage.includes(f))];
}

/**
 * The path from the page down to the element picked, outermost first,
 * each item with the level it selects: «Page 8 › cajas › dinero ›
 * paragraph 2». The composed page itself (its template) is the page item.
 */
export function breadcrumb(doc: VDTDocument, sel: PageSelection): Crumb[] {
  const page = doc.pages[sel.pageIndex];
  const pageName = page?.pageLabel ?? String(sel.pageIndex + 1 + (doc.pageIndexOffset ?? 0));
  const out: Crumb[] = [];
  const templateAt = sel.chain.findIndex((e) => e.level === 'template');
  out.push({ kind: 'page', level: templateAt >= 0 ? templateAt : null, name: pageName, current: templateAt >= 0 && templateAt === sel.level });
  const frameEl = sel.chain.find((e) => e.level === 'frame');
  const frame = frameEl && page?.composed ? page.composed.frames.find((f) => f.id === frameEl.id) : undefined;
  for (let i = sel.chain.length - 1; i >= 0; i--) {
    const el = sel.chain[i]!;
    const current = i === sel.level;
    switch (el.level) {
      case 'template':
        continue;
      case 'group':
        out.push({ kind: 'group', level: i, name: idName(el.id), current });
        break;
      case 'frame':
        // A piece of a frame continued on an added page (`cp0:dinero~1`,
        // #859) is named by its slot: the same `:::frame` of the Markdown.
        out.push({ kind: 'frame', level: i, name: idName(el.id).replace(/~\d+$/, ''), current });
        break;
      case 'slot': {
        const name = idName(el.id);
        out.push({ kind: name === 'header' ? 'header' : name === 'footer' ? 'footer' : 'decoration', level: i, current });
        break;
      }
      case 'design':
        out.push({ kind: 'design', level: i, name: idName(el.id), current });
        break;
      case 'box':
      case 'block': {
        const block = page ? blockById(doc, page, el.id) : undefined;
        const kind: CrumbKind = el.level === 'box' ? 'box' : el.heading !== undefined ? 'contents' : blockKind(block);
        let n: number | undefined;
        if (page && block) {
          const same = siblingsOf(doc, page, frame).filter((b) => (el.level === 'box' ? b.type === 'callout' : blockKind(b) === kind));
          const k = same.findIndex((b) => b.id === block.id);
          if (k >= 0) n = k + 1;
        }
        out.push({ kind, level: i, ...(n !== undefined ? { n } : {}), current });
        break;
      }
      case 'resource':
        out.push({ kind: 'picture', level: i, ...(el.source.kind === 'resource' ? { name: el.source.resourceId } : {}), current });
        break;
      case 'label':
        out.push({ kind: 'label', level: i, ...(el.source.kind === 'resource' && el.source.anchor ? { name: el.source.anchor } : {}), current });
        break;
      case 'attr':
        out.push({ kind: 'attr', level: i, ...(el.source.kind === 'attr' ? { name: el.source.name } : {}), current });
        break;
      case 'text':
        if (el.source.kind === 'attr') out.push({ kind: 'attr', level: i, name: el.source.name, current });
        else out.push({ kind: 'text', level: i, current });
        break;
      default:
        break;
    }
  }
  for (const c of out) if (c.level !== null && c.level < sel.level) c.inner = true;
  return out;
}

/** The words of a path item, from the interface strings: `__name__` and
 *  `__n__` filled in. */
export interface CrumbLabels {
  selectionPage: string;
  selectionGroup: string;
  selectionFrame: string;
  selectionBox: string;
  selectionParagraph: string;
  selectionHeading: string;
  selectionListItem: string;
  selectionQuote: string;
  selectionCode: string;
  selectionFormula: string;
  selectionContents: string;
  selectionFigure: string;
  selectionBlock: string;
  selectionPicture: string;
  selectionLabel: string;
  selectionAttr: string;
  selectionText: string;
  selectionDecoration: string;
  selectionHeader: string;
  selectionFooter: string;
  selectionDesign: string;
}

const CRUMB_LABEL: Record<CrumbKind, keyof CrumbLabels> = {
  page: 'selectionPage',
  group: 'selectionGroup',
  frame: 'selectionFrame',
  box: 'selectionBox',
  paragraph: 'selectionParagraph',
  heading: 'selectionHeading',
  listItem: 'selectionListItem',
  quote: 'selectionQuote',
  code: 'selectionCode',
  formula: 'selectionFormula',
  contents: 'selectionContents',
  figure: 'selectionFigure',
  block: 'selectionBlock',
  picture: 'selectionPicture',
  label: 'selectionLabel',
  attr: 'selectionAttr',
  text: 'selectionText',
  decoration: 'selectionDecoration',
  header: 'selectionHeader',
  footer: 'selectionFooter',
  design: 'selectionDesign',
};

/** The text of a path item. A template without `__n__` leaves the number
 *  out; a missing name or number leaves an empty token out. */
export function crumbText(crumb: Crumb, labels: CrumbLabels): string {
  const template = labels[CRUMB_LABEL[crumb.kind]];
  return template
    .replace('__name__', crumb.name ?? '')
    .replace('__n__', crumb.n !== undefined ? String(crumb.n) : '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The path down to the element picked as one line: «Page 8 › cajas ›
 *  dinero › paragraph 2» (`all`: the levels inside it too). */
export function breadcrumbText(crumbs: readonly Crumb[], labels: CrumbLabels, options: { separator?: string; all?: boolean } = {}): string {
  return crumbs.filter((c) => options.all || !c.inner).map((c) => crumbText(c, labels)).join(options.separator ?? ' › ');
}

/**
 * The selection that follows the editor's caret (#865, the editor's side
 * of the link): the innermost block written at `offset` (a document
 * offset), picked at block level, so the path shows where the caret is
 * on the page. Null when no page shows it.
 */
export function selectionAtSource(doc: VDTDocument, offset: number, options?: SourceMapOptions & { pages?: { from: number; to: number } }): PageSelection | null {
  const inPages = (i: number) => !options?.pages || (i >= options.pages.from && i < options.pages.to);
  const matches = elementsForSource(doc, offset, offset, options).filter((m) => inPages(m.pageIndex));
  // The narrowest block first: the paragraph rather than the box round it.
  const blocks = matches.filter((m) => m.element.level === 'block' && m.element.rect && !m.element.facing && !m.element.clipped);
  blocks.sort((a, b) => span(a.element) - span(b.element));
  const hit = blocks[0];
  if (!hit) return null;
  const rect = hit.element.rect!;
  // Its first line, so the point lies on the text (not between columns).
  const line = matches.find((m) => m.element.level === 'line' && m.pageIndex === hit.pageIndex && m.element.id.startsWith(`${hit.element.id}:l`));
  const r = line?.element.rect ?? rect;
  const p = { x: r.x + Math.min(2, r.width / 2), y: r.y + r.height / 2 };
  const chain = climbable(sourceAt(doc, hit.pageIndex, p.x, p.y, options));
  const at = chain.findIndex((e) => e.id === hit.element.id && e.level === 'block');
  if (at < 0) return null;
  return { pageIndex: hit.pageIndex, chain, level: at, point: p, origin: 'editor' };
}

const span = (el: SourceElement): number => (el.source.kind === 'markdown' ? el.source.end - el.source.start : Infinity);
