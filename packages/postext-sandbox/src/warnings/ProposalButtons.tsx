'use client';

/**
 * The fixes of a frame that does not fit (#868), as buttons: each
 * proposal of the reflow ladder in the panel's words; a click asks first
 * (the change is to the book's form) and then makes it, one step of the
 * undo history. A shorter text is only selected in the editor, with the
 * number of characters to cut. A check of another edition offers to open
 * that edition, where its fixes can be made.
 */

import { Wand2 } from 'lucide-react';
import type { FrameOverflowProposal } from 'postext';
import { useSandbox } from '../context/SandboxContext';
import { Button, ConfirmPopover, announce } from '../ui';
import { fill } from '../print/fillTokens';
import type { SandboxLabels } from '../types';
import { fitProposalText } from './frameOverflowText';
import { applyProposalPlan, planProposal, proposalChangesForm, proposalContextOf, valueInWords, type ProposalPlan } from './proposalActions';
import type { Warning } from './types';

/** The question a plan asks before it is carried out. */
export function proposalQuestion(plan: ProposalPlan, warning: Warning, labels: SandboxLabels, locale?: string): string {
  if (plan.kind === 'config') {
    const changes = plan.leaves.map((l, i) => `${plan.settings[i]} = ${valueInWords(l.value, locale)}`).join('; ');
    return fill(labels.proposalConfirmConfig, { changes });
  }
  if (plan.kind === 'text') {
    const from = warning.payload.kind === 'frameOverflow' ? warning.payload.template : '';
    return fill(labels.proposalConfirmTemplate, { template: plan.template, from });
  }
  return '';
}

/** Carry a proposal out now (after the question, or without one for a
 *  selection): what the live region says afterwards. */
export function runProposal(plan: ProposalPlan, warning: Warning, labels: SandboxLabels, dispatch: Parameters<typeof applyProposalPlan>[1]): string {
  if (plan.kind === 'stale') return labels.proposalStale;
  applyProposalPlan(plan, dispatch);
  if (plan.kind === 'select') {
    const frame = warning.payload.kind === 'frameOverflow' ? warning.payload.frame : '';
    return fill(labels.proposalSelected, { frame, chars: plan.chars });
  }
  return fill(labels.proposalApplied, { change: fitProposalText(plan.proposal, labels) });
}

export interface ProposalActionsProps {
  warning: Warning;
  /** The check is of the edition on screen: its fixes can be made here.
   *  Otherwise `openEdition` takes the reader to it. */
  onScreen: boolean;
  openEdition?: () => void;
  /** The edition's name, for the button that opens it. */
  editionName?: string;
}

export function ProposalActions({ warning, onScreen, openEdition, editionName }: ProposalActionsProps) {
  const { state, dispatch } = useSandbox();
  const { labels } = state;
  const p = warning.payload;
  if (p.kind !== 'frameOverflow' || p.proposals.length === 0) return null;
  if (!onScreen) {
    return openEdition ? (
      <div className="flex flex-wrap gap-1 px-3 pb-1.5 ps-9" data-proposals="">
        <Button size="xs" variant="ghost" icon={<Wand2 size={12} />} onClick={openEdition} className="h-auto max-w-full shrink whitespace-normal py-0.5 text-start">
          {fill(labels.proposalOtherEdition, { locale: editionName ?? '' })}
        </Button>
      </div>
    ) : null;
  }
  const locale = state.locale;
  const plan = (proposal: FrameOverflowProposal) => planProposal(warning, proposal, proposalContextOf(state));
  const run = (proposal: FrameOverflowProposal) => announce(runProposal(plan(proposal), warning, labels, dispatch));
  return (
    <div className="flex flex-col gap-0.5 px-3 pb-1.5 ps-9" data-proposals="" role="group" aria-label={fill(labels.proposalsTitle, { frame: p.frame })}>
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.04em] text-(--slate)">{fill(labels.proposalsTitle, { frame: p.frame })}</span>
      <div className="flex flex-wrap gap-1">
        {p.proposals.map((proposal, i) => {
          const text = fitProposalText(proposal, labels);
          if (!proposalChangesForm(proposal)) {
            return (
              <Button key={i} size="xs" variant="outline" title={labels.proposalSelectHint} onClick={() => run(proposal)} className="h-auto max-w-full shrink whitespace-normal py-0.5 text-start" data-proposal={proposal.kind}>
                {text}
              </Button>
            );
          }
          const planned = plan(proposal);
          const question = planned.kind === 'stale' ? labels.proposalStale : proposalQuestion(planned, warning, labels, locale);
          return (
            <ConfirmPopover
              key={i}
              message={question}
              confirmLabel={labels.proposalConfirmButton}
              onConfirm={() => run(proposal)}
            >
              {({ open }) => (
                <Button size="xs" variant="primary" icon={<Wand2 size={12} />} title={labels.proposalApplyHint} onClick={open} className="h-auto max-w-full shrink whitespace-normal py-0.5 text-start" data-proposal={proposal.kind}>
                  {text}
                </Button>
              )}
            </ConfirmPopover>
          );
        })}
      </div>
    </div>
  );
}
