/**
 * What the layout changed on a composed page, in the reader's language
 * (#868): the engine's reflow log (#856, `VDTComposedPage.log`) is data —
 * a frame grew, moved, gave up room, had its text or pictures scaled, went
 * on to another page, or still does not fit — and each event becomes a
 * sentence built from labels with `__token__` placeholders, numbers in the
 * reader's numerals: «dinero grew 8.2 mm to hold its content», «gasto
 * moved down 8.2 mm to make room for dinero», «dinero-fotos: its pictures
 * are at 92 %».
 *
 * The frames that changed are numbered in log order (a frame's number is
 * the badge drawn on it in the canvas overlay, `reflowMarks.ts`), so the
 * list and the page read together. Pure: the panel, the overlay and the
 * tests read it.
 */

import type { ReflowEvent, VDTPage } from 'postext';
import type { SandboxLabels } from '../../types/index.js';
import { fill } from '../../print/fillTokens.js';

export type ReflowLabels = Pick<
  SandboxLabels,
  | 'reflowGrew'
  | 'reflowGrewWider'
  | 'reflowGaveUp'
  | 'reflowGaveUpFor'
  | 'reflowNarrowed'
  | 'reflowNarrowedFor'
  | 'reflowResized'
  | 'reflowMovedDown'
  | 'reflowMovedUp'
  | 'reflowMovedLeft'
  | 'reflowMovedRight'
  | 'reflowForCause'
  | 'reflowForGutter'
  | 'reflowImageScaled'
  | 'reflowTextScaled'
  | 'reflowContinued'
  | 'reflowContinuedIn'
  | 'reflowOverflow'
  | 'reflowCovered'
  | 'reflowOutsideTrim'
  | 'reflowOutsideBleed'
  | 'reflowOutsideFrame'
>;

/** A number with at most one decimal, in the reader's numerals. */
export function localNumber(v: number, locale?: string): string {
  const r = Math.round(v * 10) / 10;
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(r);
  } catch {
    return String(r);
  }
}

/** How far the event's box changed, mm (absent for scales). */
export function eventDelta(e: ReflowEvent): number | undefined {
  return e.fromMm !== undefined && e.toMm !== undefined ? Math.abs(e.toMm - e.fromMm) : undefined;
}

export interface ReflowSentenceOptions {
  locale?: string;
  /** The printed number of a page of the document (`VDTPage.index`). */
  pageLabel?: (index: number) => string;
}

