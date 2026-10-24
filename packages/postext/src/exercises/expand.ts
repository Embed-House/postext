/**
 * The exercises of a document set as ordinary blocks (#1227): each
 * `:::exercise` becomes a box (its style's `box`, or a frameless one) of
 * paragraphs, chips and drawn boxes the layout already knows — so an
 * exercise is placed, split, balanced, tagged and painted as any box is.
 * Its solutions go where the book says (#1229), and every exercise leaves
 * a record of what it asks and answers for the digital outputs (#1230).
 */

import type { ContentBlock, DirectiveAttrs, ExerciseGap, InlineSpan } from '../parse/index.js';
import { CHIP_PLACEHOLDER, TAB_PLACEHOLDER } from '../parse/inlineFormatting.js';
import type { CalloutStyleConfig, ChipStyleConfig, DigitSystem, HeadingCounters, ParagraphStyleConfig } from '../types.js';
import type { ExerciseSettings, ResolvedExerciseStyle, ResolvedExercisesConfig } from '../defaults/exercises.js';
import { pickExerciseStyle, solutionsOf } from '../defaults/exercises.js';
import { counterStyleOf, formatCounter } from '../numbering.js';
import { readExercises, containerEndOf } from './model.js';
import type { ExerciseIssue, ExerciseModel } from './types.js';
import { EMPTY_RUN, joinRuns, runOf, sliceRun, textRun, trimRun, blockOfRun, type Run } from './text.js';
import { exerciseBoxStyles, exerciseChipStyles, exerciseParagraphStyles, exerciseStyleIds, type ExerciseStyleIds } from './styles.js';
import { areaElements, drawnBox, type AreaKind } from './designs.js';
import { seededRandom, shuffledOrder } from './shuffle.js';
import { gridBox, type GridBox } from './grids.js';
import type { ExerciseGridInfo, ExerciseRecord, ExerciseSlot } from './record.js';

/** Container ids of the synthetic boxes and groups (clear of the parser's
 *  and of the other synthetic bases: 1e9 chapter-end notes, 1.5e9
 *  listings, 1.75e9 flow columns, 1.8e9 frames, 1.9e9 comic text, 2e9
 *  page-span embeds). */
export const EXERCISE_CONTAINER_BASE = 1_600_000_000;

/** What the expansion needs from the document. */
export interface ExpandContext {
  settings: ExerciseSettings;
  /** The document's locale and digits. */
  locale?: string;
  digits?: DigitSystem;
  /** Heading counters before the document (a book's earlier chapters). */
  headings?: HeadingCounters;
  /** Exercise counters carried from earlier chapters, by counter name. */
  counters?: Record<string, number>;
  /** The size of the text, points, and the room across a column. */
  bodySizePt: number;
  lineHeightPt: number;
  measurePt: number;
  /** The text's font family: drawn letters (grids, matching) use it. */
  bodyFont?: string;
  /** Ids of the configured box styles (a style's `box` must name one). */
  boxIds: ReadonlySet<string>;
}

export interface ExerciseExpansion {
  blocks: ContentBlock[];
  /** Whether any exercise was set. */
  wrapped: boolean;
  boxes: CalloutStyleConfig[];
  paragraphStyles: ParagraphStyleConfig[];
  chipStyles: ChipStyleConfig[];
  records: ExerciseRecord[];
  issues: ExerciseIssue[];
  /** The counters after the document, for the next chapter. */
  counters: Record<string, number>;
}

const SPACE = ' ';

/** A chip span holding `run`. */
function chipSpan(style: string, run: Run, extra: Partial<NonNullable<InlineSpan['chip']>> = {}): InlineSpan {
  return { text: CHIP_PLACEHOLDER, bold: false, italic: false, chip: { style, spans: run.spans.length > 0 ? run.spans : [{ text: run.text, bold: false, italic: false }], ...extra } };
}

/** A run of one chip, mapped to `at`. */
function chipRun(style: string, run: Run, at: number, extra: Partial<NonNullable<InlineSpan['chip']>> = {}): Run {
  return { text: CHIP_PLACEHOLDER, spans: [chipSpan(style, run, extra)], sourceMap: [at] };
}

const tabRun = (at: number): Run => ({ text: TAB_PLACEHOLDER, spans: [{ text: TAB_PLACEHOLDER, bold: false, italic: false, tab: {} }], sourceMap: [at] });

function marker(type: 'containerStart' | 'containerEnd', name: ContentBlock['containerName'], id: number, at: number, attrs?: DirectiveAttrs): ContentBlock {
  return {
    type, text: '', spans: [], sourceMap: [], sourceStart: at, sourceEnd: at,
    containerName: name, containerId: id, ...(attrs ? { containerAttrs: attrs } : {}),
  };
}

/** The plain text of a run, its chips' words included. */
function plain(run: Run | InlineSpan[]): string {
  const spans = Array.isArray(run) ? run : run.spans;
  return spans.map((s) => (s.chip ? plain(s.chip.spans) : s.text === TAB_PLACEHOLDER ? ' ' : s.text)).join('');
}

/** An option's label (`a)`, `ア`, `أ)`), `''` for none. */
function optionLabel(style: ResolvedExerciseStyle, k: number, locale?: string, digits?: DigitSystem): string {
  if (style.options.labels === 'none') return '';
  return `${style.options.prefix}${formatCounter(k + 1, counterStyleOf(style.options.labels, locale), locale, digits)}${style.options.suffix}`;
}

/** The exercise numbers of a document, each exercise's own counter reset
 *  by the heading level its style names. */
