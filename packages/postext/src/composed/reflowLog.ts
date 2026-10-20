/**
 * The reflow log of a composed page (#856, DESIGN §5.5): what the layout
 * changed from the template's own drawing so the page's content fits —
 * «dinero grew 8 mm; gasto moved down 8 mm». Each frame's box as the
 * template declares it (its fixed size, or its `minHeight` when its height
 * follows its content) is compared with the box the layout gave it.
 */
import type { FrameCoverProposal, FrameFitStep, FrameOutsideProposal, FrameOverflowProposal, ReflowEvent, VDTDocument } from '../vdt';
import type { Rect } from './geometry';

/** A frame's declared and final boxes, and the names whose change moves
 *  it (what it anchors to, the frames before it in its group), nearest
 *  first. */
export interface FrameMotion {
  name: string;
  declared: Rect;
  final: Rect;
  deps: readonly string[];
}

/** Smallest change the log reports, in millimetres. */
const MIN_MM = 0.5;

/** To 0.1 mm; a hair over the half rounds up, so two lengths that differ
 *  only in float noise round alike. */
const round = (mm: number): number => Math.round(mm * 10 + (mm >= 0 ? 1e-6 : -1e-6)) / 10;

/** The events of a page's frames, in `motions` order (template order):
 *  per frame its size first (height, then width), then its moves. */
export function reflowEvents(motions: readonly FrameMotion[], pxPerMm: number): ReflowEvent[] {
  const mm = (v: number): number => v / pxPerMm;
  const sized = new Set<string>();
  const grew = new Set<string>();
  const moved = new Set<string>();
  for (const m of motions) {
    if (Math.abs(mm(m.final.height - m.declared.height)) >= MIN_MM || Math.abs(mm(m.final.width - m.declared.width)) >= MIN_MM) sized.add(m.name);
    if (mm(m.final.height - m.declared.height) >= MIN_MM || mm(m.final.width - m.declared.width) >= MIN_MM) grew.add(m.name);
    if (Math.abs(mm(m.final.y - m.declared.y)) >= MIN_MM || Math.abs(mm(m.final.x - m.declared.x)) >= MIN_MM) moved.add(m.name);
  }
  const byName = new Map(motions.map((m) => [m.name, m]));
  const causes = new Map<string, string | undefined>();
  /** The frame whose change set this one off: the nearest dependency that
   *  grew, else the nearest that changed size, else the cause of the
   *  nearest one that moved. In a row, the cards that give width to a
   *  sibling name that sibling, not each other (#877). */
  const causeOf = (name: string, seen: Set<string> = new Set()): string | undefined => {
    if (causes.has(name)) return causes.get(name);
    if (seen.has(name)) return undefined;
    seen.add(name);
    const deps = byName.get(name)?.deps ?? [];
    let found = deps.find((d) => grew.has(d) && d !== name) ?? deps.find((d) => sized.has(d) && d !== name);
    if (!found) {
      const via = deps.find((d) => moved.has(d) && d !== name);
      if (via) found = causeOf(via, seen) ?? via;
    }
    causes.set(name, found);
    return found;
  };
  /** Both ends in mm, the change rounded once: «moved down 3.4 mm» reads
   *  the same off any two frames that moved together. */
  const span = (from: number, to: number): { fromMm: number; toMm: number } => {
    const fromMm = round(mm(from));
    return { fromMm, toMm: round(fromMm + round(mm(to - from))) };
  };
  const out: ReflowEvent[] = [];
  for (const m of motions) {
    const cause = causeOf(m.name);
    const withCause = cause !== undefined ? { cause } : {};
    const size = (from: number, to: number, axis: 'x' | 'y'): void => {
      if (Math.abs(mm(to - from)) < MIN_MM) return;
      const grew = to > from;
      out.push({
        frame: m.name,
        kind: grew ? 'grew' : 'resized',
        ...span(from, to),
        ...(axis === 'x' ? { axis } : {}),
        // A frame grows for its own content; one that gives space back
        // does so for another's.
        ...(grew ? {} : withCause),
      });
    };
    size(m.declared.height, m.final.height, 'y');
    size(m.declared.width, m.final.width, 'x');
    const move = (from: number, to: number, axis: 'x' | 'y'): void => {
      if (Math.abs(mm(to - from)) < MIN_MM) return;
      out.push({ frame: m.name, kind: 'moved', ...span(from, to), ...(axis === 'x' ? { axis } : {}), ...withCause });
    };
    move(m.declared.y, m.final.y, 'y');
    move(m.declared.x, m.final.x, 'x');
  }
  return out;
}

