/**
 * A frame that does not fit, fixed in one click (#868): each proposal the
 * reflow ladder (#858) attaches to a `frameOverflow` becomes an edit.
 *
 * - `allowShrink`, `raiseMax`, `lowerMin`: the configuration value at the
 *   proposal's JSON pointer (`/pageTemplates/0/frames/2/fit/minScale`),
 *   with the switches it names (`also`);
 * - `continueNextPage`: `overflow.continueIn: 'next-page'` on the frame;
 * - `useTemplate`: the page fence's `template` attribute in the Markdown;
 * - `shortenText`: nothing is changed — the frame's text is selected in
 *   the editor and the reader is told how many characters to cut.
 *
 * The overlap checks (#1053, #1066) propose fixes of the same kind: a
 * `frameCovered`'s `layer` and `exclude` (on the covering frame), a
 * `frameOutsideArea`'s `maxHeight`, `minHeight` (of the frame it is
 * anchored inside) and `continueNextPage`, each a value at a JSON pointer.
 * Their `move` is data for the engine (no setting says where a frame is):
 * the Sandbox makes it the moved frame's `placement.offset` with the shift
 * added, and tells it in words only for a frame it cannot move that way
 * (no placement, an offset in ems or percent). `continueNextPage` of a
 * frame past its edge comes with its `maxHeight` (held to the room it has,
 * the rest goes on).
 *
 * To both overlap checks the Sandbox adds one way out of its own (#1081),
 * `allowOverlap`: `overlap: 'allow'` on the frame placed so on purpose
 * (a `frameCovered`'s covering frame, a `frameOutsideArea`'s own), the
 * field the frame editor's switch writes; listed after the layout's.
 *
 * The edits change the form of the book, so the Sandbox asks before it
 * applies one; each is one step of the undo history (#899). Pure: the
 * Checks panel, the Reflow panel, the WebMCP tool and the tests plan an
 * edit here and carry it out with {@link applyProposalPlan}.
 */

import type { Dispatch } from 'react';
import type { Dimension, PostextConfig } from 'postext';
import type { AllowOverlapProposal, FrameProposal } from './frameOverlapText.js';
import type { SandboxAction } from '../context/SandboxContext.js';
import type { TextChange } from '../book/textChanges.js';
import { fenceTemplateChange, templateFences } from '../templates/templateUsage.js';
import { applyViewerEdit } from '../editor/viewerEdits.js';
import type { Warning, WarningPayload } from './types.js';
import { localNumber } from '../viewport/composed/reflowText.js';

type FrameOverflowPayload = Extract<WarningPayload, { kind: 'frameOverflow' }>;

/** A configuration value to set, by JSON pointer. */
export interface ConfigLeaf {
  pointer: string;
  value: unknown;
}

export type ProposalPlan =
  | {
    kind: 'config';
    proposal: FrameProposal;
    leaves: ConfigLeaf[];
    /** The top-level configuration keys after the change (for
     *  `UPDATE_CONFIG`). */
    patch: Partial<PostextConfig>;
    /** The settings in words: «tema-cajas › dinero › fit.minScale». */
    settings: string[];
  }
  | { kind: 'text'; proposal: FrameProposal; chapterId: string; changes: TextChange[]; baseLength: number; template: string }
  | { kind: 'select'; proposal: FrameProposal; chapterId: string; from: number; to: number; chars: number }
  /** The proposal cannot be carried out on the book as it is now (the
   *  configuration or the text changed since the layout proposed it). */
  | { kind: 'stale'; proposal: FrameProposal; reason: string };

/** Whether carrying the proposal out changes the book (and so asks). */
export function proposalChangesForm(p: FrameProposal): boolean {
  return p.kind !== 'shortenText';
}

/** Whether a plan is a move the Sandbox cannot make (the frame has no
 *  placement, or its offset is in ems or percent): told in words only. */
export function planIsAdvice(plan: ProposalPlan): boolean {
  return plan.kind === 'stale' && plan.reason === 'move';
}

const MM_PER: Partial<Record<string, number>> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 };

/** A `move` of an overlap check as an edit (#1066): the moved frame's
 *  `placement.offset` with the shift added, in mm, when the frame is
 *  placed and its offset is in absolute units (the engine's shift is in
 *  mm on the sheet; the offset adds to the anchor point the same way). */
