/**
 * The Checks panel's words for a frame of a composed page whose content
 * does not fit (#858): where it overflows, the steps of the reflow ladder
 * it tried, and the changes that would make it fit, with their values.
 * The one-click versions of the proposals are U8's (#868).
 */
import type { FrameFitStep, FrameOverflowProposal } from 'postext';
import type { SandboxLabels } from '../types';
import { fill } from '../print/fillTokens';
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

const pct = (v: number): string => `${Math.round(v * 1000) / 10} %`;
const mm = (d: { value: number; unit: string }): string => String(Math.round(d.value * 10) / 10);

/** A step of the ladder in the panel's language. */
export function fitStepText(step: FrameFitStep, at: { scale: number; imageScale?: number }, labels: FitLabels): string {
  switch (step) {
    case 'free':
      return labels.warningsFitStepFree;
    case 'push':
      return labels.warningsFitStepPush;
    case 'scaleImages':
      return fill(labels.warningsFitStepScaleImages, { pct: pct(at.imageScale ?? 1) });
    case 'redistribute':
      return labels.warningsFitStepRedistribute;
    case 'shrinkText':
      return fill(labels.warningsFitStepShrinkText, { pct: pct(at.scale) });
    case 'continue':
      return labels.warningsFitStepContinue;
    default:
      return String(step);
  }
}

/** A proposal in the panel's language. */
export function fitProposalText(p: FrameOverflowProposal, labels: FitLabels): string {
  switch (p.kind) {
    case 'allowShrink':
      return fill(labels.warningsFitFixAllowShrink, { pct: pct(p.value) });
    case 'raiseMax':
      return fill(labels.warningsFitFixRaiseMax, { mm: mm(p.value) });
    case 'lowerMin':
      return fill(labels.warningsFitFixLowerMin, { frame: p.frame, mm: mm(p.value) });
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
export function frameOverflowDetail(payload: FrameOverflowPayload, labels: FitLabels): string {
  const parts = [fill(labels.warningsFrameOverflowDetail, { template: payload.template, mm: payload.overflowMm.toFixed(1), page: payload.page })];
  const steps = (payload.stepsTried ?? []).map((s) => fitStepText(s, payload, labels));
  if (steps.length > 0) parts.push(fill(labels.warningsFrameOverflowTried, { steps: steps.join(', ') }));
  const fixes = (payload.proposals ?? []).map((p) => fitProposalText(p, labels));
  if (fixes.length > 0) parts.push(fill(labels.warningsFrameOverflowFixes, { fixes: fixes.join('; ') }));
  return parts.join(' ');
}