function numberExercises(blocks: readonly ContentBlock[], exercises: ExerciseModel[], ctx: ExpandContext): { numbers: Map<number, string>; counters: Record<string, number> } {
  const counters: Record<string, number> = { ...(ctx.counters ?? {}) };
  const heads = [0, ctx.headings?.h1 ?? 0, ctx.headings?.h2 ?? 0];
  const resetAt = new Map<string, number>();
  for (const s of ctx.settings.styles) {
    const level = s.number.resetOn === 'never' ? 0 : Number(s.number.resetOn.slice(1));
    resetAt.set(s.number.counter, Math.max(resetAt.get(s.number.counter) ?? 0, level));
  }
  const numbers = new Map<number, string>();
  let next = 0;
  for (let i = 0; i < blocks.length && next < exercises.length; i++) {
    const b = blocks[i]!;
    if (b.type === 'heading' && b.level) {
      if (b.level <= 2) { heads[b.level] = (heads[b.level] ?? 0) + 1; if (b.level === 1) heads[2] = 0; }
      for (const [counter, level] of resetAt) if (level > 0 && b.level <= level) counters[counter] = 0;
      continue;
    }
    const ex = exercises[next]!;
    if (i !== ex.start) continue;
    next++;
    const style = pickExerciseStyle(ctx.settings.styles, ex.attrs.style);
    const counter = style.number.counter;
    const written = ex.attrs.n !== undefined ? parseInt(ex.attrs.n, 10) : NaN;
    const n = Number.isFinite(written) ? written : (counters[counter] ?? 0) + 1;
    counters[counter] = n;
    const num = formatCounter(n, counterStyleOf(style.number.format, ctx.locale), ctx.locale, ctx.digits);
    numbers.set(ex.id, style.number.template.replace(/\{n\}/g, num).replace(/\{h1\}/g, String(heads[1])).replace(/\{h2\}/g, String(heads[2])));
  }
  return { numbers, counters };
}

/**
 * Set the exercises of `blocks`. Blocks outside exercises pass as they are;
 * a `:::solutions` line becomes the solutions the book prints there.
 */
export function expandExercises(blocks: readonly ContentBlock[], ctx: ExpandContext): ExerciseExpansion {
  const { exercises, issues } = readExercises(blocks);
  const book = ctx.settings.exercises;
  const out: ExerciseExpansion = { blocks: [], wrapped: false, boxes: [], paragraphStyles: [], chipStyles: [], records: [], issues, counters: { ...(ctx.counters ?? {}) } };
  const hasSolutionsLine = blocks.some((b) => b.type === 'directive' && b.directiveName === 'solutions');
  if (exercises.length === 0 && !hasSolutionsLine) {
    out.blocks = blocks as ContentBlock[];
    return out;
  }
  out.wrapped = true;
  const { numbers, counters } = numberExercises(blocks, exercises, ctx);
  out.counters = counters;
  let nextId = EXERCISE_CONTAINER_BASE;
  const newId = (): number => nextId++;
  const usedStyles = new Set<string>();
  const extraBoxes: CalloutStyleConfig[] = [];
  /** Solutions waiting for the end of their chapter (or a `:::solutions`). */
  let pending: { ex: ExerciseModel; style: ResolvedExerciseStyle; number: string; e: Emitter }[] = [];

  const emitter = (ex: ExerciseModel, style: ResolvedExerciseStyle, number: string): Emitter =>
    new Emitter(blocks, ex, style, book, number, ctx, newId, extraBoxes);

  const flushPending = (at: number, heading: string | undefined, sink: ContentBlock[]): void => {
    if (pending.length === 0) return;
    const id = newId();
    const style = pending[0]!.style;
    const ids = exerciseStyleIds(style);
    const box = solutionsOf(style, book).box && ctx.boxIds.has(solutionsOf(style, book).box!) ? solutionsOf(style, book).box! : ids.solutionList;
    sink.push(marker('containerStart', 'callout', id, at, { type: box, ...(heading ? { title: heading } : {}) }));
    for (const p of pending) sink.push(...p.e.solutionBlocks(true));
    sink.push(marker('containerEnd', 'callout', id, at));
    pending = [];
  };

  let exIndex = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const ex = exercises[exIndex];
    if (ex && i === ex.start) {
      exIndex++;
      const style = pickExerciseStyle(ctx.settings.styles, ex.attrs.style);
      usedStyles.add(style.id);
      const number = numbers.get(ex.id) ?? '';
      const e = emitter(ex, style, number);
      out.blocks.push(...e.exerciseBlocks());
      out.records.push(e.record());
      for (const word of e.unplaced) issues.push({ kind: 'exerciseWordUnplaced', exercise: ex.id, detail: word, sourceStart: ex.sourceStart, sourceEnd: ex.sourceEnd });
      const placement = solutionsOf(style, book).placement;
      if (placement === 'after' || placement === 'inverted') out.blocks.push(...e.solutionBox(placement === 'inverted'));
      else if (placement === 'chapterEnd' || placement === 'directive') pending.push({ ex, style, number, e });
      i = ex.end;
      continue;
    }
    // A chapter ends where the next one opens.
    if (b.type === 'heading' && b.level === 1 && pending.some((p) => solutionsOf(p.style, book).placement === 'chapterEnd')) {
      flushPending(b.sourceStart, pending[0] ? solutionsOf(pending[0].style, book).heading : undefined, out.blocks);
    }
    if (b.type === 'directive' && b.directiveName === 'solutions') {
      const heading = b.directiveAttrs?.title ?? (pending[0] ? solutionsOf(pending[0].style, book).heading : book.solutions.heading);
      flushPending(b.sourceStart, heading || undefined, out.blocks);
      continue;
    }
    // A solution or hint outside an exercise prints nothing.
    if (b.type === 'containerStart' && (b.containerName === 'solution' || b.containerName === 'hint')) {
      i = containerEndOf(blocks, i);
      continue;
    }
    out.blocks.push(b);
  }
  if (pending.some((p) => solutionsOf(p.style, book).placement === 'chapterEnd')) {
    const last = blocks[blocks.length - 1];
    flushPending(last ? last.sourceEnd : 0, solutionsOf(pending[0]!.style, book).heading, out.blocks);
  }

  for (const id of usedStyles) {
    const style = ctx.settings.styles.find((s) => s.id === id)!;
    const solBox = solutionsOf(style, book).box;
    out.boxes.push(...exerciseBoxStyles(style, solBox && ctx.boxIds.has(solBox) ? solBox : undefined, ctx.bodySizePt));
    out.paragraphStyles.push(...exerciseParagraphStyles(style));
    out.chipStyles.push(...exerciseChipStyles(style));
  }
  // The solutions box of a `:::solutions` line with no exercise before it.
  if (usedStyles.size === 0 && ctx.settings.styles[0]) {
    out.boxes.push(...exerciseBoxStyles(ctx.settings.styles[0], undefined, ctx.bodySizePt));
  }
  out.boxes.push(...extraBoxes);
  return out;
}

