import { requestSettingsGroup } from '../context/settingsNavigation.js';
import { saveSectionState, saveSettingsGroup } from '../storage/persistence.js';

/** Bring Design › Page & columns › Page templates into view (#863): a
 *  frame picked on the page opens its properties there. */
export function showPageTemplatesSection(frame?: string | null): void {
  saveSectionState('page:pageTemplates', true);
  if (!requestSettingsGroup('page')) saveSettingsGroup('page');
  if (typeof requestAnimationFrame === 'undefined' || typeof document === 'undefined') return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const target = (frame ? document.querySelector(`[data-frame="${CSS.escape(frame)}"]`) : null)
        ?? document.querySelector('[data-section-id="pageTemplates"]');
      target?.scrollIntoView({ block: 'nearest' });
    }),
  );
}
