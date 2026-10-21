/**
 * Where a selection made on a page leads (#865): content to the Markdown,
 * form to the configuration.
 *
 * - Content mode opens the Markdown: a glyph puts the caret at it, a
 *   paragraph, a box, a frame's content or a composed page's fence is
 *   selected there, a figure label at its text, an attribute shown on the
 *   page (`{attr.x}`, a box's tab) at its value in the fence, a contents
 *   entry at the heading it lists.
 * - Design mode opens the form: a frame, a group or the template in the
 *   page-template editor, a box's style, a paragraph's or a heading's
 *   settings.
 * - Whatever the mode, what is not content goes to its form: decoration to
 *   its template, a running head or a folio to its design element, a
 *   picture to the Resources panel.
 *
 * Pure: the store and the viewers carry the targets out.
 */

import type { SourceElement, VDTBlock, VDTDocument, VDTFrame, VDTPage } from 'postext';
import { extractFrontmatter } from 'postext';
import { SETTINGS_SECTIONS, type SettingsGroupId, type SettingsSectionId } from '../sidebar/sections/registry.js';
import type { EditMode } from '../editing/editMode.js';
import { idName, selectedElement, type PageSelection } from './pageSelection.js';

/** Where a selection leads. Markdown offsets are the page's document
 *  offsets (its composed book's), as the VDT carries them. */
export type SelectionTarget =
  /** `chapter`: the offsets are another chapter's (its position in the
   *  book) and the file's own, not the page's book's: text a story carried
   *  in from an earlier chapter (#943). */
  | { kind: 'caret'; offset: number; chapter?: number }
  | { kind: 'markdown'; start: number; end: number; chapter?: number }
  /** A contents entry: the heading it lists, at `bodyOffset` of its
   *  chapter's body (front matter not counted), titled `title`. */
  | { kind: 'heading'; bodyOffset: number; title: string }
  | { kind: 'resource'; resourceId: string }
  /** A frame of a composed page: picked for the template editor (Design),
   *  or its slot opened (Content, a frame with no content yet). */
  | { kind: 'frame'; frame: VDTFrame; template: string }
  /** A place of the Design panel: a section, at a config pointer. */
  | { kind: 'settings'; group: SettingsGroupId; section: SettingsSectionId | null; path?: string; styleId?: string; template?: { id: string; group?: string } }
  | { kind: 'none' };

/** The section of the Design panel that edits a config pointer
 *  (`/header/elements/0`, `/pageTemplates/2/decoration/elements/1`): the
 *  section whose keys hold the pointer's first step. */
export function sectionForConfigPath(path: string): { group: SettingsGroupId; section: SettingsSectionId | null } | null {
  const key = path.split('/')[1];
  if (!key) return null;
  // The template editor (#863) lives in the page group; before it lands
  // the group alone is opened.
  const entry = SETTINGS_SECTIONS.find((s) => s.id === key)
    ?? SETTINGS_SECTIONS.find((s) => (s.configKeys as string[]).includes(key));
  if (entry) return { group: entry.group, section: entry.id };
  if (key === 'pageTemplates') return { group: 'page', section: null };
  return null;
}

function settings(section: SettingsSectionId, extra?: { path?: string; styleId?: string }): SelectionTarget {
  const entry = SETTINGS_SECTIONS.find((s) => s.id === section);
  return entry ? { kind: 'settings', group: entry.group, section, ...extra } : { kind: 'none' };
}

function settingsAt(path: string): SelectionTarget {
  const at = sectionForConfigPath(path);
  return at ? { kind: 'settings', ...at, path } : { kind: 'none' };
}

function blockOf(doc: VDTDocument, page: VDTPage | undefined, id: string): VDTBlock | undefined {
  return page?.floats?.find((b) => b.id === id) ?? doc.blocks.find((b) => b.id === id);
}

/** The settings that set a block's look (Design mode). */
function blockSettings(block: VDTBlock | undefined): SelectionTarget {
  if (!block) return { kind: 'none' };
  if (block.tocEntry || block.tocPart) return settings('toc');
  if (block.resourceBlock) return settings('captionStyle');
  switch (block.type) {
    case 'heading': return settings('headings');
    case 'listItem': return settings(block.listKind === 'ordered' ? 'ordered-lists' : 'unordered-lists');
    case 'code': return settings('codeStyle');
    case 'mathDisplay': return settings('math');
    case 'callout': return settings('calloutStyles', block.callout?.styleId ? { styleId: block.callout.styleId } : undefined);
    default:
      return block.paragraphStyleId ? settings('paragraphStyles', { styleId: block.paragraphStyleId }) : settings('bodyText');
  }
}

const chapterOf = (chapter: number | undefined): { chapter?: number } => (chapter !== undefined ? { chapter } : {});

/** The frame of the composed page `el` names. */
function frameOf(page: VDTPage | undefined, el: SourceElement): VDTFrame | undefined {
  return page?.composed?.frames.find((f) => f.id === el.id);
}

