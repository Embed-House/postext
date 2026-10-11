/** The Checks panel's words for a contrast finding (#748). */

import type { SandboxLabels } from '../types';
import type { ContrastCheck } from '../warnings/types';
import { fill } from '../print/fillTokens';
import { ratioText } from './fieldContrast';

export function contrastTitle(check: ContrastCheck, labels: SandboxLabels): string {
  return check.kind === 'lowContrast' ? labels.contrastLowTitle : labels.contrastReversedTitle;
}

/** A hex colour inside a sentence of any direction: it starts with a
 *  neutral, which a right-to-left line would move to its other end. */
const isolate = (hex: string) => `⁦${hex}⁩`;

export function contrastDetail(check: ContrastCheck, labels: SandboxLabels): string {
  const common = { text: check.text, color: isolate(check.color), background: isolate(check.background), size: check.sizePt };
  const detail = check.kind === 'lowContrast'
    ? fill(labels.contrastLowDetail, {
        ...common,
        measures: [
          check.screen !== undefined ? fill(labels.contrastOnScreen, { ratio: ratioText(check.screen, 2) }) : '',
          check.print !== undefined ? fill(labels.contrastInPrint, { ratio: ratioText(check.print, 2) }) : '',
        ].filter(Boolean).join(' · '),
        level: check.level,
        required: check.required,
      })
    : fill(labels.contrastReversedDetail, {
        ...common,
        inks: check.inks,
        weight: `${check.weight}${check.italic ? ` ${labels.contrastItalic}` : ''}`,
        min: check.minimumPt,
      });
  return check.count > 1 ? `${detail} ${fill(labels.contrastOccurrences, { count: check.count })}` : detail;
}
