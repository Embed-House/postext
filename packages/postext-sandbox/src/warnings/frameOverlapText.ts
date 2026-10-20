/**
 * The Checks panel's words for the overlap checks of composed pages
 * (#1053, #1066): a frame whose ink lies under a frame painted over it
 * (`frameCovered`), a frame that runs past the trim, the bleed or the box
 * it is anchored inside (`frameOutsideArea`), and the fixes the layout
 * proposes for each, with their values. A repeating grid given more items
 * than it holds (`repeatOverflow`, #1061) is worded here too.
 *
 * Every fix of a frame (these and a `frameOverflow`'s) is a
 * {@link FrameProposal}; {@link frameProposalText} words any of them.
 */
import type { FrameCoverProposal, FrameOutsideProposal, FrameOverflowProposal } from 'postext';
import type { SandboxLabels } from '../types';
import { fill } from '../print/fillTokens';
import { localNumber } from '../viewport/composed/reflowText';
import { fitProposalText } from './frameOverflowText';
import type { WarningPayload } from './types';

/** A fix the layout proposes for a frame, whatever check found it. */
export type FrameProposal = FrameOverflowProposal | FrameCoverProposal | FrameOutsideProposal;

type CoveredPayload = Extract<WarningPayload, { kind: 'frameCovered' }>;
type OutsidePayload = Extract<WarningPayload, { kind: 'frameOutsideArea' }>;
type RepeatPayload = Extract<WarningPayload, { kind: 'repeatOverflow' }>;

/** The shift of a `move` in words: «4 mm right, 2 mm down». */
function shiftText(p: { dxMm: number; dyMm: number }, labels: SandboxLabels, locale?: string): string {
  const parts: string[] = [];
  if (p.dxMm !== 0) parts.push(fill(p.dxMm > 0 ? labels.warningsFixMoveRight : labels.warningsFixMoveLeft, { mm: localNumber(Math.abs(p.dxMm), locale) }));
  if (p.dyMm !== 0) parts.push(fill(p.dyMm > 0 ? labels.warningsFixMoveDown : labels.warningsFixMoveUp, { mm: localNumber(Math.abs(p.dyMm), locale) }));
  return parts.join(', ');
}

/** A fix in the panel's language. `by` names the covering frame (a
 *  `frameCovered`'s), for the fixes that change it. */
export function frameProposalText(p: FrameProposal, labels: SandboxLabels, locale?: string, by = ''): string {
  switch (p.kind) {
    case 'layer':
      return fill(labels.warningsFixLayer, { by, value: p.value });
    case 'exclude':
      return fill(labels.warningsFixExclude, { by });
    case 'move':
      return fill(labels.warningsFixMove, { frame: p.frame, shift: shiftText(p, labels, locale) });
    case 'maxHeight':
      return fill(labels.warningsFixMaxHeight, { mm: localNumber(p.value.value, locale) });
    case 'minHeight':
      return fill(labels.warningsFixMinHeight, { frame: p.frame, mm: localNumber(p.value.value, locale) });
    default:
      return fitProposalText(p, labels, locale);
  }
}

/** A fix of a frame past its edge: `continueNextPage` comes with the
 *  `maxHeight` it needs (#1066), so it is worded with it. */
export function outsideProposalText(p: FrameProposal, proposals: readonly FrameProposal[], labels: SandboxLabels, locale?: string): string {
  const text = frameProposalText(p, labels, locale);
  const max = p.kind === 'continueNextPage' ? proposals.find((q) => q.kind === 'maxHeight') : undefined;
  return max ? `${frameProposalText(max, labels, locale)}, ${text}` : text;
}

/** The fixes and the `overlap: 'allow'` way out, after a detail. */
function fixesText(proposals: readonly FrameProposal[], labels: SandboxLabels, locale: string | undefined, by: string, outside = false): string {
  const fixes = proposals.map((p) => (outside ? outsideProposalText(p, proposals, labels, locale) : frameProposalText(p, labels, locale, by)));
  return [fixes.length > 0 ? fill(labels.warningsFrameOverlapFixes, { fixes: fixes.join('; ') }) : null, labels.warningsFrameOverlapAllow].filter(Boolean).join(' ');
}

/** A `frameCovered`'s detail line: what lies under which frame, how much
 *  is hidden, the fixes. */
export function frameCoveredDetail(payload: CoveredPayload, labels: SandboxLabels, locale?: string): string {
  const values = { page: payload.page, by: payload.coveredBy, area: localNumber(payload.overlapMm2, locale), template: payload.template, text: payload.text ?? '', picture: payload.picture ?? '' };
  const head = payload.text !== undefined
    ? fill(labels.warningsFrameCoveredTextDetail, values)
    : payload.picture !== undefined
      ? fill(labels.warningsFrameCoveredPictureDetail, values)
      : fill(labels.warningsFrameCoveredDetail, values);
  return `${head} ${fixesText(payload.proposals ?? [], labels, locale, payload.coveredBy)}`;
}

/** A `frameOutsideArea`'s detail line: what it runs past and by how much,
 *  the fixes. */
export function frameOutsideDetail(payload: OutsidePayload, labels: SandboxLabels, locale?: string): string {
  const template = payload.past === 'trim'
    ? labels.warningsFrameOutsideTrimDetail
    : payload.past === 'bleed'
      ? labels.warningsFrameOutsideBleedDetail
      : payload.past === 'frame'
        ? labels.warningsFrameOutsideFrameDetail
        : labels.warningsFrameOutsideGroupDetail;
  const head = fill(template, { page: payload.page, mm: localNumber(payload.excessMm, locale), target: payload.target ?? '', template: payload.template });
  return `${head} ${fixesText(payload.proposals ?? [], labels, locale, '', true)}`;
}

/** A `repeatOverflow`'s detail line. */
export function repeatOverflowDetail(payload: RepeatPayload, labels: SandboxLabels): string {
  const values = { group: payload.group, template: payload.template, max: payload.max, item: payload.item, flow: payload.flowFrame ?? '' };
  return fill(payload.flowFrame !== undefined ? labels.warningsRepeatOverflowDetail : labels.warningsRepeatOverflowAfterDetail, values);
}