/** Sets one exercise. */
class Emitter {
  readonly ids: ExerciseStyleIds;
  readonly teacher: boolean;
  readonly at: number;
  readonly slots: ExerciseSlot[] = [];
  readonly grids: ExerciseGridInfo[] = [];
  /** The key, one run per item. */
  readonly key: Run[] = [];
  private bankWords: Run[] = [];
  /** The number, marks, icons and title, before the instruction. */
  private leadRun: Run | undefined;
  /** Words a grid could not place. */
  readonly unplaced: string[] = [];
  private readonly random: () => number;

  constructor(
    readonly blocks: readonly ContentBlock[],
    readonly ex: ExerciseModel,
    readonly style: ResolvedExerciseStyle,
    readonly book: ResolvedExercisesConfig,
    readonly number: string,
    readonly ctx: ExpandContext,
    readonly newId: () => number,
    readonly extraBoxes: CalloutStyleConfig[],
  ) {
    this.ids = exerciseStyleIds(style);
    this.teacher = book.edition === 'teacher';
    this.at = ex.sourceStart;
    this.random = seededRandom(book.seed, ex.ordinal, ex.kind);
  }

  private label(k: number): string {
    return optionLabel(this.style, k, this.ctx.locale, this.ctx.digits);
  }

  /** A label without its prefix and suffix, as a key prints it. */
  private bareLabel(k: number): string {
    if (this.style.options.labels === 'none') return '';
    return formatCounter(k + 1, counterStyleOf(this.style.options.labels, this.ctx.locale), this.ctx.locale, this.ctx.digits);
  }

  private open(name: ContentBlock['containerName'], attrs?: DirectiveAttrs): { start: ContentBlock; end: ContentBlock } {
    const id = this.newId();
    return { start: marker('containerStart', name, id, this.at, attrs), end: marker('containerEnd', name, id, this.at) };
  }

  /** The paragraphs of `runs` in the paragraph style `style`. */
  private paragraphs(style: string, runs: Run[]): ContentBlock[] {
    if (runs.length === 0) return [];
    const g = this.open('paragraphs', { style });
    return [g.start, ...runs.map((r) => blockOfRun('paragraph', r, { sourceStart: this.at, sourceEnd: this.at })), g.end];
  }

  /** A drawn box (an area, a grid) as blocks. */
  private drawn(style: CalloutStyleConfig): ContentBlock[] {
    this.extraBoxes.push(style);
    const g = this.open('callout', { type: style.id });
    return [g.start, g.end];
  }

  /** A drawn grid as blocks, its geometry and slots recorded. */
  private drawnGrid(box: GridBox): ContentBlock[] {
    const { slots, key, clues, words, info, unplaced, ...style } = box;
    void key; void clues; void words; void unplaced;
    const blocks = this.drawn(style);
    const id = blocks[0]!.containerId!;
    if (info) this.grids.push({ ...info, box: id });
    for (const s of slots ?? []) this.slots.push({ ...s, box: id });
    return blocks;
  }

  private get dpiFree(): { size: number; line: number; measure: number } {
    return { size: this.ctx.bodySizePt, line: this.ctx.lineHeightPt, measure: this.ctx.measurePt };
  }

  /** A writing area of `lines` lines, the answers written in a teacher's
   *  edition. */
  private area(lines: number, slot: string, answers?: string[], kind?: AreaKind, widthPt?: number): ContentBlock[] {
    const a = this.style.area;
    const k = kind ?? a.kind;
    const spacing = a.spacing ? dimPt(a.spacing, this.dpiFree.size) : this.dpiFree.line * (k === 'grid' || k === 'tianzige' ? 1.2 : 1.35);
    const { elements, heightPt } = areaElements({
      kind: k, lines, spacingPt: spacing, widthPt: widthPt ?? this.dpiFree.measure, color: a.color, weightPt: dimPt(a.weight, this.dpiFree.size),
      ...(this.teacher && answers ? { answers, answerColor: this.style.answers.color, answerSizePt: this.dpiFree.size * 0.95, ...(this.style.answers.fontFamily ?? this.ctx.bodyFont ? { answerFont: this.style.answers.fontFamily ?? this.ctx.bodyFont } : {}) } : {}),
    });
    const id = `${this.ids.frame}-area-${this.ex.ordinal}-${slot}`;
    const blocks = this.drawn(drawnBox(id, elements, heightPt));
    this.slots.push({ key: slot, kind: 'text', accept: answers?.filter((s) => s !== '') ?? [], box: blocks[0]!.containerId! });
    return blocks;
  }

  // --- The exercise ---------------------------------------------------------

  exerciseBlocks(): ContentBlock[] {
    const ex = this.ex;
    const frame = this.style.box && this.ctx.boxIds.has(this.style.box) ? this.style.box : this.ids.frame;
    const attrs: DirectiveAttrs = { type: frame, exercise: String(ex.id) };
    const outer = { start: marker('containerStart', 'callout', ex.id, this.at, attrs), end: marker('containerEnd', 'callout', ex.id, this.blocks[ex.end]!.sourceStart) };
    // A `{#id}` on the fence names the exercise.
    if (ex.attrs.id) outer.start.containerAttrs = { ...outer.start.containerAttrs, id: ex.attrs.id };
    let head = this.head();
    // The body first: the bank holds the answers it sets.
    const body = this.body();
    // An exercise that opens with its text (a gap in its first sentence):
    // the number runs into that paragraph.
    const firstAt = body[0]?.type === 'containerStart' && body[0].containerAttrs?.style === this.ids.text ? 1 : 0;
    if (this.ex.instruction.length === 0 && this.leadRun && body[firstAt]?.type === 'paragraph') {
      const first = body[firstAt]!;
      const run = joinRuns(this.leadRun, textRun(SPACE, this.at), runOf(first));
      body[firstAt] = { ...first, text: run.text, spans: run.spans, sourceMap: run.sourceMap };
      head = [];
    }
    const wantsBank = (this.ex.attrs.bank !== undefined && this.ex.attrs.bank !== 'false') || this.ex.banks.length > 0 || this.ex.kind === 'sort';
    return [outer.start, ...head, ...(wantsBank ? this.bank() : []), ...body, outer.end];
  }