function moveLeaf(warning: Warning, p: Extract<FrameProposal, { kind: 'move' }>, config: PostextConfig): ConfigLeaf | null {
  const w = warning.payload;
  const path = w.kind === 'frameCovered' && p.frame === w.coveredBy ? w.coveredByPath : 'frame' in w && p.frame === w.frame && 'configPath' in w ? w.configPath : null;
  if (!path) return null;
  const frame = getAtPointer(config, path);
  if (!isRecord(frame) || frame.name !== p.frame || !isRecord(frame.placement)) return null;
  const offset = isRecord(frame.placement.offset) ? frame.placement.offset : {};
  const next: Record<string, unknown> = { ...offset };
  for (const [axis, delta] of [['x', p.dxMm], ['y', p.dyMm]] as const) {
    if (delta === 0) continue;
    const old = offset[axis];
    let mm = 0;
    if (old !== undefined) {
      if (!isRecord(old) || typeof old.value !== 'number' || typeof old.unit !== 'string' || MM_PER[old.unit] === undefined) return null;
      mm = old.value * MM_PER[old.unit]!;
    }
    next[axis] = { value: Math.round((mm + delta) * 10) / 10, unit: 'mm' };
  }
  return { pointer: `${path}/placement/offset`, value: next };
}

/** `/a/b~1c/0` → `['a', 'b/c', '0']`. */
export function pointerSteps(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`"${pointer}" is not a JSON pointer`);
  return pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value at a pointer, or undefined. */
export function getAtPointer(root: unknown, pointer: string): unknown {
  let at: unknown = root;
  for (const step of pointerSteps(pointer)) {
    if (Array.isArray(at)) at = at[Number(step)];
    else if (isRecord(at)) at = at[step];
    else return undefined;
  }
  return at;
}

/** `root` with `value` at `pointer`, copying every object and list on the
 *  way (and making the objects that are missing at its end, such as a
 *  frame's `fit` it never set). A list position that does not exist is
 *  refused. */
export function setAtPointer<T>(root: T, pointer: string, value: unknown): T {
  const steps = pointerSteps(pointer);
  if (steps.length === 0) return value as T;
  const write = (node: unknown, i: number): unknown => {
    const step = steps[i]!;
    const last = i === steps.length - 1;
    if (Array.isArray(node)) {
      const at = Number(step);
      if (!Number.isInteger(at) || at < 0 || at >= node.length) throw new Error(`no item ${step} in the list at ${steps.slice(0, i).join('/')}`);
      const copy = node.slice();
      copy[at] = last ? value : write(node[at], i + 1);
      return copy;
    }
    const obj = isRecord(node) ? node : {};
    return { ...obj, [step]: last ? value : write(obj[step], i + 1) };
  };
  return write(root, 0) as T;
}

/** A pointer into the page templates in words: the template by its id,
 *  frames and groups by their names, the rest of the path with dots
 *  (`/pageTemplates/0/frames/2/fit/minScale` → «tema-cajas › dinero ›
 *  fit.minScale»). */
export function pointerInWords(config: PostextConfig, pointer: string): string {
  const steps = pointerSteps(pointer);
  const out: string[] = [];
  let at: unknown = config;
  let rest: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const next: unknown = Array.isArray(at) ? at[Number(step)] : isRecord(at) ? at[step] : undefined;
    const parent = steps[i - 1];
    if (Array.isArray(at) && isRecord(next) && (parent === 'pageTemplates' || parent === 'frames' || parent === 'groups')) {
      const name = typeof next.id === 'string' ? next.id : typeof next.name === 'string' ? next.name : step;
      out.push(name);
      rest = [];
    } else if (step === 'pageTemplates' || step === 'frames' || step === 'groups') {
      rest = [];
    } else if (parent === 'variants') {
      out.push(step);
    } else if (step !== 'variants') {
      rest.push(step);
    }
    at = next;
    if (i === steps.length - 1 && rest.length > 0) out.push(rest.join('.'));
  }
  return out.join(' › ');
}

/** A value as the confirmation shows it. */
export function valueInWords(v: unknown, locale?: string): string {
  if (isRecord(v) && typeof v.value === 'number' && typeof v.unit === 'string') {
    const d = v as unknown as Dimension;
    return `${localNumber(d.value, locale)} ${d.unit}`;
  }
  if (typeof v === 'number') {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(v);
    } catch {
      return String(v);
    }
  }
  if (typeof v === 'string') return `"${v}"`;
  // An offset (a move, #1066): «x −4 mm, y −22,5 mm».
  if (isRecord(v)) return Object.entries(v).map(([k, x]) => `${k} ${valueInWords(x, locale)}`).join(', ');
  return String(v);
}

