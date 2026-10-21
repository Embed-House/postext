// The overlap checks of composed pages in the Sandbox (#1066), on the
// engine's overlap fixture (#1053) laid out by the engine: a caption under
// a picture frame on a higher layer, a tab under a cut-out photo, a note
// anchored inside a card that runs past its foot, a strap of text below the
// trim. The Checks panel lists each by page, frame and language, words it
// in the reader's language, draws the overlap on the canvas, and its
// fixes are one click each: carried out, the check is gone.

// @ts-expect-error -- a Node built-in: the package compiles without @types/node.
import { readFileSync as readFile } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { PostextConfig, Resource, VDTDocument } from 'postext';
import { sandboxReducer, type SandboxAction, type SandboxState } from '../context/SandboxContext.js';
import { composeBook } from '../book/compose.js';
import { resetViewerEdits } from '../editor/viewerEdits.js';
import { createSandboxHistory, setActiveHistory } from '../history/sandboxHistory.js';
import { state as baseState } from '../webmcp/tools/testHarness.js';
import { DEFAULT_LABELS, type SandboxLabels } from '../types/index.js';
import { detailFor, titleFor } from '../sidebar/WarningsPanel.js';
import { computeComposedWarnings } from './compute.js';
import { composedChecksOf, jumpFor } from './composedChecks.js';
import { warningCategory } from './categories.js';
import { getAtPointer, planIsAdvice, planProposal, proposalContextOf, proposalsOf } from './proposalActions.js';
import { proposalQuestion, proposalText, runProposal } from './ProposalButtons.js';
import { overlapMarksFor } from '../viewport/composed/overlapMarks.js';
import { documentReflow } from '../viewport/composed/reflowText.js';
import { frameFixChecks } from '../viewport/composed/ReflowPanel.js';
import { overlapFocusNow, overlapFocusOf, setOverlapFocus } from '../editions/overlapFocus.js';
import type { Warning } from './types.js';

// Every glyph the same width: the layout is the same on every machine.
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return { font: '', measureText: (s: string) => ({ width: s.length * 7 }) };
  }
};

const readFileSync = readFile as (path: URL, encoding: 'utf8') => string;
const DIR = new URL('../../../postext/src/__tests__/composed/fixtures/overlap/', import.meta.url);
const CONFIG = JSON.parse(readFileSync(new URL('config.json', DIR), 'utf8')) as PostextConfig;
const MARKDOWN = readFileSync(new URL('overlap.md', DIR), 'utf8');
const RESOURCES: Resource[] = ([['chart', 1200, 600], ['photo', 900, 600], ['cutout', 720, 720]] as const).map(([id, width, height]) => ({
  id,
  typeId: 'pic',
  kind: 'bitmap' as const,
  caption: '',
  createdAt: 0,
  updatedAt: 0,
  bitmap: { fileId: `${id}.png`, format: 'png', width, height, resolution: 300 },
})) as Resource[];

