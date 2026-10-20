/**
 * The Markdown side of reshaping a template (#1065): the composed pages a
 * template sets in a chapter, their slotted pieces, a piece rewritten for
 * another slot, and a page's text rebuilt with some pieces taken out and
 * others put in. «Turn these frames into a grid» and «Extract a module»
 * write the pages through these, so the content stays in the Markdown and
 * only its slots change.
 *
 * Pure: chapter offsets.
 */

import type { VDTDocument } from 'postext';
import type { TextChange } from '../book/textChanges';
import { pageSites, type PageSites, type SlotSite } from '../viewport/composed/slotSource';
import { pageAreas, templateAreaRect, type Rect } from './frameGeometry';
import { templateFences } from './templateUsage';

/** One composed page of a chapter set with one of the templates asked. */
export interface TemplatePage {
  template: string;
  sites: PageSites;
}

/** The composed pages of `markdown` whose fence names one of `templates`. */
export function pagesOfTemplates(markdown: string, templates: ReadonlySet<string>): TemplatePage[] {
  const out: TemplatePage[] = [];
  for (const f of templateFences(markdown)) {
    if (!templates.has(f.template)) continue;
    const sites = pageSites(markdown, f.fenceStart, markdown.length);
    if (sites) out.push({ template: f.template, sites });
  }
  return out;
}

/** The text of `site` with its slot named `slot` (a site written without
 *  a readable slot value comes back as it is). */
export function siteWithSlot(markdown: string, site: SlotSite, slot: string): string {
  const text = markdown.slice(site.start, site.end);
  if (!site.slotRange) return text;
  const from = site.slotRange.start - site.start;
  const to = site.slotRange.end - site.start;
  return text.slice(0, from) + slot + text.slice(to);
}

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';

/** The text of a block site without its `slot="…"` attribute (`{}` left
 *  empty is taken off too). */
export function siteWithoutSlot(markdown: string, site: SlotSite): string {
  const text = markdown.slice(site.start, site.end);
  if (!site.slotRange) return text;
  let from = site.slotRange.start - site.start;
  let to = site.slotRange.end - site.start;
  // The closing quote, if any.
  if (text[to] === '"' || text[to] === "'") to++;
  // Back over the opening quote, `=`, spaces and the word `slot`.
  if (text[from - 1] === '"' || text[from - 1] === "'") from--;
  while (isSpace(text[from - 1])) from--;
  if (text[from - 1] === '=') from--;
  while (isSpace(text[from - 1])) from--;
  if (text.slice(Math.max(0, from - 4), from) === 'slot') from -= 4;
  // The space before the attribute (not the brace).
  while (isSpace(text[from - 1])) from--;
  let out = text.slice(0, from) + text.slice(to);
  out = out.replace('{}', '');
  return out;
}

/** A `:::frame` site split in its opening line, its content (ending with a
 *  newline, or empty) and its closing line. */
export function frameParts(markdown: string, site: SlotSite): { opener: string; content: string; closer: string } {
  const lineEnd = markdown.indexOf('\n', site.start);
  const openerEnd = lineEnd < 0 || lineEnd > site.contentStart ? site.contentStart : lineEnd;
  const opener = markdown.slice(site.start, openerEnd);
  let content = markdown.slice(site.contentStart, site.contentEnd);
  if (content.trim() === '') content = '';
  else if (!content.endsWith('\n')) content += '\n';
  const closer = markdown.slice(site.contentEnd, site.end).replace(/\n+$/, '');
  return { opener, content, closer: closer || ':::' };
}

/** `site`'s whole text, its slot renamed when `slot` is given. */
export function siteText(markdown: string, site: SlotSite, slot?: string): string {
  return slot === undefined ? markdown.slice(site.start, site.end) : siteWithSlot(markdown, site, slot);
}

/**
 * The page's text with the `remove` sites taken out (each with the line
 * break after it and one blank line, so no gap of blank lines is left) and
 * `insert` written where the first of them stood (else before the page's
 * closing fence), as one change of the chapter (the whole fence).
 */
export function rewritePage(markdown: string, page: PageSites, remove: readonly SlotSite[], insert: string): TextChange {
  const sorted = [...remove].sort((a, b) => a.start - b.start);
  const at = sorted[0]?.start ?? page.closerStart;
  const cuts: { from: number; to: number }[] = [];
  for (const s of sorted) {
    let to = s.end;
    if (markdown[to] === '\n') to++;
    // One blank line after it goes too, when one is left before it.
    if (markdown[to] === '\n' && (s.start === page.openerEnd + 1 || markdown.slice(s.start - 2, s.start) === '\n\n')) to++;
    const last = cuts[cuts.length - 1];
    if (last && s.start < last.to) {
      last.to = Math.max(last.to, to);
      continue;
    }
    cuts.push({ from: s.start, to });
  }
  const block = insert === '' ? '' : insert.endsWith('\n') ? insert : `${insert}\n`;
  const openerLength = page.openerEnd - page.start + 1;
  let text = '';
  let pos = page.start;
  let inserted = false;
  /** The block, a blank line before it (not right under the page's
   *  opening line) and after it (not before the closing fence). */
  const put = (next: number): void => {
    if (inserted || block === '') return;
    inserted = true;
    if (!(text.endsWith('\n\n') || text.length === openerLength)) text += text.endsWith('\n') ? '\n' : '\n\n';
    text += block;
    if (markdown[next] !== '\n' && next < page.closerStart) text += '\n';
  };
  for (const c of cuts) {
    text += markdown.slice(pos, c.from);
    if (c.from === at) put(c.to);
    pos = c.to;
  }
  if (!inserted) {
    text += markdown.slice(pos, page.closerStart);
    pos = page.closerStart;
    put(page.closerStart);
  }
  text += markdown.slice(pos, page.end);
  return { from: page.start, to: page.end, insert: text, expect: markdown.slice(page.start, page.end) };
}

/** A laid composed page's frames (page px by name), its template's area
 *  and the resolution, read in the page's flow frame; null for a page the
 *  conversions do not read (a spread's side). */
export function laidFrames(doc: Pick<VDTDocument, 'pages' | 'trimOffset' | 'config'>, pageIndex: number, area: 'content' | 'trim' | 'bleed' | undefined): { rects: Map<string, Rect>; area: Rect; dpi: number } | null {
  const page = doc.pages[pageIndex];
  const c = page?.composed;
  if (!page || !c || c.spread) return null;
  const vertical = page.flow?.writingMode === 'vertical-rl';
  const size = vertical ? { width: page.height, height: page.width } : { width: page.width, height: page.height };
  const areas = pageAreas({ ...size, contentArea: page.contentArea }, doc.trimOffset);
  return { rects: new Map(c.frames.map((f) => [f.name, f.rect])), area: templateAreaRect(area, areas), dpi: doc.config.page.dpi };
}