const num = (v: number): string => String(Math.round(v * 10) / 10);
const pct = (v: number): string => `${Math.round(v * 1000) / 10} %`;

/** One event in words, in English (the command line's language):
 *  «dinero grew 8 mm», «gasto moved down 8 mm», «foto narrowed 4 mm»,
 *  «dinero continued on page 9» (the page's index + 1; `composedReflowLog`
 *  names it by its printed number). */
export function describeReflowEvent(e: ReflowEvent): string {
  return describeEvent(e);
}

function describeEvent(e: ReflowEvent, pageLabel?: (index: number) => string): string {
  const delta = e.fromMm !== undefined && e.toMm !== undefined ? Math.abs(e.toMm - e.fromMm) : undefined;
  const by = delta !== undefined ? ` ${num(delta)} mm` : '';
  const x = e.axis === 'x';
  switch (e.kind) {
    case 'grew':
      return `${e.frame} grew${by}${x ? ' wider' : ''}`;
    case 'resized':
      if (e.fromMm !== undefined && e.toMm !== undefined && e.toMm < e.fromMm) return `${e.frame} ${x ? 'narrowed' : 'gave up'}${by}${e.cause ? ` for ${e.cause}` : ''}`;
      return `${e.frame} resized to ${num(e.toMm ?? 0)} mm`;
    case 'moved': {
      const forward = (e.toMm ?? 0) > (e.fromMm ?? 0);
      const dir = x ? (forward ? 'right' : 'left') : forward ? 'down' : 'up';
      return `${e.frame} moved ${dir}${by}`;
    }
    case 'overflow':
      return `${e.frame} overflows by ${num(e.toMm ?? 0)} mm`;
    case 'imageScaled':
      return `${e.frame}: picture at ${pct(e.scale ?? 1)}`;
    case 'textScaled':
      return `${e.frame}: text at ${pct(e.scale ?? 1)}`;
    case 'continued':
      return `${e.frame} continued${e.toPage !== undefined ? ` on page ${pageLabel ? pageLabel(e.toPage) : String(e.toPage + 1)}` : ''}${e.cause ? ` in ${e.cause}` : ''}`;
    case 'covered':
      return `${e.frame} lies under ${e.cause ?? 'another frame'}${e.areaMm2 !== undefined ? ` (${num(e.areaMm2)} mm²)` : ''}`;
    case 'outside': {
      const past = e.past === undefined ? 'its area' : e.past.startsWith('#') ? e.past.slice(1) : `the ${e.past}`;
      return `${e.frame} runs ${num(e.toMm ?? 0)} mm past ${past}`;
    }
    case 'connectorDropped':
      return `connector ${e.cause ?? ''} left out ${e.frame} (not on the page)`.replace('  ', ' ');
    default:
      return `${e.frame} ${String(e.kind)}`;
  }
}

/** A step of the reflow ladder in words, in English (#858): «text down to
 *  90 %». `scale` / `imageScale`: where the frame's text and pictures were
 *  left. */
export function describeFitStep(step: FrameFitStep, at: { scale?: number; imageScale?: number } = {}): string {
  switch (step) {
    case 'free':
      return 'free space';
    case 'push':
      return 'room from the frames around it (moved, or yielding with shrink)';
    case 'scaleImages':
      return at.imageScale !== undefined ? `pictures down to ${pct(at.imageScale)}` : 'smaller pictures';
    case 'redistribute':
      return 'the other frames of its group down to their minimum';
    case 'shrinkText':
      return at.scale !== undefined && at.scale < 1 ? `text down to ${pct(at.scale)}` : 'smaller text';
    case 'continue':
      return 'continuing on another page (its frame there takes none of it)';
    default:
      return String(step);
  }
}