const LOCALES = ['en', 'es', 'ca', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ar'] as const;
const messages = new Map<string, Record<string, string>>();
beforeAll(async () => {
  for (const l of LOCALES) {
    const m = (await import(/* @vite-ignore */ new URL(`../../../../apps/web/messages/${l}.json`, import.meta.url).href)) as { default?: { Sandbox: Record<string, string> }; Sandbox?: Record<string, string> };
    messages.set(l, (m.default ?? m).Sandbox!);
  }
});
afterEach(() => {
  setActiveHistory(null);
  resetViewerEdits();
  setOverlapFocus(null);
});

function labelsOf(locale: string): SandboxLabels {
  return { ...DEFAULT_LABELS, ...messages.get(locale) } as SandboxLabels;
}

/** A one-chapter book of the fixture, the Sandbox's store over the reducer
 *  with its history. */
function setUp(markdown = MARKDOWN, config: PostextConfig = structuredClone(CONFIG)) {
  const chapters = [{ id: 'ov', title: 'Overlaps', markdown, createdAt: 1, updatedAt: 1 }];
  let current: SandboxState = { ...baseState(), chapters, activeChapterId: 'ov', markdown, config, resources: RESOURCES };
  const history = createSandboxHistory({
    dispatch: (a: SandboxAction) => { current = sandboxReducer(current, a); },
    getState: () => current,
    editorStates: (() => { const m = new Map<string, unknown>(); return () => m; })(),
  });
  setActiveHistory(history);
  const layout = () => {
    const book = composeBook(current.chapters);
    const doc: VDTDocument = buildDocument({ markdown: book.markdown, resources: current.resources }, current.config, createMeasurementCache());
    const warnings = computeComposedWarnings({ markdown: book.markdown, config: current.config, doc, resources: current.resources, book });
    return { doc, warnings };
  };
  return { history, layout, get: () => current };
}

const mm = (value: number) => ({ value, unit: 'mm' as const });
/** Body text under a photo on a higher layer, with nothing opaque under the
 *  text: the check proposes painting the photo under it and making it push
 *  the lines round it (as the engine's own test of the two fixes). */
const textUnderPhoto = (): [string, PostextConfig] => [
  `::::page{template="overlaps"}\n:::frame{slot="text"}\n${'The mill keeps a record of each season. '.repeat(30)}\n:::\n\n::resource{id="photo" slot="photo"}\n::::\n`,
  {
    ...structuredClone(CONFIG),
    pageTemplates: [{
      id: 'overlaps',
      frames: [
        { name: 'text', width: mm(120), placement: { anchor: { to: 'container', edge: 'top-left' } } },
        { name: 'photo', layer: 2, width: mm(40), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(30), y: mm(2) } } },
      ],
    }],
  },
];

const covered = (ws: readonly Warning[], frame: string) => ws.find((w) => w.payload.kind === 'frameCovered' && w.payload.frame === frame);
const outside = (ws: readonly Warning[], frame: string) => ws.find((w) => w.payload.kind === 'frameOutsideArea' && w.payload.frame === frame);

