/**
 * Where each callout style of a book is used (#873): the `:::callout`
 * fences of every chapter that name it, the template frames dressed with it
 * and the composed pages laid with those templates. The frame-style
 * library shows it, and the merge rewrites it.
 */

import { resolvePageTemplate, type CalloutStyleConfig, type PageTemplate, type PostextConfig } from 'postext';
import { calloutFences } from './calloutFences.js';
import { templateFences } from '../templates/templateUsage.js';

export interface UsageChapter {
  id: string;
  title?: string;
  markdown: string;
}

/** The fences of one chapter naming a style. */
export interface ChapterFences {
  chapterId: string;
  /** 0-based position of the chapter in the book. */
  chapterIndex: number;
  /** Offsets of the fence lines. */
  offsets: number[];
  /** Fences with no `type`, or one no style has, that fall back to this
   *  style (the first of the list, as the engine picks it). */
  implicit: number;
}

/** A frame of a template whose box is drawn with a style. */
export interface FrameUse {
  templateId: string;
  frame: string;
  /** Where the `style` is written: the template itself or a variant. */
  scope: 'base' | 'recto' | 'verso';
}

/** The pages of one chapter laid with a template using a style. */
export interface ChapterPages {
  chapterId: string;
  chapterIndex: number;
  /** Offsets of the `::::page` fences. */
  offsets: number[];
}

export interface StyleUsage {
  id: string;
  /** `:::callout` boxes naming it (or falling back to it), per chapter. */
  fences: ChapterFences[];
  fenceCount: number;
  /** Template frames written with it. */
  frames: FrameUse[];
  /** Templates whose laid-out frames use it, inherited ones included. */
  templates: string[];
  /** Composed pages laid with one of those templates, per chapter. */
  pages: ChapterPages[];
  pageCount: number;
}

/** The styles the engine reads (the built-in list while the book stores
 *  none). */
export function bookCalloutStyles(config: Pick<PostextConfig, 'calloutStyles'>, builtIn: readonly CalloutStyleConfig[]): readonly CalloutStyleConfig[] {
  return config.calloutStyles ?? builtIn;
}

/** The style a fence without a known `type` takes: the first that is no
 *  internal one of the build. */
export function fallbackStyleId(styles: readonly CalloutStyleConfig[]): string | undefined {
  return styles.find((s) => !s.id.startsWith('__postext-'))?.id;
}

/** Every frame of `templates` that names a style, with where it is
 *  written. */
export function templateFrameStyles(templates: readonly PageTemplate[] | undefined): (FrameUse & { style: string })[] {
  const out: (FrameUse & { style: string })[] = [];
  for (const t of templates ?? []) {
    const scopes: [FrameUse['scope'], PageTemplate['frames']][] = [
      ['base', t.frames],
      ['recto', t.variants?.recto?.frames],
      ['verso', t.variants?.verso?.frames],
    ];
    for (const [scope, frames] of scopes) {
      for (const f of frames ?? []) {
        if (typeof f.style === 'string' && f.style !== '') out.push({ templateId: t.id, frame: f.name, scope, style: f.style });
      }
    }
  }
  return out;
}

/** The styles each template's frames use once resolved (`extends` and
 *  both variants), by template id. */
function templateStyles(config: Pick<PostextConfig, 'pageTemplates' | 'calloutStyles'>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const t of config.pageTemplates ?? []) {
    if (!t?.id || out.has(t.id)) continue;
    const ids = new Set<string>();
    for (const parity of [undefined, 'recto', 'verso'] as const) {
      const resolved = resolvePageTemplate({ pageTemplates: config.pageTemplates }, t.id, parity ? { parity } : {});
      for (const f of resolved?.frames ?? []) if (f.style) ids.add(f.style);
    }
    out.set(t.id, ids);
  }
  return out;
}

/** Where every style of `styles` is used in the book. */
export function styleUsage(
  config: Pick<PostextConfig, 'pageTemplates' | 'calloutStyles'>,
  styles: readonly CalloutStyleConfig[],
  chapters: readonly UsageChapter[],
): Map<string, StyleUsage> {
  const out = new Map<string, StyleUsage>();
  for (const s of styles) {
    if (!out.has(s.id)) out.set(s.id, { id: s.id, fences: [], fenceCount: 0, frames: [], templates: [], pages: [], pageCount: 0 });
  }
  const known = new Set(styles.map((s) => s.id));
  const fallback = fallbackStyleId(styles);
  const byTemplate = templateStyles(config);
  for (const [templateId, ids] of byTemplate) {
    for (const id of ids) out.get(id)?.templates.push(templateId);
  }
  for (const f of templateFrameStyles(config.pageTemplates)) {
    out.get(f.style)?.frames.push({ templateId: f.templateId, frame: f.frame, scope: f.scope });
  }
  chapters.forEach((ch, chapterIndex) => {
    const perStyle = new Map<string, ChapterFences>();
    const entry = (id: string): ChapterFences => {
      let e = perStyle.get(id);
      if (!e) perStyle.set(id, (e = { chapterId: ch.id, chapterIndex, offsets: [], implicit: 0 }));
      return e;
    };
    for (const f of calloutFences(ch.markdown)) {
      const id = known.has(f.type) ? f.type : fallback;
      if (id === undefined) continue;
      const e = entry(id);
      e.offsets.push(f.fenceStart);
      if (id !== f.type) e.implicit++;
    }
    for (const [id, e] of perStyle) {
      const u = out.get(id);
      if (!u) continue;
      u.fences.push(e);
      u.fenceCount += e.offsets.length;
    }
    const pagesPerStyle = new Map<string, ChapterPages>();
    for (const f of templateFences(ch.markdown)) {
      for (const id of byTemplate.get(f.template) ?? []) {
        let e = pagesPerStyle.get(id);
        if (!e) pagesPerStyle.set(id, (e = { chapterId: ch.id, chapterIndex, offsets: [] }));
        e.offsets.push(f.fenceStart);
      }
    }
    for (const [id, e] of pagesPerStyle) {
      const u = out.get(id);
      if (!u) continue;
      u.pages.push(e);
      u.pageCount += e.offsets.length;
    }
  });
  return out;
}

/** How much a style is used: its boxes in the text and the composed
 *  pages its frames are drawn on. */
export function usageWeight(u: StyleUsage | undefined): number {
  return u ? u.fenceCount + u.pageCount : 0;
}

/** The style is used by template frames only (or not at all): its boxes
 *  take their place from the frame, never from the style. */
export function framesOnly(u: StyleUsage | undefined): boolean {
  return !u || u.fenceCount === 0;
}