const dim = (d: { value: number; unit: string }): string => `${Math.round(d.value * 10) / 10} ${d.unit}`;

/** A fix of a `frameOverflow` in words, in English (#858): «raise
 *  maxHeight to 64 mm». */
export function describeFrameOverflowProposal(p: FrameOverflowProposal): string {
  switch (p.kind) {
    case 'allowShrink':
      return `let its text shrink to ${pct(p.value)} (fit.minScale: ${p.value}${p.also?.length ? ', fit.shrinkText: true' : ''})`;
    case 'raiseMax':
      return `raise maxHeight to ${dim(p.value)}`;
    case 'lowerMin':
      return `lower the minHeight of "${p.frame}" to ${dim(p.value)}`;
    case 'continueNextPage':
      return 'continue on the next page (overflow.continueIn: "next-page")';
    case 'useTemplate':
      return `set the page with template "${p.value}"`;
    case 'shortenText':
      return `cut about ${p.value} characters`;
    default:
      return (p as { kind: string }).kind;
  }
}

/** A fix of a `frameCovered` in words, in English (#1053): «paint
 *  "photo" under it (layer: 0)». */
export function describeFrameCoverProposal(p: FrameCoverProposal): string {
  switch (p.kind) {
    case 'layer':
      return `paint the covering frame under it (layer: ${p.value})`;
    case 'exclude':
      return 'make the covering frame push its text round it (exclude: "push")';
    case 'move': {
      const parts: string[] = [];
      if (p.dxMm !== 0) parts.push(`${Math.abs(p.dxMm)} mm ${p.dxMm > 0 ? 'right' : 'left'}`);
      if (p.dyMm !== 0) parts.push(`${Math.abs(p.dyMm)} mm ${p.dyMm > 0 ? 'down' : 'up'}`);
      return `move "${p.frame}" ${parts.join(' and ') || 'off it'}`;
    }
    default:
      return (p as { kind: string }).kind;
  }
}

/** A fix of a `frameOutsideArea` in words, in English (#1053). */
export function describeFrameOutsideProposal(p: FrameOutsideProposal): string {
  switch (p.kind) {
    case 'maxHeight':
      return `hold it to maxHeight ${dim(p.value)}`;
    case 'minHeight':
      return `raise the minHeight of "${p.frame}" to ${dim(p.value)}`;
    case 'continueNextPage':
      return 'let the rest continue on the next page (overflow.continueIn: "next-page")';
    case 'move':
      return describeFrameCoverProposal(p);
    default:
      return (p as { kind: string }).kind;
  }
}

/** A composed page's log, for the command line and the Sandbox. */
export interface ComposedPageReflow {
  /** Book-absolute page index (`VDTPage.index`). */
  pageIndex: number;
  /** The page's printed number. */
  pageLabel: string;
  template: string;
  fenceIndex: number;
  events: ReflowEvent[];
  /** The events in words ({@link describeReflowEvent}). */
  lines: string[];
}

/** The reflow log of every composed page of `doc` that has one. */
export function composedReflowLog(doc: Pick<VDTDocument, 'pages'>): ComposedPageReflow[] {
  const out: ComposedPageReflow[] = [];
  const labelOf = (index: number): string => {
    const p = doc.pages.find((q) => q.index === index);
    return String(p?.pageLabel ?? p?.pageNumberValue ?? index + 1);
  };
  for (const page of doc.pages) {
    const c = page.composed;
    if (!c || c.log.length === 0) continue;
    out.push({
      pageIndex: page.index,
      pageLabel: String(page.pageLabel ?? page.pageNumberValue ?? page.index + 1),
      template: c.template,
      fenceIndex: c.fenceIndex,
      events: c.log.map((e) => ({ ...e })),
      lines: c.log.map((e) => describeEvent(e, labelOf)),
    });
  }
  return out;
}