  /** The number, level marks, icons, title and instruction. */
  private head(): ContentBlock[] {
    const ex = this.ex;
    const n = this.style.number;
    const lead: Run[] = [];
    if (n.show && this.number) {
      const text = `${n.label ? `${n.label} ` : ''}${this.number}${n.suffix}`;
      lead.push(chipRun(this.ids.number, textRun(text, this.at), this.at));
    }
    const level = ex.attrs.level !== undefined ? Math.max(0, Math.min(this.style.level.max, parseInt(ex.attrs.level, 10) || 0)) : 0;
    if (level > 0) {
      const marks = this.style.level.glyph.repeat(level) + this.style.level.empty.repeat(this.style.level.max - level);
      lead.push(chipRun(this.ids.level, textRun(marks, this.at), this.at));
    }
    for (const name of (ex.attrs.icon ?? '').split(/\s+/).filter(Boolean)) {
      const icon = this.style.icons[name];
      if (icon?.glyph) lead.push(chipRun(this.ids.icon, textRun(icon.glyph, this.at), this.at));
    }
    if (ex.attrs.title) lead.push(textRun(ex.attrs.title, this.at, { bold: true }));
    const first = ex.instruction[0];
    const rest = ex.instruction.slice(1);
    const runs: Run[] = [];
    const leadRun = joinRuns(...lead.flatMap((r, k) => (k > 0 ? [textRun(SPACE, this.at), r] : [r])));
    this.leadRun = leadRun.text ? leadRun : undefined;
    const bold = this.style.instruction.bold;
    const styled = (r: Run): Run => (bold ? { ...r, spans: r.spans.map((s) => (s.chip ? s : { ...s, bold: true })) } : r);
    if (first !== undefined) {
      const body = styled(this.gapsOf(runOf(this.blocks[first]!)));
      runs.push(leadRun.text ? joinRuns(leadRun, textRun(SPACE, this.at), body) : body);
    } else if (leadRun.text) {
      runs.push(leadRun);
    }
    for (const k of rest) runs.push(styled(this.gapsOf(runOf(this.blocks[k]!))));
    return this.paragraphs(this.ids.instruction, runs);
  }

  /** The body: blocks passed through (their answers set), the kind's items
   *  set in their place, `'bank'` where the word bank goes. */
  private body(): ContentBlock[] {
    const ex = this.ex;
    const out: ContentBlock[] = [];
    const done = new Set<number>();
    const lists = ex.body.filter((k) => this.blocks[k]!.type === 'listItem' && (this.blocks[k]!.depth ?? 1) <= 1);
    const firstOf = <T>(items: T[], blockOf: (t: T) => number): number | undefined => (items.length > 0 ? blockOf(items[0]!) : undefined);
    const groupStart = new Map<number, () => ContentBlock[]>();
    switch (ex.kind) {
      case 'choice':
        ex.questions.forEach((q, qi) => groupStart.set(q.stem ?? q.options[0]!.block, () => this.options(qi)));
        break;
      case 'truefalse': {
        const at = firstOf(ex.questions, (q) => q.options[0]!.block);
        if (at !== undefined) groupStart.set(at, () => this.statements());
        break;
      }
      case 'match': {
        const at = firstOf(ex.pairs, (p) => p.block);
        if (at !== undefined) groupStart.set(at, () => this.match());
        break;
      }
      case 'order': {
        const at = ex.sequence[0];
        if (at !== undefined) groupStart.set(at, () => this.order());
        break;
      }
      case 'scramble': {
        const at = firstOf(ex.sentences, (s) => s.block);
        if (at !== undefined) groupStart.set(at, () => this.scramble());
        break;
      }
      case 'sort': {
        const at = firstOf(ex.categories, (c) => c.block);
        if (at !== undefined) groupStart.set(at, () => this.sort());
        break;
      }
      case 'wordsearch': case 'crossword': case 'arithmetic': {
        const items = ex.kind === 'arithmetic' ? ex.operations.map((o) => o.block) : ex.entries.map((e) => e.block);
        if (items[0] !== undefined) groupStart.set(items[0], () => this.grid());
        break;
      }
      default:
        break;
    }
    // The exercise's own paragraphs, a run at a time, in its text style
    // (never indented); not inside a container the author opened.
    let text: ContentBlock[] = [];
    let depth = 0;
    const flush = (): void => {
      if (text.length === 0) return;
      const g = this.open('paragraphs', { style: this.ids.text });
      out.push(g.start, ...text, g.end);
      text = [];
    };
    for (const k of ex.body) {
      if (done.has(k)) continue;
      const group = groupStart.get(k);
      if (group) {
        flush();
        out.push(...group());
        continue;
      }
      if (ex.items.has(k)) continue;
      const b = this.blocks[k]!;
      if (b.type === 'containerStart') depth++;
      if (b.type === 'containerEnd') depth--;
      const set = this.passThrough(b, k);
      if (depth === 0 && set.type === 'paragraph') { text.push(set); continue; }
      flush();
      out.push(set);
      // An open question: lines under each item of the list.
      if (ex.kind === 'open' && b.type === 'listItem' && (b.depth ?? 1) <= 1) {
        out.push(...this.area(this.openLines(), `t${lists.indexOf(k) + 1}`, this.openAnswer(lists.indexOf(k))));
      }
    }
    flush();
    if (ex.kind === 'open' && lists.length === 0) out.push(...this.area(this.openLines(), 't1', this.openAnswer(0)));
    if (ex.kind === 'gaps' || ex.kind === 'choice' || ex.kind === 'mark') this.keyOfGaps();
    return out;
  }