/** The configuration leaves a proposal sets. */
export function proposalLeaves(p: FrameProposal): ConfigLeaf[] {
  switch (p.kind) {
    case 'allowShrink':
      return [{ pointer: p.path, value: p.value }, ...(p.also ?? []).map((a) => ({ pointer: a.path, value: a.value }))];
    case 'raiseMax':
    case 'lowerMin':
    case 'maxHeight':
    case 'minHeight':
      return [{ pointer: p.path, value: { ...p.value } }];
    case 'continueNextPage':
      return [{ pointer: p.path, value: 'next-page' }];
    // The overlap fixes (#1053): the covering frame painted under, or
    // pushing the text round it.
    case 'layer':
      return [{ pointer: p.path, value: p.value }];
    case 'exclude':
      return [{ pointer: p.path, value: 'push' }];
    case 'allowOverlap':
      return [{ pointer: p.path, value: 'allow' }];
    default:
      return [];
  }
}

/** The template entry a pointer goes through (`/pageTemplates/3/…` → the
 *  entry 3) and the frame entry (`…/frames/2`), to check that the book
 *  still has them as the layout saw them. */
function entriesOnPath(config: PostextConfig, pointer: string): { template?: unknown; frames: unknown[] } {
  const steps = pointerSteps(pointer);
  const frames: unknown[] = [];
  let template: unknown;
  let at: unknown = config;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    at = Array.isArray(at) ? at[Number(step)] : isRecord(at) ? at[step] : undefined;
    if (steps[i - 1] === 'pageTemplates' && template === undefined) template = at;
    if (steps[i - 1] === 'frames') frames.push(at);
  }
  return { template, frames };
}

export interface ProposalContext {
  /** The configuration of the book on screen (`state.config`). */
  config: PostextConfig;
  /** The chapters of the book on screen. */
  chapters: readonly { id: string; markdown: string }[];
}

/** The book as the state holds it: the chapter on screen's text is the
 *  editor's (`state.markdown`). */
export function proposalContextOf(state: { config: PostextConfig; chapters: readonly { id: string; markdown: string }[]; activeChapterId: string; markdown: string }): ProposalContext {
  return {
    config: state.config,
    chapters: state.chapters.map((c) => (c.id === state.activeChapterId ? { id: c.id, markdown: state.markdown } : c)),
  };
}

/** What carrying `proposal` of `warning` out does to the book as it is. */
export function planProposal(warning: Warning, proposal: FrameProposal, ctx: ProposalContext): ProposalPlan {
  const payload = warning.payload as FrameOverflowPayload;
  const stale = (reason: string): ProposalPlan => ({ kind: 'stale', proposal, reason });
  if ((proposal.kind === 'useTemplate' || proposal.kind === 'shortenText') && payload.kind === 'frameOverflow') {
    const chapter = warning.chapterId !== undefined ? ctx.chapters.find((c) => c.id === warning.chapterId) : ctx.chapters.length === 1 ? ctx.chapters[0] : undefined;
    if (!chapter) return stale('chapter');
    // The proposal's range is in the same text as the warning's own:
    // the chapter's offsets are the book's less the chapter's start.
    const shift = warning.sourceStart !== undefined && warning.chapterStart !== undefined ? warning.sourceStart - warning.chapterStart : 0;
    if (proposal.kind === 'shortenText') {
      const from = (proposal.sourceStart ?? warning.sourceStart ?? 0) - shift;
      const to = (proposal.sourceEnd ?? warning.sourceEnd ?? from + shift) - shift;
      if (from < 0 || to > chapter.markdown.length || to < from) return stale('text');
      return { kind: 'select', proposal, chapterId: chapter.id, from, to, chars: proposal.value };
    }
    let change: TextChange | null = null;
    if (proposal.sourceStart !== undefined && proposal.sourceEnd !== undefined) {
      const from = proposal.sourceStart - shift;
      const to = proposal.sourceEnd - shift;
      if (from >= 0 && to <= chapter.markdown.length && chapter.markdown.slice(from, to) === payload.template) {
        change = { from, to, insert: proposal.value, expect: payload.template };
      }
    }
    if (!change) {
      // The fence by its ordinal in the chapter, when the range moved.
      const fence = templateFences(chapter.markdown)[payload.fenceIndex];
      if (fence && fence.template === payload.template) change = fenceTemplateChange(chapter.markdown, fence.fenceStart, proposal.value);
    }
    if (!change) return stale('text');
    return { kind: 'text', proposal, chapterId: chapter.id, changes: [change], baseLength: chapter.markdown.length, template: proposal.value };
  }
  let leaves = proposalLeaves(proposal);
  if (proposal.kind === 'move') {
    const leaf = moveLeaf(warning, proposal, ctx.config);
    if (!leaf) return stale('move');
    leaves = [leaf];
  }
  // A frame past its edge goes on on the next page once it is held to the
  // room it has (#1053): the two together.
  if (proposal.kind === 'continueNextPage' && warning.payload.kind === 'frameOutsideArea') {
    const max = warning.payload.proposals.find((q) => q.kind === 'maxHeight');
    if (max) leaves = [...proposalLeaves(max), ...leaves];
  }
  if (leaves.length === 0) return stale('kind');
  let next: PostextConfig = ctx.config;
  for (const leaf of leaves) {
    // The template the pointer goes through must be the one the layout
    // saw (by its id), and a frame on the way the frame it named.
    const { template, frames } = entriesOnPath(ctx.config, leaf.pointer);
    if (!isRecord(template)) return stale('config');
    if (frames.some((f) => !isRecord(f) || typeof f.name !== 'string')) return stale('config');
    try {
      next = setAtPointer(next, leaf.pointer, leaf.value);
    } catch {
      return stale('config');
    }
  }
  const top = new Set(leaves.map((l) => pointerSteps(l.pointer)[0]!));
  const patch: Partial<PostextConfig> = {};
  for (const key of top) (patch as Record<string, unknown>)[key] = (next as Record<string, unknown>)[key];
  return { kind: 'config', proposal, leaves, patch, settings: leaves.map((l) => pointerInWords(ctx.config, l.pointer)) };
}

