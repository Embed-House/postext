/**
 * The Checks panel's words for a frame of a composed page whose content
 * does not fit (#858): where it overflows, the steps of the reflow ladder
 * it tried, and the changes that would make it fit, with their values.
 * The one-click versions of the proposals: ./proposalActions.ts (#868).
 */
import type { FrameFitStep, FrameOverflowProposal } from 'postext';
import type { SandboxLabels } from '../types';
import { fill } from '../print/fillTokens';
import { localNumber } from '../viewport/composed/reflowText';
import type { WarningPayload } from './types';

type FrameOverflowPayload = Extract<WarningPayload, { kind: 'frameOverflow' }>;
type FitLabels = Pick<
  SandboxLabels,
  | 'warningsFrameOverflowDetail'
  | 'warningsFrameOverflowTried'
  | 'warningsFrameOverflowFixes'
  | 'warningsFitStepFree'
  | 'warningsFitStepPush'
  | 'warningsFitStepScaleImages'
  | 'warningsFitStepRedistribute'
  | 'warningsFitStepShrinkText'
  | 'warningsFitStepContinue'
  | 'warningsFitFixAllowShrink'
  | 'warningsFitFixRaiseMax'
  | 'warningsFitFixLowerMin'
  | 'warningsFitFixContinue'
  | 'warningsFitFixUseTemplate'
  | 'warningsFitFixShorten'
>;

/** Numbers go through the interface's number format (#938): «72,5 %» in
 *  Spanish, «72.5 %» in English; `locale` absent reads the runtime's. */
const pct = (v: number, locale?: string): string => `${localNumber(v * 100, locale)} %`;
const mm = (d: { value: number; unit: string }, locale?: string): string => localNumber(d.value, locale);

/** A step of the ladder in the panel's language. */
export function fitStepText(step: FrameFitStep, at: { scale: number; imageScale?: number }, labels: FitLabels, locale?: string): string {
  switch (step) {
    case 'free':
      return labels.warningsFitStepFree;
    case 'push':
      return labels.warningsFitStepPush;
    case 'scaleImages':
      return fill(labels.warningsFitStepScaleImages, { pct: pct(at.imageScale ?? 1, locale) });
    case 'redistribute':
      return labels.warningsFitStepRedistribute;
    case 'shrinkText':
      return fill(labels.warningsFitStepShrinkText, { pct: pct(at.scale, locale) });
    case 'continue':
      return labels.warningsFitStepContinue;
    default:
      return String(step);
  }
}

/** A proposal in the panel's language. */
export function fitProposalText(p: FrameOverflowProposal, labels: FitLabels, locale?: string): string {
  switch (p.kind) {
    case 'allowShrink':
      return fill(labels.warningsFitFixAllowShrink, { pct: pct(p.value, locale) });
    case 'raiseMax':
      return fill(labels.warningsFitFixRaiseMax, { mm: mm(p.value, locale) });
    case 'lowerMin':
      return fill(labels.warningsFitFixLowerMin, { frame: p.frame, mm: mm(p.value, locale) });
    case 'continueNextPage':
      return labels.warningsFitFixContinue;
    case 'useTemplate':
      return fill(labels.warningsFitFixUseTemplate, { template: p.value });
    case 'shortenText':
      return fill(labels.warningsFitFixShorten, { chars: p.value });
    default:
      return (p as { kind: string }).kind;
  }
}

/** The warning's detail line: where, the steps tried, the fixes. */
export function frameOverflowDetail(payload: FrameOverflowPayload, labels: FitLabels, locale?: string): string {
  const parts = [fill(labels.warningsFrameOverflowDetail, { template: payload.template, mm: localNumber(payload.overflowMm, locale), page: payload.page })];
  const steps = (payload.stepsTried ?? []).map((s) => fitStepText(s, payload, labels, locale));
  if (steps.length > 0) parts.push(fill(labels.warningsFrameOverflowTried, { steps: steps.join(', ') }));
  const fixes = (payload.proposals ?? []).map((p) => fitProposalText(p, labels, locale));
  if (fixes.length > 0) parts.push(fill(labels.warningsFrameOverflowFixes, { fixes: fixes.join('; ') }));
  return parts.join(' ');
}