  private openLines(): number {
    const n = parseInt(this.ex.attrs.lines ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : this.style.area.lines;
  }

  /** The model answer of an open question, cut into the lines a teacher's
   *  edition writes it on (only the first solution's first paragraph). */
  private openAnswer(k: number): string[] | undefined {
    const sol = this.ex.solutions[0];
    if (!sol) return undefined;
    const paras: string[] = [];
    for (let j = sol.start + 1; j < sol.end; j++) {
      const b = this.blocks[j]!;
      if (b.type === 'paragraph' || b.type === 'listItem') paras.push(plain(runOf(b)));
    }
    const text = paras[k] ?? (k === 0 ? paras[0] : undefined);
    return text ? [text] : undefined;
  }

  /** A block of the body with its answers set. */
  private passThrough(b: ContentBlock, k: number): ContentBlock {
    // A question's stem ends in a bracket to write the letter in (Chinese
    // and Japanese tests), its answer written in a teacher's edition.
    const qi = this.style.options.bracket ? this.ex.questions.findIndex((q) => q.stem === k) : -1;
    if (!b.spans.some((s) => s.chip?.gap) && qi < 0) return b;
    let run = this.gapsOf(runOf(b));
    if (qi >= 0) {
      const at = b.sourceEnd;
      const answer = this.bracketAnswer(qi);
      run = joinRuns(run, textRun('\uFF08', at), chipRun(this.teacher ? this.ids.answer : this.ids.icon, textRun(this.teacher ? answer : '\u2003\u2003', at), at, {
        ...(this.teacher ? {} : { blank: true as const, blankLabel: this.book.words.blank }), exercise: { ex: this.ex.id, slot: `q${qi + 1}b` },
      }), textRun('\uFF09', at));
    }
    return { ...b, text: run.text, spans: run.spans, sourceMap: run.sourceMap };
  }

  /** The labels of a question's right options, as its bracket holds them. */
  private bracketAnswer(qi: number): string {
    const q = this.ex.questions[qi]!;
    return q.options.flatMap((o, k) => (o.correct ? [this.label(k).replace(/[).\uFF0E\u3001]$/u, '')] : [])).join('');
  }

  // --- Answers in the text -----------------------------------------------------

  private longestAnswer(): string {
    let best = '';
    for (const g of this.ex.gaps) {
      if (g.gap.choice) continue;
      const t = g.gap.texts[g.gap.correct[0] ?? 0] ?? '';
      if (t.length > best.length) best = t;
    }
    return best;
  }

  /** `run` with each `[[…]]` set: a blank, an inline choice or a word to
   *  mark. */
  private gapsOf(run: Run): Run {
    if (!run.spans.some((s) => s.chip?.gap)) return run;
    const pieces: Run[] = [];
    let at = 0;
    for (const span of run.spans) {
      const len = span.text.length;
      const piece = sliceRun(run, at, at + len);
      const src = run.sourceMap[at] ?? this.at;
      at += len;
      const gap = span.chip?.gap;
      if (!gap) { pieces.push(piece); continue; }
      const ref = this.ex.gaps.find((g) => g.gap === gap);
      const n = ref?.n ?? 0;
      pieces.push(this.ex.kind === 'mark' ? this.markRun(gap, n, src) : gap.choice ? this.choiceRun(gap, n, src) : this.blankRun(gap, n, src, span.bold, span.italic));
    }
    return joinRuns(...pieces);
  }

  private blankRun(gap: ExerciseGap, n: number, at: number, bold: boolean, italic: boolean): Run {
    const answer: Run = { text: gap.texts[gap.correct[0] ?? 0] ?? '', spans: gap.options[gap.correct[0] ?? 0] ?? [], sourceMap: [] };
    const width = this.style.blank.width;
    // Room past the answer: em spaces as many as `extra` holds ems.
    const extra = '\u2003'.repeat(Math.max(0, Math.round(dimPt(this.style.blank.extra, this.ctx.bodySizePt) / this.ctx.bodySizePt)));
    const widthText = width === 'longest' ? this.longestAnswer() + extra : width === 'answer' ? answer.text + extra : undefined;
    const words = answer.spans.length > 0 ? answer : textRun(answer.text || '\u2002', at);
    const slot = `g${n}`;
    this.slots.push({ key: slot, kind: 'gap', accept: gap.texts.filter((_, k) => gap.correct.includes(k)) });
    this.bankWords.push(textRun(answer.text, at));
    const run = chipRun(this.teacher ? this.ids.blankAnswer : this.ids.blank, words, at, {
      ...(widthText ? { widthText } : {}),
      ...(this.teacher ? {} : { blank: true as const, blankLabel: this.book.words.blank }),
      exercise: { ex: this.ex.id, slot },
    });
    run.spans[0] = { ...run.spans[0]!, bold, italic };
    return run;
  }

  private choiceRun(gap: ExerciseGap, n: number, at: number): Run {
    const parts: Run[] = [textRun('(', at)];
    gap.options.forEach((opt, k) => {
      if (k > 0) parts.push(textRun(' / ', at));
      const right = gap.correct.includes(k);
      const words: Run = { text: gap.texts[k] ?? '', spans: opt.length > 0 ? opt : [{ text: gap.texts[k] || '\u2002', bold: false, italic: false }], sourceMap: [] };
      parts.push(chipRun(this.teacher && right ? this.ids.choiceRing : this.ids.choice, words, at, { exercise: { ex: this.ex.id, slot: `g${n}o${k + 1}` } }));
    });
    parts.push(textRun(')', at));
    this.slots.push({ key: `g${n}`, kind: 'choice', options: gap.options.length, correct: gap.correct.map((k) => k + 1), multiple: false });
    return joinRuns(...parts);
  }

  private markRun(gap: ExerciseGap, n: number, at: number): Run {
    const words: Run = { text: gap.texts[0] ?? '', spans: gap.options[0] ?? [], sourceMap: [] };
    this.slots.push({ key: `m${n}`, kind: 'mark', correct: [1] });
    return chipRun(this.teacher ? this.ids.markOn : this.ids.mark, words.spans.length > 0 ? words : textRun(words.text, at), at, { exercise: { ex: this.ex.id, slot: `m${n}` } });
  }

  private keyOfGaps(): void {
    for (const g of this.ex.gaps) {
      const answer = g.gap.correct.map((k) => g.gap.texts[k] ?? '').filter(Boolean)[0] ?? '';
      if (answer) this.key.push(textRun(this.ex.gaps.length > 1 ? `${g.n} ${answer}` : answer, this.at));
    }
  }

