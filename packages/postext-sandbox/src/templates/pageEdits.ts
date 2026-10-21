/**
 * A frame changed on a page (#863): where the change is written. The
 * page's template, at the scope the frame comes from (its variant for the
 * page's side when that is where the frame is set), or a new template for
 * this page alone that extends it (the page's fence then names it).
 */

import type { FrameConfig, PageTemplate, VDTComposedPage, VDTFrame } from 'postext';
import { templateAt, updateFrame, variantForPage, type TemplateScope } from './templateEdits.js';

const POINTER_RE = /^\/pageTemplates\/(\d+)(?:\/variants\/(recto|verso))?\/frames\/\d+$/;

/** The template and scope a frame of a page is edited at: the entry its
 *  `configPath` names when it belongs to the page's own template, else a
 *  patch on the page's template (the frame comes from one it extends). */
export function frameScopeOnPage(templates: readonly PageTemplate[], composed: Pick<VDTComposedPage, 'template'>, frame: Pick<VDTFrame, 'configPath'>): { templateId: string; scope: TemplateScope } {
  const m = POINTER_RE.exec(frame.configPath);
  if (m) {
    const t = templates[Number(m[1])];
    if (t && t.id === composed.template) return { templateId: t.id, scope: (m[2] as TemplateScope | undefined) ?? 'base' };
  }
  return { templateId: composed.template, scope: 'base' };
}

/** The change written into the page's template (every page using it). */
export function changeTemplateFrame(
  templates: readonly PageTemplate[],
  composed: Pick<VDTComposedPage, 'template'>,
  frame: Pick<VDTFrame, 'configPath' | 'name'>,
  patch: Partial<FrameConfig>,
): PageTemplate[] {
  const { templateId, scope } = frameScopeOnPage(templates, composed, frame);
  return updateFrame(templates, templateId, scope, frame.name, patch);
}

/** The change written into a new template for this page alone: it
 *  extends the page's template and patches the frame. */
export function changeFrameForPage(
  templates: readonly PageTemplate[],
  composed: Pick<VDTComposedPage, 'template'>,
  frame: Pick<VDTFrame, 'name'>,
  patch: Partial<FrameConfig>,
  name: string,
): { templates: PageTemplate[]; id: string } {
  return variantForPage(templates, composed.template, name, { name: frame.name, ...patch });
}

/** The display name of a template: its `name`, else its id. */
export function templateDisplayName(templates: readonly PageTemplate[], id: string): string {
  return templateAt(templates, id)?.template.name || id;
}