/** Carry a plan out: a configuration write or a text edit, one step of
 *  the undo history each; a selection opens the editor on the text.
 *  Answers whether the book changed. */
export function applyProposalPlan(plan: ProposalPlan, dispatch: Dispatch<SandboxAction>): boolean {
  switch (plan.kind) {
    case 'config':
      dispatch({ type: 'UPDATE_CONFIG', payload: plan.patch, history: { merge: false } });
      return true;
    case 'text':
      applyViewerEdit(dispatch, plan.chapterId, plan.changes, plan.baseLength);
      return true;
    case 'select':
      dispatch({ type: 'SET_PANEL', payload: 'markdown' });
      dispatch({ type: 'SET_PENDING_EDITOR_FOCUS', payload: { chapterId: plan.chapterId, anchor: plan.from, head: plan.to, selectWord: false } });
      return false;
    default:
      return false;
  }
}

/** The checks of a frame that come with fixes: a frame that does not fit
 *  (#858) and the overlap checks (#1053). */
export const FRAME_FIX_KINDS = ['frameOverflow', 'frameCovered', 'frameOutsideArea'] as const;
export type FrameFixKind = (typeof FRAME_FIX_KINDS)[number];
export type FrameFixPayload = Extract<WarningPayload, { kind: FrameFixKind }>;

export function isFrameFixPayload(p: WarningPayload): p is FrameFixPayload {
  return (FRAME_FIX_KINDS as readonly string[]).includes(p.kind);
}

/** The `overlap: 'allow'` way out of an overlap check (#1081): on the
 *  covering frame of a `frameCovered` (the one laid over the other on
 *  purpose: a caption pill over its photo), on the frame itself of a
 *  `frameOutsideArea` (a badge hung off its card). */
export function allowOverlapOf(payload: WarningPayload): AllowOverlapProposal | undefined {
  if (payload.kind === 'frameCovered') return { kind: 'allowOverlap', frame: payload.coveredBy, path: `${payload.coveredByPath}/overlap` };
  if (payload.kind === 'frameOutsideArea') return { kind: 'allowOverlap', frame: payload.frame, path: `${payload.configPath}/overlap` };
  return undefined;
}

/** A check's fixes as the panels and the tools list them: the layout's,
 *  then the overlap checks' `allowOverlap`. */
export function fixesOfPayload(payload: WarningPayload): readonly FrameProposal[] {
  if (!isFrameFixPayload(payload)) return [];
  const own: readonly FrameProposal[] = payload.proposals ?? [];
  const allow = allowOverlapOf(payload);
  return allow ? [...own, allow] : own;
}

/** A warning's fixes, when it is a check of a frame (the layout's only). */
export function proposalsOf(warning: Warning): readonly FrameProposal[] {
  return isFrameFixPayload(warning.payload) ? warning.payload.proposals ?? [] : [];
}

/** A warning's fixes with the Sandbox's `allowOverlap` (#1081). */
export function fixesOf(warning: Warning): readonly FrameProposal[] {
  return fixesOfPayload(warning.payload);
}

/** The `frameOverflow` warnings of a list, with their proposals. */
export function overflowWarnings(warnings: readonly Warning[]): (Warning & { payload: FrameOverflowPayload })[] {
  return warnings.filter((w): w is Warning & { payload: FrameOverflowPayload } => w.payload.kind === 'frameOverflow' && (w.payload.proposals?.length ?? 0) > 0);
}
