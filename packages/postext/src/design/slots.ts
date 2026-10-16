import type { DesignSlot, PostextConfig } from '../types';

/** What a design slot of the configuration draws: a running head
 *  (`header`, `footer`, a heading style's own), a heading design, a part
 *  page (`parts.design`, `parts.versoDesign`) or a contents part row
 *  (`toc.parts.design`). */
export type ConfigDesignSlotKind = 'header' | 'footer' | 'heading' | 'part' | 'tocRow';

export interface ConfigDesignSlot {
  /** Where the slot sits: `header`, `headingStyles[2].advancedDesign.slot`,
   *  `htmlViewer.overrides.parts.design`. Its elements are at
   *  `<path>.elements[i]`. */
  path: string;
  kind: ConfigDesignSlotKind;
  /** The setting the slot belongs to: the heading style or heading level
   *  as a whole (`headingStyles[2]`, `headings.levels[0]`), else the slot
   *  itself. */
  owner: string;
  /** The `id` of the heading style the slot belongs to. */
  ownerId?: string;
  slot: DesignSlot;
}

function isSlot(value: unknown): value is DesignSlot {
  return !!value && typeof value === 'object' && Array.isArray((value as { elements?: unknown }).elements);
}

/**
 * Every design slot a configuration sets, in a fixed order: the page header
 * and footer, each heading level's and heading style's design (and a
 * style's running heads), the part page and its verso, the contents part
 * rows — then the same in `htmlViewer.overrides`. Only the slots the config
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
    add(c.parts?.design, `${prefix}parts.design`, 'part');
    add(c.parts?.versoDesign, `${prefix}parts.versoDesign`, 'part');
    add(c.toc?.parts?.design, `${prefix}toc.parts.design`, 'tocRow');
  };
  from(config, '');
  from(config?.htmlViewer?.overrides, 'htmlViewer.overrides.');
  return out;
}
