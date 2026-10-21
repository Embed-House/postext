/**
 * An entry of a Design panel section brought into view (#899, left by
 * #865): a design element picked on a page opens its card in the slot
 * editor, a paragraph or box style its card in the style list.
 *
 * Entries say what they are with data attributes: `data-config-path` on a
 * design element's card (its JSON pointer), `data-style-id` on a style's
 * card, and `data-config-holder` on a nested section that holds the cards
 * of a pointer prefix (its cards are not mounted while it is closed).
 */

import type { SettingsFocus } from '../context/settingsNavigation.js';

/** Of the pointers the panel shows, the one `path` points into (itself,
 *  or the longest one it lies under); null when none. */
export function bestConfigPath(shown: readonly string[], path: string): string | null {
  let best: string | null = null;
  for (const p of shown) {
    if (path !== p && !path.startsWith(`${p}/`)) continue;
    if (best === null || p.length > best.length) best = p;
  }
  return best;
}

function entryIn(root: HTMLElement, focus: SettingsFocus): HTMLElement | null {
  if (focus.styleId) {
    // Read, not matched in a selector: a style id is the book's own text.
    for (const el of root.querySelectorAll<HTMLElement>('[data-style-id]')) {
      if (el.getAttribute('data-style-id') === focus.styleId) return el;
    }
  }
  if (focus.path) {
    const cards = [...root.querySelectorAll<HTMLElement>('[data-config-path]')];
    const best = bestConfigPath(cards.map((c) => c.getAttribute('data-config-path') ?? ''), focus.path);
    if (best) return cards.find((c) => c.getAttribute('data-config-path') === best) ?? null;
  }
  return null;
}

/** A closed nested section that holds the entry. */
function closedHolder(root: HTMLElement, focus: SettingsFocus): HTMLElement | null {
  if (!focus.path) return null;
  const holders = [...root.querySelectorAll<HTMLElement>('[data-config-holder]')];
  const best = bestConfigPath(holders.map((h) => h.getAttribute('data-config-holder') ?? ''), focus.path);
  const holder = best ? holders.find((h) => h.getAttribute('data-config-holder') === best) : undefined;
  if (!holder) return null;
  // The holder may wrap the section (`display: contents`).
  const section = holder.hasAttribute('data-section-id') ? holder : holder.querySelector<HTMLElement>('[data-section-id]');
  return section?.hasAttribute('data-closed') ? section : null;
}

/**
 * Scroll `scroller` to the entry `focus` names inside `root` and focus its
 * first control; a closed section holding it is opened first. False when
 * the entry is not there (the section alone stays in view).
 */
export function focusSettingsEntry(root: HTMLElement, scroller: HTMLElement | null, focus: SettingsFocus, attempt = 0): boolean {
  const entry = entryIn(root, focus);
  if (!entry) {
    // Opened once; then the cards are waited for a few frames (the
    // section mounts them as it opens).
    if (attempt === 0) {
      const holder = closedHolder(root, focus);
      if (!holder) return false;
      holder.querySelector<HTMLElement>('button')?.click();
    }
    if (attempt >= 10) return false;
    requestAnimationFrame(() => { focusSettingsEntry(root, scroller, focus, attempt + 1); });
    return true;
  }
  // A folded card (#1031) opens first; its controls are reached next frame.
  if (entry.hasAttribute('data-item-card') && entry.hasAttribute('data-closed') && attempt < 10) {
    entry.querySelector<HTMLElement>('[data-item-card-trigger]')?.click();
    requestAnimationFrame(() => { focusSettingsEntry(root, scroller, focus, attempt + 1); });
    return true;
  }
  if (scroller) {
    const top = scroller.scrollTop + entry.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  }
  // A card's first control is under its header (the fold button).
  const body = entry.querySelector<HTMLElement>('[data-item-card-body]') ?? entry;
  const control = body.querySelector<HTMLElement>('input, select, textarea, button, [tabindex="0"]');
  control?.focus({ preventScroll: true });
  return true;
}
