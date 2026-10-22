/**
 * Removing a callout style (#905): the styles based on it take its look
 * over, and its parent if it had one, so no box changes. Shared by the
 * Frame styles section and the agent tool.
 */

import { inheritCalloutStyles, type CalloutStyleConfig } from 'postext';

/** `styles` without style `id`, its children carrying what they took from it. */
export function removeCalloutStyle(styles: readonly CalloutStyleConfig[], id: string): CalloutStyleConfig[] {
  const gone = styles.find((s) => s.id === id);
  return styles.filter((s) => s.id !== id).map((s) => {
    if (!gone || s.extends !== id) return s;
    const [, child] = inheritCalloutStyles([{ ...gone, id: '__parent' }, { ...s, extends: '__parent' }]);
    return { ...child!, id: s.id, ...(s.name !== undefined ? { name: s.name } : {}), ...(gone.extends !== undefined ? { extends: gone.extends } : {}) };
  });
}