describe('the overlap checks in the Checks panel (#1066)', () => {
  it('lists both kinds with their data, on their page and frame, filed with the typesetting', () => {
    const { layout } = setUp();
    const { doc, warnings } = layout();
    const figure = covered(warnings, 'figure');
    const card = covered(warnings, 'card');
    const note = outside(warnings, 'note');
    const strap = outside(warnings, 'strap');
    expect(figure?.payload).toMatchObject({ kind: 'frameCovered', template: 'overlaps', coveredBy: 'photo', page: 1, fenceIndex: 0 });
    expect(card?.payload).toMatchObject({ kind: 'frameCovered', coveredBy: 'cutout' });
    expect(note?.payload).toMatchObject({ kind: 'frameOutsideArea', past: 'frame', target: 'card' });
    expect(strap?.payload).toMatchObject({ kind: 'frameOutsideArea', past: 'trim' });
    expect(warningCategory('frameCovered')).toBe('typesetting');
    expect(warningCategory('frameOutsideArea')).toBe('typesetting');
    const checks = composedChecksOf('en', [{ index: 0, doc, warnings }]);
    const placed = checks.filter((c) => c.warning.payload.kind === 'frameCovered' || c.warning.payload.kind === 'frameOutsideArea');
    expect(placed.map((c) => [c.frame, c.page, c.template, c.frameId]).sort()).toEqual([
      ['card', 1, 'overlaps', 'cp0:card'],
      ['figure', 1, 'overlaps', 'cp0:figure'],
      ['note', 1, 'overlaps', 'cp0:note'],
      ['strap', 1, 'overlaps', 'cp0:strap'],
    ]);
    // The jump carries what the canvas draws once there.
    expect(jumpFor(placed.find((c) => c.frame === 'figure')!).overlap).toEqual({ kind: 'covered', frame: 'figure', coveredBy: 'photo' });
    expect(jumpFor(placed.find((c) => c.frame === 'strap')!).overlap).toMatchObject({ kind: 'outside', frame: 'strap', past: 'trim' });
  });

  for (const locale of LOCALES) {
    it(`${locale}: words the titles, details and fixes in the reader's language`, () => {
      const { layout } = setUp();
      const { warnings } = layout();
      const labels = labelsOf(locale);
      for (const w of [covered(warnings, 'figure')!, outside(warnings, 'note')!, outside(warnings, 'strap')!]) {
        const title = titleFor(w.payload, labels);
        const detail = detailFor(w.payload, labels, locale);
        expect(title).toBe(w.payload.kind === 'frameCovered' ? labels.warningsFrameCoveredTitle : labels.warningsFrameOutsideTitle);
        expect(detail).not.toMatch(/__\w+__/);
        if (locale !== 'en') {
          // No English from the engine in another language's panel.
          expect(detail).not.toMatch(/\b(lies under|runs|past the|to uncover it|to bring it in)\b/);
          for (const p of proposalsOf(w)) expect(proposalText(p, w, labels, locale)).not.toBe(proposalText(p, w, DEFAULT_LABELS, 'en'));
        }
      }
    });
  }

  it('words the caption under the photo with the covered words and the fixes', () => {
    const { layout } = setUp();
    const w = covered(layout().warnings, 'figure')!;
    const detail = detailFor(w.payload, DEFAULT_LABELS, 'en');
    // Every move off the caption takes the photo out of the figure it is
    // anchored inside (#1075): no fix but `overlap: 'allow'`.
    expect(detail).toMatch(/^figure \(en\) — page 1 · “Rainfall[^”]*” lies under photo, which is painted over it: [\d.,]+ mm² hidden \(template overlaps\)\. If the frames are meant to sit so, set overlap to allow\.$/);
  });

  it('words a grid given more items than it holds', () => {
    const p = { kind: 'repeatOverflow', template: 'cards', group: 'grid', frame: 'card', item: 4, max: 3, flowFrame: 'main', fenceIndex: 0 } as const;
    expect(titleFor(p, DEFAULT_LABELS)).toBe('More items than the grid holds');
    expect(detailFor(p, DEFAULT_LABELS)).toBe('card[4] — Grid grid of template cards holds 3 items: item 4 goes to the flow frame main. Raise repeat.max, or move the item to another page.');
    expect(detailFor({ ...p, flowFrame: undefined }, labelsOf('es'))).toContain('se compone después de la página');
  });
});

describe('the overlap on the canvas (#1066)', () => {
  it('a covered frame: both frames and the rectangle where they meet', () => {
    const { layout } = setUp();
    const { doc, warnings } = layout();
    const page = doc.pages.find((p) => p.composed)!;
    const focus = overlapFocusOf(covered(warnings, 'figure')!.payload)!;
    const marks = overlapMarksFor(doc, page, focus)!;
    const figure = page.composed!.frames.find((f) => f.name === 'figure')!.rect;
    const photo = page.composed!.frames.find((f) => f.name === 'photo')!.rect;
    expect(marks.frame).toEqual(figure);
    expect(marks.covering).toEqual(photo);
    expect(marks.hits).toHaveLength(1);
    const hit = marks.hits[0]!;
    expect(hit.x).toBeCloseTo(Math.max(figure.x, photo.x), 6);
    expect(hit.y).toBeCloseTo(Math.max(figure.y, photo.y), 6);
    expect(hit.x + hit.width).toBeCloseTo(Math.min(figure.x + figure.width, photo.x + photo.width), 6);
  });

  it('a frame past its edge: the box it runs past and a band as deep as the overrun', () => {
    const { layout } = setUp();
    const { doc, warnings } = layout();
    const page = doc.pages.find((p) => p.composed)!;
    const px = doc.config.page.dpi / 25.4;
    const note = outside(warnings, 'note')!;
    const marks = overlapMarksFor(doc, page, overlapFocusOf(note.payload)!)!;
    const card = page.composed!.frames.find((f) => f.name === 'card')!.rect;
    expect(marks.limit).toEqual(card);
    const sides = (note.payload as { sides: { bottom?: number } }).sides;
    expect(sides.bottom).toBeGreaterThan(0);
    const band = marks.hits[0]!;
    expect(band.y).toBeCloseTo(card.y + card.height, 6);
    expect(band.height).toBeCloseTo(sides.bottom! * px, 6);
    // The strap: against the trim.
    const strap = overlapMarksFor(doc, page, overlapFocusOf(outside(warnings, 'strap')!.payload)!)!;
    expect(strap.limit).toEqual({ x: doc.trimOffset, y: doc.trimOffset, width: page.width - 2 * doc.trimOffset, height: page.height - 2 * doc.trimOffset });
    expect(strap.hits.length).toBeGreaterThan(0);
    // A page without the frames draws nothing.
    expect(overlapMarksFor(doc, page, { kind: 'covered', frame: 'nowhere', coveredBy: 'photo' })).toBeNull();
  });
});