  /** The word bank: the blanks' answers and the distractors of `::bank`
   *  lines, in a box. */
  private bank(): ContentBlock[] {
    const words: Run[] = this.ex.kind === 'sort'
      ? this.ex.categories.flatMap((c) => c.items)
      : [...this.bankWords.filter((w) => w.text !== '')];
    for (const k of this.ex.banks) {
      const b = this.blocks[k]!;
      if (b.text.trim()) {
        const run = runOf(b);
        let last = 0;
        for (let j = 0; j <= run.text.length; j++) {
          if (j === run.text.length || run.text[j] === '|') {
            const w = trimRun(sliceRun(run, last, j));
            if (w.text) words.push(w);
            last = j + 1;
          }
        }
      }
    }
    // The answers of a gaps exercise are known only once the body is set.
    if (words.length === 0 && this.ex.kind !== 'sort') {
      for (const g of this.ex.gaps) if (!g.gap.choice) words.push(textRun(g.gap.texts[g.gap.correct[0] ?? 0] ?? '', this.at));
    }
    const order = this.style.bank.order === 'written'
      ? words.map((_, k) => k)
      : this.style.bank.order === 'alpha'
        ? words.map((_, k) => k).sort((a, b) => words[a]!.text.localeCompare(words[b]!.text, this.ctx.locale))
        : shuffledOrder(words.length, seededRandom(this.book.seed, this.ex.ordinal, 'bank'));
    const parts: Run[] = [];
    order.forEach((k, j) => {
      if (j > 0) parts.push(textRun(this.style.bank.separator, this.at));
      const slot = this.ex.kind === 'sort' ? { exercise: { ex: this.ex.id, slot: `s${k + 1}` } } : {};
      parts.push(chipRun(this.ids.word, words[k]!, words[k]!.sourceMap[0] ?? this.at, slot));
    });
    if (parts.length === 0) return [];
    const boxId = this.style.bank.box && this.ctx.boxIds.has(this.style.bank.box) ? this.style.bank.box : this.ids.bankBox;
    const g = this.open('callout', { type: boxId });
    return [g.start, ...this.paragraphs(this.ids.text, [joinRuns(...parts)]), g.end];
  }

  // --- Choice and true/false ---------------------------------------------------

  private optionText(block: number): Run {
    return this.gapsOf(trimRun(runOf(this.blocks[block]!)));
  }

  private options(qi: number): ContentBlock[] {
    const q = this.ex.questions[qi]!;
    const o = this.style.options;
    const order = o.shuffle ? shuffledOrder(q.options.length, seededRandom(this.book.seed, this.ex.ordinal, 'q', qi), false) : q.options.map((_, k) => k);
    const group = `q${qi + 1}`;
    this.slots.push({ key: group, kind: 'choice', options: q.options.length, correct: order.flatMap((k, pos) => (q.options[k]!.correct ? [pos + 1] : [])), multiple: q.multiple });
    const items: Run[] = order.map((k, pos) => {
      const opt = q.options[k]!;
      const at = this.blocks[opt.block]!.sourceStart;
      const label = this.label(pos);
      const parts: Run[] = [];
      const slot = { exercise: { ex: this.ex.id, slot: `${group}o${pos + 1}` } };
      if (o.marker !== 'none') {
        parts.push(chipRun(this.teacher && opt.correct ? this.ids.tickOn : this.ids.tick, textRun('\u2002', at), at, slot));
        parts.push(textRun(SPACE, at));
      }
      if (label) {
        const labelRun = textRun(label, at);
        parts.push(o.marker === 'none' ? chipRun(this.teacher && opt.correct ? this.ids.choiceRing : this.ids.choice, labelRun, at, slot) : labelRun);
      }
      if (parts.length > 0) parts.push(tabRun(at));
      parts.push(this.optionText(opt.block));
      return joinRuns(...parts);
    });
    const rightLabels = order.flatMap((k, pos) => (q.options[k]!.correct ? [this.bareLabel(pos) || plain(this.optionText(q.options[k]!.block))] : []));
    this.key.push(textRun(`${this.ex.questions.length > 1 ? `${qi + 1} ` : ''}${rightLabels.join(', ')}`, this.at));
    // The stem's bracket to write the letter in (Chinese and Japanese tests).
    const blocks: ContentBlock[] = [];
    // The stem, numbered as the questions are counted.
    if (q.stem !== undefined) {
      const stem = this.passThrough(this.blocks[q.stem]!, q.stem);
      const at = stem.sourceStart;
      const n = this.ex.questions.filter((x) => x.stem !== undefined).indexOf(q) + 1;
      blocks.push(...this.paragraphs(this.ids.item, [joinRuns(textRun(`${n}.`, at, { bold: true }), tabRun(at), runOf(stem))]));
    }
    const optionStyle = q.stem !== undefined ? this.ids.optionUnder : this.ids.option;
    if (o.layout === 'row') {
      const per = o.columns ?? items.length;
      const rows: Run[] = [];
      for (let k = 0; k < items.length; k += per) {
        rows.push(joinRuns(...items.slice(k, k + per).flatMap((r, j) => (j > 0 ? [tabRun(this.at), r] : [r]))));
      }
      blocks.push(...this.paragraphs(this.ids.row, rows));
    } else {
      blocks.push(...this.paragraphs(optionStyle, items));
    }
    return blocks;
  }

  private statements(): ContentBlock[] {
    const [t, f] = this.style.trueFalse.labels;
    const runs: Run[] = [];
    this.ex.questions.forEach((q, k) => {
      const opt = q.options[0]!;
      const at = this.blocks[opt.block]!.sourceStart;
      const slot = `tf${k + 1}`;
      this.slots.push({ key: slot, kind: 'truefalse', correct: [opt.correct ? 1 : 2] });
      const parts: Run[] = [textRun(`${k + 1}.`, at), tabRun(at), this.optionText(opt.block), tabRun(at)];
      if (this.style.trueFalse.look === 'bracket') {
        const answer = textRun(opt.correct ? t : f, at);
        parts.push(chipRun(this.teacher ? this.ids.blankAnswer : this.ids.blank, answer, at, {
          widthText: `${t.length > f.length ? t : f}\u2003\u2003`, ...(this.teacher ? {} : { blank: true as const, blankLabel: this.book.words.blank }), exercise: { ex: this.ex.id, slot },
        }));
      } else {
        parts.push(textRun(`${t}\u2009`, at), chipRun(this.teacher && opt.correct ? this.ids.tickOn : this.ids.tick, textRun('\u2002', at), at, { exercise: { ex: this.ex.id, slot: `${slot}t` } }));
        parts.push(textRun(`\u2003${f}\u2009`, at), chipRun(this.teacher && !opt.correct ? this.ids.tickOn : this.ids.tick, textRun('\u2002', at), at, { exercise: { ex: this.ex.id, slot: `${slot}f` } }));
      }
      runs.push(joinRuns(...parts));
      this.key.push(textRun(`${k + 1} ${opt.correct ? t : f}`, this.at));
    });
    return this.paragraphs(this.ids.statement, runs);
  }