/** The element of the chain at `level` and the frame round it, if any. */
function contentTarget(doc: VDTDocument, sel: PageSelection, el: SourceElement): SelectionTarget {
  const page = doc.pages[sel.pageIndex];
  switch (el.level) {
    case 'text':
      if (el.source.kind === 'markdown' || el.source.kind === 'attr') return { kind: 'caret', offset: el.source.start, ...chapterOf(el.source.chapter) };
      return { kind: 'none' };
    case 'attr':
      return el.source.kind === 'attr' ? { kind: 'markdown', start: el.source.start, end: el.source.end, ...chapterOf(el.source.chapter) } : { kind: 'none' };
    case 'label':
      return el.content ? { kind: 'markdown', start: el.content.start, end: el.content.end, ...chapterOf(el.chapter) } : { kind: 'none' };
    case 'resource':
      return el.source.kind === 'resource' ? { kind: 'resource', resourceId: el.source.resourceId } : { kind: 'none' };
    case 'block':
    case 'box': {
      if (el.heading !== undefined) {
        const block = blockOf(doc, page, el.id);
        return { kind: 'heading', bodyOffset: el.heading, title: tocTitle(block) };
      }
      return el.source.kind === 'markdown' ? { kind: 'markdown', start: el.source.start, end: el.source.end, ...chapterOf(el.source.chapter) } : { kind: 'none' };
    }
    case 'frame': {
      if (el.content && el.content.end > el.content.start) return { kind: 'markdown', start: el.content.start, end: el.content.end, ...chapterOf(el.chapter) };
      const frame = frameOf(page, el);
      if (!frame || !page?.composed) return { kind: 'none' };
      // A piece on an added page (#859) goes to the slot it continues,
      // whatever its frame is called in the overflow template.
      const slot = idName(el.id).replace(/~\d+$/, '');
      return { kind: 'frame', frame: slot === frame.name ? frame : { ...frame, name: slot }, template: page.composed.template };
    }
    case 'template':
      return el.content ? { kind: 'markdown', start: el.content.start, end: el.content.end } : { kind: 'none' };
    case 'group':
      // A group is form only: it has nothing in the Markdown.
      return { kind: 'none' };
    case 'design':
    case 'slot':
      return el.source.kind === 'config' && el.source.path ? settingsAt(el.source.path) : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}

function designTarget(doc: VDTDocument, sel: PageSelection, el: SourceElement): SelectionTarget {
  const page = doc.pages[sel.pageIndex];
  switch (el.level) {
    case 'frame': {
      const frame = frameOf(page, el);
      return frame && page?.composed ? { kind: 'frame', frame, template: page.composed.template } : { kind: 'none' };
    }
    case 'group':
    case 'template': {
      const at = el.source.kind === 'config' ? settingsAt(el.source.path) : { kind: 'none' as const };
      // The template editor opens on the page's template (and the group).
      if (at.kind !== 'settings' || !page?.composed) return at;
      return { ...at, template: { id: page.composed.template, ...(el.level === 'group' ? { group: idName(el.id) } : {}) } };
    }
    case 'design':
    case 'slot':
      return el.source.kind === 'config' && el.source.path ? settingsAt(el.source.path) : { kind: 'none' };
    case 'box':
    case 'block':
      return blockSettings(blockOf(doc, page, el.id));
    case 'text': {
      // A chip's words: the chip styles; else the block's look.
      const block = sel.chain.find((e) => e.level === 'block' || e.level === 'box');
      if (el.source.kind === 'attr') return contentTarget(doc, sel, el);
      return block ? blockSettings(blockOf(doc, page, block.id)) : { kind: 'none' };
    }
    default:
      // Attributes, labels and pictures are content in either mode.
      return contentTarget(doc, sel, el);
  }
}

/** Where the element a selection picked leads, in `mode`. */
export function selectionTarget(doc: VDTDocument, sel: PageSelection, mode: EditMode): SelectionTarget {
  const el = selectedElement(sel);
  return mode === 'design' ? designTarget(doc, sel, el) : contentTarget(doc, sel, el);
}

/** The words of a contents row (its title, without the number and the
 *  page number it lists). */
function tocTitle(block: VDTBlock | undefined): string {
  if (!block) return '';
  return block.lines.map((l) => (l.segments ?? []).map((s) => s.text).join('')).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The chapter and offset of the heading a contents entry lists: the
 * chapter whose body has a heading at `bodyOffset` (front matter not
 * counted) whose words appear in the row; failing the words, the first
 * chapter with a heading there. Offsets are the chapter's own (front
 * matter counted). Null when no chapter has one.
 */
export function headingInChapters(chapters: readonly { id: string; markdown: string }[], bodyOffset: number, rowText: string): { chapterId: string; start: number; end: number } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  const row = norm(rowText);
  let fallback: { chapterId: string; start: number; end: number } | null = null;
  for (const ch of chapters) {
    const { contentOffset } = extractFrontmatter(ch.markdown);
    const start = contentOffset + bodyOffset;
    if (start >= ch.markdown.length || ch.markdown[start] !== '#') continue;
    if (start > 0 && ch.markdown[start - 1] !== '\n') continue;
    const nl = ch.markdown.indexOf('\n', start);
    const end = nl < 0 ? ch.markdown.length : nl;
    const title = norm(ch.markdown.slice(start, end).replace(/^#+\s*/, '').replace(/\s*\{[^}]*\}\s*$/, ''));
    const hit = { chapterId: ch.id, start, end };
    if (title && row.includes(title)) return hit;
    fallback ??= hit;
  }
  return fallback;
}