describe('the Reflow panel on the overlap fixture (#1066)', () => {
  it('words the covered and outside events in each language and offers the fixes under each frame', () => {
    const { layout } = setUp();
    const { doc, warnings } = layout();
    const [page] = documentReflow(doc, DEFAULT_LABELS, 'en');
    const lines = Object.fromEntries(page!.entries.map((e) => [e.frame, e.lines]));
    expect(lines.figure).toEqual([expect.stringMatching(/^figure lies under photo \([\d.,]+ mm²\)$/)]);
    expect(lines.note).toEqual([expect.stringMatching(/^note runs [\d.]+ mm past card$/)]);
    expect(lines.strap).toEqual([expect.stringMatching(/^strap runs [\d.]+ mm past the trim$/)]);
    const [es] = documentReflow(doc, labelsOf('es'), 'es');
    const esLines = Object.fromEntries(es!.entries.map((e) => [e.frame, e.lines]));
    expect(esLines.figure).toEqual([expect.stringMatching(/^figure queda debajo de photo \([\d,]+ mm²\)$/)]);
    expect(esLines.strap).toEqual([expect.stringMatching(/^strap pasa [\d,]+ mm del corte$/)]);
    // The fixes under the frames the events name.
    const entry = page!.entries.find((e) => e.frame === 'figure')!;
    const fixes = frameFixChecks(warnings, doc, page!.pageIndex, page!.fenceIndex, 'figure', entry.events);
    expect(fixes.map((w) => w.payload.kind)).toEqual(['frameCovered']);
  });
});