  // --- Match, order, scramble, sort -------------------------------------------

  private match(): ContentBlock[] {
    const pairs = this.ex.pairs;
    const lefts = pairs.filter((p) => p.left.text !== '');
    const rights = pairs.map((p) => p.right);
    const order = this.ex.attrs.shuffle === 'false' ? rights.map((_, k) => k) : shuffledOrder(rights.length, seededRandom(this.book.seed, this.ex.ordinal, 'match'));
    // Position of each pair's right item in the printed column.
    const posOf = new Map<number, number>();
    order.forEach((k, pos) => posOf.set(k, pos));
    lefts.forEach((p, i) => {
      const pos = posOf.get(pairs.indexOf(p))!;
      this.slots.push({ key: `p${i + 1}`, kind: 'pair', correct: [pos + 1] });
      this.key.push(this.style.match.look === 'dots'
        ? joinRuns(this.gapsOf(p.left), textRun(' \u2013 ', this.at), this.gapsOf(p.right))
        : textRun(`${i + 1} ${this.bareLabel(pos) || String(pos + 1)}`, this.at));
    });
    if (this.style.match.look === 'dots') {
      return this.drawnGrid(gridBox({
        kind: 'match', id: `${this.ids.frame}-match-${this.ex.ordinal}`, style: this.style,
        left: lefts.map((p) => plain(this.gapsOf(p.left))), right: order.map((k) => plain(this.gapsOf(rights[k]!))),
        links: this.teacher ? lefts.map((p) => posOf.get(pairs.indexOf(p))!) : undefined,
        bodySizePt: this.ctx.bodySizePt, lineHeightPt: this.ctx.lineHeightPt, measurePt: this.ctx.measurePt, labels: order.map((_, pos) => this.label(pos)),
        ...(this.ctx.bodyFont ? { font: this.ctx.bodyFont } : {}),
      }));
    }
    const rows = Math.max(lefts.length, order.length);
    const runs: Run[] = [];
    for (let i = 0; i < rows; i++) {
      const parts: Run[] = [];
      const p = lefts[i];
      if (p) {
        const pos = posOf.get(pairs.indexOf(p))!;
        parts.push(textRun(`${i + 1}. `, this.at), this.gapsOf(p.left), textRun(' ', this.at));
        parts.push(chipRun(this.teacher ? this.ids.blankAnswer : this.ids.blank, textRun(this.label(pos) || String(pos + 1), this.at), this.at, {
          widthText: '\u2003\u2003', ...(this.teacher ? {} : { blank: true as const, blankLabel: this.book.words.blank }), exercise: { ex: this.ex.id, slot: `p${i + 1}` },
        }));
      }
      parts.push(tabRun(this.at));
      const k = order[i];
      if (k !== undefined) parts.push(textRun(`${this.label(i) || String(i + 1)} `, this.at), this.gapsOf(rights[k]!));
      runs.push(joinRuns(...parts));
    }
    return this.paragraphs(this.ids.pairs, runs);
  }

  private order(): ContentBlock[] {
    const seq = this.ex.sequence;
    const order = this.ex.attrs.shuffle === 'false' ? seq.map((_, k) => k) : shuffledOrder(seq.length, seededRandom(this.book.seed, this.ex.ordinal, 'order'));
    const runs = order.map((k, pos) => {
      const at = this.blocks[seq[k]!]!.sourceStart;
      const slot = `o${pos + 1}`;
      this.slots.push({ key: slot, kind: 'rank', accept: [String(k + 1)] });
      return joinRuns(
        chipRun(this.teacher ? this.ids.rankAnswer : this.ids.rank, textRun(String(k + 1), at), at, {
          ...(this.teacher ? {} : { blank: true as const, blankLabel: this.book.words.blank }), exercise: { ex: this.ex.id, slot },
        }),
        tabRun(at),
        this.optionText(seq[k]!),
      );
    });
    this.key.push(textRun(order.map((k) => String(k + 1)).join(' · '), this.at));
    return this.paragraphs(this.ids.item, runs);
  }

  private scramble(): ContentBlock[] {
    const out: ContentBlock[] = [];
    this.ex.sentences.forEach((s, k) => {
      const at = this.blocks[s.block]!.sourceStart;
      const order = shuffledOrder(s.pieces.length, seededRandom(this.book.seed, this.ex.ordinal, 'scramble', k));
      const words = order.flatMap((j, pos) => (pos > 0 ? [textRun(' / ', at), s.pieces[j]!] : [s.pieces[j]!]));
      out.push(...this.paragraphs(this.ids.item, [joinRuns(textRun(`${k + 1}.`, at), tabRun(at), ...words)]));
      const sentence = s.pieces.map((p) => plain(p)).join(' ');
      out.push(...this.area(1, `sc${k + 1}`, [sentence], this.style.area.kind === 'none' ? 'lines' : this.style.area.kind));
      this.key.push(textRun(`${k + 1} ${sentence}`, at));
    });
    return out;
  }

  private sort(): ContentBlock[] {
    const cats = this.ex.categories;
    const rows = Math.max(1, ...cats.map((c) => c.items.length));
    const out: ContentBlock[] = [];
    const count = Math.min(cats.length, 4);
    const cols = this.open('columns', { count: String(count) });
    // A sub-column's width: the gap between two is a line of text.
    const colWidth = (this.ctx.measurePt - (count - 1) * this.ctx.lineHeightPt) / count;
    out.push(cols.start);
    cats.forEach((c, ci) => {
      out.push(...this.paragraphs(this.ids.instruction, [{ ...c.name, spans: c.name.spans.map((s) => ({ ...s, bold: true })) }]));
      out.push(...this.area(rows, `c${ci + 1}`, c.items.map((it) => plain(it)), 'lines', colWidth));
      this.key.push(joinRuns(textRun(`${plain(c.name)}: `, this.at), textRun(c.items.map((it) => plain(it)).join(', '), this.at)));
    });
    out.push(cols.end);
    // The words to sort: which category each answers.
    let w = 0;
    for (const c of cats) for (const _ of c.items) { w++; this.slots.push({ key: `s${w}`, kind: 'category', accept: [plain(c.name)] }); }
    return out;
  }

