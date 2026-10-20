/**
 * The frame of a template a laid frame's name stands for (#1065): a grid's
 * instance `card[2]` is frame `card` of its template (#1061), and a
 * module's frame `caja[1].texto` is frame `texto` of the module template
 * (#1062). The template editor opens on that template and frame when one
 * is picked on a page.
 *
 * Pure.
 */

import type { PageTemplate } from 'postext';

/** `card[2]` → `{ frame: 'card', item: 2 }`; null for a plain name. */
export function instanceParts(name: string): { frame: string; item: number } | null {
  const open = name.lastIndexOf('[');
  if (open <= 0 || !name.endsWith(']')) return null;
  const digits = name.slice(open + 1, -1);
  if (digits.length === 0 || digits.length > 6) return null;
  for (const ch of digits) if (ch < '0' || ch > '9') return null;
  const item = Number(digits);
  return item >= 1 ? { frame: name.slice(0, open), item } : null;
}

const TEMPLATE_INDEX_RE = /^\/pageTemplates\/(\d+)(?:\/|$)/;

/** The template and frame name a picked frame is edited at: the module
 *  template its pointer names when that template is a module (the name
 *  past the module's scope), the page's template otherwise; the frame
 *  without its grid item. */
export function templateFrameOf(
  picked: { name: string; template: string; configPath: string },
  templates: readonly PageTemplate[],
): { templateId: string; frame: string } {
  let templateId = picked.template;
  let frame = picked.name;
  const m = TEMPLATE_INDEX_RE.exec(picked.configPath);
  const owner = m ? templates[Number(m[1])] : undefined;
  if (owner && owner.role === 'module' && owner.id !== picked.template) {
    templateId = owner.id;
    const dot = frame.indexOf('.');
    if (dot > 0) frame = frame.slice(dot + 1);
  }
  const inst = instanceParts(frame);
  if (inst) frame = inst.frame;
  return { templateId, frame };
}