describe('one-click fixes of an overlap (#1066)', () => {
  for (const kind of ['layer', 'exclude'] as const) {
    it(`${kind}: changes the covering frame, one undo step, the check is gone`, () => {
      const { layout, history, get } = setUp(...textUnderPhoto());
      const before = get().config;
      const w = covered(layout().warnings, 'text')!;
      expect(proposalsOf(w).map((p) => p.kind)).toEqual(['layer', 'exclude', 'move']);
      const plan = planProposal(w, proposalsOf(w).find((p) => p.kind === kind)!, proposalContextOf(get()));
      expect(plan.kind).toBe('config');
      if (plan.kind !== 'config') return;
      expect(plan.settings[0]).toBe(`overlaps › photo › ${kind}`);
      expect(proposalQuestion(plan, w, DEFAULT_LABELS, 'en')).toMatch(new RegExp(`^Change the design: overlaps › photo › ${kind} = `));
      setOverlapFocus({ ...overlapFocusOf(w.payload)!, pageIndex: 0 });
      expect(runProposal(plan, w, DEFAULT_LABELS, history.dispatch)).toMatch(kind === 'layer' ? /^Done: paint photo under it \(layer 0\)/ : /^Done: make photo push the text round it/);
      // The overlap shown is not drawn on once fixed.
      expect(overlapFocusNow()).toBeNull();
      expect(covered(layout().warnings, 'text')).toBeUndefined();
      history.undo();
      expect(get().config).toEqual(before);
      expect(covered(layout().warnings, 'text')).toBeDefined();
    });
  }

  it('move: the moved frame’s placement offset with the shift added', () => {
    const { layout, get, history } = setUp();
    const w = covered(layout().warnings, 'card')!;
    const move = proposalsOf(w).find((p) => p.kind === 'move')!;
    expect(proposalText(move, w, DEFAULT_LABELS, 'en')).toMatch(/^move cutout [\d.]+ mm (right|left|down|up)/);
    const plan = planProposal(w, move, proposalContextOf(get()));
    expect(plan.kind).toBe('config');
    if (plan.kind !== 'config' || move.kind !== 'move') return;
    expect(plan.leaves[0]!.pointer).toBe('/pageTemplates/0/frames/3/placement/offset');
    expect(plan.leaves[0]!.value).toEqual({
      x: { value: Math.round((-4 + move.dxMm) * 10) / 10, unit: 'mm' },
      y: { value: Math.round((-14 + move.dyMm) * 10) / 10, unit: 'mm' },
    });
    expect(proposalQuestion(plan, w, DEFAULT_LABELS, 'en')).toMatch(/^Change the design: overlaps › cutout › placement\.offset = x -?[\d.]+ mm, y -?[\d.]+ mm\?/);
    runProposal(plan, w, DEFAULT_LABELS, history.dispatch);
    expect(covered(layout().warnings, 'card')).toBeUndefined();
    // A frame with no placement cannot be shifted: the move is told only.
    const unplaced = structuredClone(get().config);
    history.undo();
    delete (getAtPointer(unplaced, '/pageTemplates/0/frames/3') as { placement?: unknown }).placement;
    expect(planIsAdvice(planProposal(w, move, { config: unplaced, chapters: get().chapters }))).toBe(true);
  });

  it('continueNextPage of a frame past its edge comes with the room it has', () => {
    const { layout, get, history } = setUp();
    const w = outside(layout().warnings, 'note')!;
    const go = proposalsOf(w).find((p) => p.kind === 'continueNextPage')!;
    expect(proposalText(go, w, DEFAULT_LABELS, 'en')).toMatch(/^hold it to \d+ mm \(maxHeight\), continue it on the next page/);
    const plan = planProposal(w, go, proposalContextOf(get()));
    expect(plan.kind === 'config' && plan.leaves.map((l) => l.pointer)).toEqual(['/pageTemplates/0/frames/4/maxHeight', '/pageTemplates/0/frames/4/overflow/continueIn']);
    runProposal(plan, w, DEFAULT_LABELS, history.dispatch);
    expect(outside(layout().warnings, 'note')).toBeUndefined();
  });

  it('every fix of the fixture makes its check go away', () => {
    const { layout, get, history } = setUp();
    const first = layout().warnings.filter((w) => w.payload.kind === 'frameCovered' || w.payload.kind === 'frameOutsideArea');
    let tried = 0;
    for (const w of first) {
      for (const p of proposalsOf(w)) {
        const plan = planProposal(w, p, proposalContextOf(get()));
        expect(plan.kind, `${w.payload.kind} ${p.kind}`).toBe('config');
        runProposal(plan, w, DEFAULT_LABELS, history.dispatch);
        const again = layout().warnings.find((x) => x.payload.kind === w.payload.kind && 'frame' in x.payload && x.payload.frame === (w.payload as { frame: string }).frame
          && (x.payload.kind !== 'frameCovered' || x.payload.coveredBy === (w.payload as { coveredBy?: string }).coveredBy));
        expect(again, `${w.payload.kind} of ${(w.payload as { frame: string }).frame} after ${p.kind}`).toBeUndefined();
        // Nor does it raise an overlap the page did not have (#1075).
        const pairs = (ws: typeof first): string[] => ws.flatMap((x) => (x.payload.kind === 'frameCovered' ? [`${x.payload.frame}<${x.payload.coveredBy}`] : []));
        const had = new Set(pairs(first));
        expect(pairs(layout().warnings).filter((k) => !had.has(k)), `${w.payload.kind} ${p.kind}`).toEqual([]);
        history.undo();
        tried++;
      }
    }
    expect(tried).toBeGreaterThanOrEqual(5);
  });
});