  private grid(): ContentBlock[] {
    const ex = this.ex;
    const box = gridBox({
      kind: ex.kind as 'wordsearch' | 'crossword' | 'arithmetic', id: `${this.ids.frame}-grid-${ex.ordinal}`, style: this.style, exercise: ex,
      blocks: this.blocks, seed: this.book.seed, teacher: this.teacher, bodySizePt: this.ctx.bodySizePt, lineHeightPt: this.ctx.lineHeightPt, measurePt: this.ctx.measurePt,
      words: { across: this.book.words.across, down: this.book.words.down },
      ...(this.ctx.bodyFont ? { font: this.ctx.bodyFont } : {}),
    });
    const out = this.drawnGrid(box);
    if (box.key) this.key.push(...box.key.map((k) => textRun(k, this.at)));
    for (const w of box.unplaced ?? []) this.unplaced.push(w);
    if (box.clues && box.clues.length > 0) {
      out.push(...this.paragraphs(this.ids.key, box.clues.map((c) => (c.heading
        ? textRun(c.label, this.at, { bold: true })
        : joinRuns(textRun(c.label, this.at, { bold: true }), tabRun(this.at), c.clue ? this.gapsOf(c.clue) : EMPTY_RUN)))));
    }
    if (box.words && box.words.length > 0 && ex.attrs.hidden === undefined) {
      out.push(...this.paragraphs(this.ids.row, [joinRuns(...box.words.flatMap((w, k) => (k > 0 ? [textRun('\u2003', this.at), textRun(w, this.at)] : [textRun(w, this.at)])))]));
    }
    return out;
  }

  // --- Solutions --------------------------------------------------------------

  /** The solution as paragraphs: the number and the key, then (in the
   *  full layout) the worked solution's blocks. `listed`: among others at
   *  the end of a chapter. */
  solutionBlocks(listed: boolean): ContentBlock[] {
    if (this.key.length === 0) this.exerciseBlocks();
    const sol = solutionsOf(this.style, this.book);
    const lead = listed && this.number ? [textRun(`${this.number}${this.style.number.suffix || '.'}`, this.at, { bold: true }), tabRun(this.at)] : [];
    const keyRun = this.key.length > 0 ? joinRuns(...this.key.flatMap((r, k) => (k > 0 ? [textRun(' · ', this.at), r] : [r]))) : EMPTY_RUN;
    const out: ContentBlock[] = [];
    const worked: ContentBlock[] = [];
    if (sol.layout === 'full') {
      for (const s of this.ex.solutions) for (let j = s.start + 1; j < s.end; j++) worked.push(this.blocks[j]!);
    }
    // A worked solution's first paragraph goes on the number's line when
    // there is no key (an open question).
    if (!keyRun.text && worked[0]?.type === 'paragraph') {
      const first = worked.shift()!;
      out.push(...this.paragraphs(this.ids.key, [joinRuns(...lead, runOf(first))]));
    } else if (keyRun.text || lead.length > 0) {
      out.push(...this.paragraphs(this.ids.key, [joinRuns(...lead, keyRun)]));
    }
    const paras: ContentBlock[] = [];
    const flush = (): void => {
      if (paras.length > 0) out.push(...this.paragraphs(listed ? this.ids.key : this.ids.text, paras.splice(0).map((b) => listed ? joinRuns(tabRun(b.sourceStart), runOf(b)) : runOf(b))));
    };
    for (const b of worked) {
      if (b.type === 'paragraph') { paras.push(b); continue; }
      flush();
      out.push(b);
    }
    flush();
    return out;
  }

  /** The solution in a box after the exercise, turned upside down when
   *  `inverted`. */
  solutionBox(inverted: boolean): ContentBlock[] {
    const blocks = this.solutionBlocks(false);
    if (blocks.length === 0) return [];
    const sol = solutionsOf(this.style, this.book);
    const box = sol.box && this.ctx.boxIds.has(sol.box) ? sol.box : this.ids.solutionBox;
    const g = this.open('callout', { type: box, ...(inverted ? { turn: '180' } : {}) });
    return [g.start, ...blocks, g.end];
  }

  /** What the digital outputs need. */
  record(): ExerciseRecord {
    const sol = this.ex.solutions.flatMap((s) => {
      const out: string[] = [];
      for (let j = s.start + 1; j < s.end; j++) {
        const b = this.blocks[j]!;
        if (b.type === 'paragraph' || b.type === 'listItem') out.push(plain(runOf(b)));
      }
      return out;
    });
    const hints = this.ex.hints.flatMap((h) => {
      const out: string[] = [];
      for (let j = h.start + 1; j < h.end; j++) {
        const b = this.blocks[j]!;
        if (b.type === 'paragraph' || b.type === 'listItem') out.push(plain(runOf(b)));
      }
      return out;
    });
    return {
      id: this.ex.id,
      ordinal: this.ex.ordinal,
      number: this.number,
      kind: this.ex.kind,
      style: this.style.id,
      slots: this.slots,
      key: this.key.map((r) => plain(r)).join(' · '),
      ...(sol.length > 0 ? { solution: sol } : {}),
      ...(hints.length > 0 ? { hints } : {}),
      ...(this.ex.attrs.id ? { anchor: this.ex.attrs.id } : {}),
      ...(this.grids.length > 0 ? { grids: this.grids } : {}),
    };
  }
}

/** A length in points, `em` read against `sizePt`. */
export function dimPt(d: { value: number; unit: string }, sizePt: number): number {
  switch (d.unit) {
    case 'pt': return d.value;
    case 'mm': return (d.value / 25.4) * 72;
    case 'cm': return (d.value / 2.54) * 72;
    case 'in': return d.value * 72;
    case 'px': return d.value * 0.75;
    default: return d.value * sizePt;
  }
}
