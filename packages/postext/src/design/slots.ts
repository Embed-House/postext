import type { DesignSlot, PostextConfig } from '../types.js';

/** What a design slot of the configuration draws: a running head
 *  (`header`, `footer`, a heading style's own, a page template's own), a
 *  heading design, a part page (`parts.design`, `parts.versoDesign`), a
 *  contents part row (`toc.parts.design`), a page template's decoration
 *  (`pageTemplates[i].decoration`, and its variants') or a box style's
 *  design (`calloutStyles[i].design.slot`, #1014). */
export type ConfigDesignSlotKind = 'header' | 'footer' | 'heading' | 'part' | 'tocRow' | 'decoration' | 'box';

export interface ConfigDesignSlot {
  /** Where the slot sits: `header`, `headingStyles[2].advancedDesign.slot`,
   *  `htmlViewer.overrides.parts.design`. Its elements are at
   *  `<path>.elements[i]`. */
  path: string;
  kind: ConfigDesignSlotKind;
  /** The setting the slot belongs to: the heading style, heading level or
   *  page template as a whole (`headingStyles[2]`, `headings.levels[0]`,
   *  `pageTemplates[1]`), else the slot itself. */
  owner: string;
  /** The `id` of the heading style or page template the slot belongs to. */
  ownerId?: string;
  slot: DesignSlot;
}

function isSlot(value: unknown): value is DesignSlot {
  return !!value && typeof value === 'object' && Array.isArray((value as { elements?: unknown }).elements);
}

/**
 * Every design slot a configuration sets, in a fixed order: the page header
 * and footer, each heading level's and heading style's design (and a
 * style's running heads), each page template's decoration and running
 * heads (its variants' after its own), the part page and its verso, the
 * contents part rows, each box style's design — then the same in
 * `htmlViewer.overrides`. Only the slots the config
 * writes: the defaults are not listed. Pure.
 */
export function configDesignSlots(config: PostextConfig | undefined): ConfigDesignSlot[] {
  const out: ConfigDesignSlot[] = [];
  const from = (c: Omit<PostextConfig, 'htmlViewer'> | undefined, prefix: string): void => {
    if (!c || typeof c !== 'object') return;
    const add = (slot: unknown, path: string, kind: ConfigDesignSlotKind, owner = path, ownerId?: string) => {
      if (isSlot(slot)) out.push({ path, kind, owner, ...(ownerId !== undefined ? { ownerId } : {}), slot });
    };
    add(c.header, `${prefix}header`, 'header');
    add(c.footer, `${prefix}footer`, 'footer');
    const levels = (c.headings as { levels?: unknown } | undefined)?.levels;
    if (Array.isArray(levels)) {
      levels.forEach((l, i) => {
        const owner = `${prefix}headings.levels[${i}]`;
        add((l as { advancedDesign?: { slot?: unknown } } | undefined)?.advancedDesign?.slot, `${owner}.advancedDesign.slot`, 'heading', owner);
      });
    }
    if (Array.isArray(c.headingStyles)) {
      c.headingStyles.forEach((s, i) => {
        if (!s || typeof s !== 'object') return;
        const owner = `${prefix}headingStyles[${i}]`;
        const id = typeof s.id === 'string' ? s.id : undefined;
        add(s.advancedDesign?.slot, `${owner}.advancedDesign.slot`, 'heading', owner, id);
        add(s.header, `${owner}.header`, 'header', owner, id);
        add(s.footer, `${owner}.footer`, 'footer', owner, id);
      });
    }
    const templates = (c as { pageTemplates?: unknown }).pageTemplates;
    if (Array.isArray(templates)) {
      templates.forEach((t, i) => {
        if (!t || typeof t !== 'object') return;
        const owner = `${prefix}pageTemplates[${i}]`;
        const id = typeof (t as { id?: unknown }).id === 'string' ? (t as { id: string }).id : undefined;
        const patch = (p: unknown, at: string) => {
          if (!p || typeof p !== 'object') return;
          const q = p as { decoration?: unknown; header?: unknown; footer?: unknown };
          add(q.decoration, `${at}.decoration`, 'decoration', owner, id);
          add(q.header, `${at}.header`, 'header', owner, id);
          add(q.footer, `${at}.footer`, 'footer', owner, id);
        };
        patch(t, owner);
        const variants = (t as { variants?: Record<string, unknown> }).variants;
        if (variants && typeof variants === 'object') {
          for (const side of ['recto', 'verso']) patch(variants[side], `${owner}.variants.${side}`);
        }
      });
    }
    add(c.parts?.design, `${prefix}parts.design`, 'part');
    add(c.parts?.versoDesign, `${prefix}parts.versoDesign`, 'part');
    add(c.toc?.parts?.design, `${prefix}toc.parts.design`, 'tocRow');
    if (Array.isArray(c.calloutStyles)) {
      c.calloutStyles.forEach((s, i) => {
        if (!s || typeof s !== 'object') return;
        const owner = `${prefix}calloutStyles[${i}]`;
        add(s.design?.slot, `${owner}.design.slot`, 'box', owner, typeof s.id === 'string' ? s.id : undefined);
      });
    }
  };
  from(config, '');
  from(config?.htmlViewer?.overrides, 'htmlViewer.overrides.');
  return out;
}