/** One event in words. */
export function reflowSentence(e: ReflowEvent, labels: ReflowLabels, opts: ReflowSentenceOptions = {}): string {
  const n = (v: number): string => localNumber(v, opts.locale);
  const delta = eventDelta(e);
  const mm = delta !== undefined ? n(delta) : '';
  const across = e.axis === 'x';
  const withCause = (text: string): string => {
    if (!e.cause) return text;
    if (e.cause === 'gutter') return fill(labels.reflowForGutter, { event: text });
    return fill(labels.reflowForCause, { event: text, cause: e.cause });
  };
  switch (e.kind) {
    case 'grew':
      return fill(across ? labels.reflowGrewWider : labels.reflowGrew, { frame: e.frame, mm });
    case 'resized': {
      if (e.fromMm !== undefined && e.toMm !== undefined && e.toMm < e.fromMm) {
        const cause = e.cause && e.cause !== 'gutter' ? e.cause : null;
        if (across) return cause ? fill(labels.reflowNarrowedFor, { frame: e.frame, mm, cause }) : fill(labels.reflowNarrowed, { frame: e.frame, mm });
        return cause ? fill(labels.reflowGaveUpFor, { frame: e.frame, mm, cause }) : fill(labels.reflowGaveUp, { frame: e.frame, mm });
      }
      return fill(labels.reflowResized, { frame: e.frame, mm: n(e.toMm ?? 0) });
    }
    case 'moved': {
      const forward = (e.toMm ?? 0) > (e.fromMm ?? 0);
      const label = across ? (forward ? labels.reflowMovedRight : labels.reflowMovedLeft) : forward ? labels.reflowMovedDown : labels.reflowMovedUp;
      return withCause(fill(label, { frame: e.frame, mm }));
    }
    case 'imageScaled':
      return withCause(fill(labels.reflowImageScaled, { frame: e.frame, percent: n((e.scale ?? 1) * 100) }));
    case 'textScaled':
      return fill(labels.reflowTextScaled, { frame: e.frame, percent: n((e.scale ?? 1) * 100) });
    case 'continued': {
      const page = e.toPage !== undefined ? (opts.pageLabel ? opts.pageLabel(e.toPage) : String(e.toPage + 1)) : '?';
      return e.cause ? fill(labels.reflowContinuedIn, { frame: e.frame, page, to: e.cause }) : fill(labels.reflowContinued, { frame: e.frame, page });
    }
    case 'overflow':
      return fill(labels.reflowOverflow, { frame: e.frame, mm: n(e.toMm ?? 0) });
    // The overlap checks (#1053): ink under a frame painted over it, ink
    // past the trim, the bleed or the box it is anchored inside.
    case 'covered':
      return fill(labels.reflowCovered, { frame: e.frame, cause: e.cause ?? '', area: n(e.areaMm2 ?? 0) });
    case 'outside': {
      const values = { frame: e.frame, mm: n(e.toMm ?? 0) };
      if (e.past === 'trim') return fill(labels.reflowOutsideTrim, values);
      if (e.past === 'bleed') return fill(labels.reflowOutsideBleed, values);
      return fill(labels.reflowOutsideFrame, { ...values, target: (e.past ?? '').replace(/^#/, '') });
    }
    default:
      return `${e.frame} ${String(e.kind)}`;
  }
}

/** The short mark an event leaves on its frame's badge: «+8.2 mm»,
 *  «↓ 8.2 mm», «92 %» (symbols and numbers, read the same in every
 *  language). */
export function reflowShort(e: ReflowEvent, locale?: string): string {
  const n = (v: number): string => localNumber(v, locale);
  const delta = eventDelta(e);
  switch (e.kind) {
    case 'grew':
      return `+${n(delta ?? 0)} mm`;
    case 'resized':
      return e.fromMm !== undefined && e.toMm !== undefined && e.toMm < e.fromMm ? `−${n(delta ?? 0)} mm` : `${n(e.toMm ?? 0)} mm`;
    case 'moved': {
      const forward = (e.toMm ?? 0) > (e.fromMm ?? 0);
      const arrow = e.axis === 'x' ? (forward ? '→' : '←') : forward ? '↓' : '↑';
      return `${arrow} ${n(delta ?? 0)} mm`;
    }
    case 'imageScaled':
    case 'textScaled':
      return `${n((e.scale ?? 1) * 100)} %`;
    case 'continued':
      return '↪';
    case 'overflow':
      return `−${n(e.toMm ?? 0)} mm`;
    case 'covered':
      return `▨ ${n(e.areaMm2 ?? 0)} mm²`;
    case 'outside':
      return `⇥ ${n(e.toMm ?? 0)} mm`;
    default:
      return '';
  }
}

/** A frame that changed on a page: its number (from 1, in log order) and
 *  its events. */
export interface ReflowFrameEntry {
  number: number;
  frame: string;
  /** `VDTFrame.id` on the page, when the frame is on it. */
  frameId: string | null;
  events: ReflowEvent[];
}

/** The frames a page's log names, numbered in the order the log first
 *  names them (template order: the engine logs each frame's size first,
 *  then its moves; overflow last). */
export function reflowEntries(page: Pick<VDTPage, 'composed'>): ReflowFrameEntry[] {
  const c = page.composed;
  if (!c) return [];
  const byFrame = new Map<string, ReflowFrameEntry>();
  for (const e of c.log) {
    let entry = byFrame.get(e.frame);
    if (!entry) {
      const f = c.frames.find((x) => x.name === e.frame && !(x.facingBlocks && x.blockIds.length === 0)) ?? c.frames.find((x) => x.name === e.frame);
      entry = { number: byFrame.size + 1, frame: e.frame, frameId: f?.id ?? null, events: [] };
      byFrame.set(e.frame, entry);
    }
    entry.events.push(e);
  }
  return [...byFrame.values()];
}

/** One page's reflow in words: what the panel lists. */
export interface PageReflow {
  /** Index in the document's pages. */
  pageIndex: number;
  /** The number printed on the page. */
  pageLabel: string;
  template: string;
  fenceIndex: number;
  entries: (ReflowFrameEntry & { lines: string[]; short: string })[];
}

/** Every composed page of a document whose layout changed something. */
export function documentReflow(
  doc: { pages: readonly Pick<VDTPage, 'composed' | 'index' | 'pageLabel' | 'pageNumberValue'>[] },
  labels: ReflowLabels,
  locale?: string,
): PageReflow[] {
  const labelOf = (index: number): string => {
    const p = doc.pages.find((q) => q.index === index);
    return String(p?.pageLabel ?? p?.pageNumberValue ?? index + 1);
  };
  const out: PageReflow[] = [];
  doc.pages.forEach((page, pageIndex) => {
    const c = page.composed;
    if (!c || c.log.length === 0) return;
    const entries = reflowEntries(page).map((entry) => ({
      ...entry,
      lines: entry.events.map((e) => reflowSentence(e, labels, { locale, pageLabel: labelOf })),
      short: entry.events.map((e) => reflowShort(e, locale)).filter(Boolean).join(' '),
    }));
    out.push({ pageIndex, pageLabel: String(page.pageLabel ?? page.pageNumberValue ?? pageIndex + 1), template: c.template, fenceIndex: c.fenceIndex, entries });
  });
  return out;
}
