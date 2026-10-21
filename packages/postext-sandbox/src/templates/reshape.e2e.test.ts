import { describe, expect, it } from 'vitest';
import { buildDocument, type PostextConfig, type VDTDocument } from 'postext';
import { applyTextChanges } from '../book/textChanges.js';
import { planFramesToGrid } from './framesToGrid.js';
import { laidFrames } from './pagePieces.js';
import { planExtractModule } from './moduleEdits.js';
import { ONE_OFF_TEMPLATE, RESHAPE_CONFIG, RESHAPE_RESOURCES, oneOffPage } from './reshape.fixture.js';

// Reshaping a page of one-off frames (#1065): five photo cards into a
// grid, a box and its picture into a module. The page must look as it
// did: every frame where it stood, under its new name.

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

const build = (markdown: string, config: PostextConfig): VDTDocument => buildDocument({ markdown, resources: RESHAPE_RESOURCES }, config);

const boxes = (doc: VDTDocument): Map<string, { x: number; y: number; width: number; height: number }> => {
  const page = doc.pages.find((p) => p.composed)!;
  return new Map(page.composed!.frames.map((f) => [f.name, f.rect]));
};

/** Frames that moved by more than 0.3 px (old name → new name). */
function moved(before: VDTDocument, after: VDTDocument, names: Record<string, string>): string[] {
  const a = boxes(before);
  const b = boxes(after);
  const out: string[] = [];
  for (const [name, r] of a) {
    const to = names[name] ?? name;
    const s = b.get(to);
    if (!s) {
      out.push(`${name}: missing as ${to}`);
      continue;
    }
    const d = Math.max(Math.abs(r.x - s.x), Math.abs(r.y - s.y), Math.abs(r.width - s.width), Math.abs(r.height - s.height));
    if (d > 0.3) out.push(`${name} → ${to}: ${JSON.stringify(r)} vs ${JSON.stringify(s)}`);
  }
  return out;
}

const CARDS = ['foto1', 'pie1', 'foto2', 'pie2', 'foto3', 'pie3', 'foto4', 'pie4', 'foto5', 'pie5'];

describe('turning one-off frames into a grid (#1065)', () => {
  const markdown = oneOffPage();
  const before = build(markdown, RESHAPE_CONFIG);
  const pageIndex = before.pages.findIndex((p) => p.composed);
  const laid = laidFrames(before, pageIndex, 'content')!;

  it('reads the lattice and writes one grid of photo cards', () => {
    const plan = planFramesToGrid({ templates: [ONE_OFF_TEMPLATE], templateId: 'rio', frames: CARDS, laid, chapters: [{ id: 'c', markdown }] });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan).toMatchObject({ main: 'foto', members: ['pie'], columns: 3, rows: 2, columnGapMm: 6, pages: 1 });
    const t = plan.templates[0]!;
    expect(t.frames!.map((f) => f.name)).toEqual(['titulo', 'foto', 'pie', 'nota', 'imagen', 'cierre']);
    expect(t.groups).toEqual([expect.objectContaining({ name: 'grid', kind: 'grid', columns: 3, rowAlign: 'start', repeat: { frames: ['foto', 'pie'] } })]);
    const text = applyTextChanges(markdown, plan.chapters[0]!.changes);
    expect(text).toContain(':::frame{slot="foto"}\n::resource{id="foto-a"}\n\n:::frame{slot="pie"}\nThe heron\n:::\n:::\n');
    expect(text).not.toContain('slot="foto2"');
  });

  it('keeps every card where it stood', () => {
    const plan = planFramesToGrid({ templates: [ONE_OFF_TEMPLATE], templateId: 'rio', frames: CARDS, laid, chapters: [{ id: 'c', markdown }] });
    if (!plan.ok) throw new Error(plan.reason);
    const text = applyTextChanges(markdown, plan.chapters[0]!.changes);
    const after = build(text, { ...RESHAPE_CONFIG, pageTemplates: plan.templates });
    expect(moved(before, after, plan.instances)).toEqual([]);
  });
});

describe('extracting a module from a page (#1065)', () => {
  const markdown = oneOffPage();
  const before = build(markdown, RESHAPE_CONFIG);
  const pageIndex = before.pages.findIndex((p) => p.composed);
  const laid = laidFrames(before, pageIndex, 'content')!;

  it('moves the box, its picture and the rule over it into a module, and the page looks the same', () => {
    const plan = planExtractModule({ templates: [ONE_OFF_TEMPLATE], templateId: 'rio', frames: ['nota', 'imagen'], name: 'Caja', laid, chapters: [{ id: 'c', markdown }] });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan).toMatchObject({ module: 'caja', group: 'modules', decoration: ['raya'], pages: 1 });
    const [page, mod] = plan.templates;
    expect(mod).toMatchObject({ id: 'caja', name: 'Caja', role: 'module' });
    expect(mod!.frames!.map((f) => f.name)).toEqual(['nota', 'imagen']);
    expect(page!.frames!.map((f) => f.name)).not.toContain('nota');
    expect(page!.groups!.find((g) => g.modules)?.name).toBe('modules');
    const text = applyTextChanges(markdown, plan.chapters[0]!.changes);
    expect(text).toContain(':::module{template="caja"}\n:::frame{slot="nota" label="Did you know?"}\n');
    const after = build(text, { ...RESHAPE_CONFIG, pageTemplates: plan.templates });
    expect(moved(before, after, plan.names)).toEqual([]);
  });

  it('after the grid: both on one page, and it still looks the same', () => {
    const grid = planFramesToGrid({ templates: [ONE_OFF_TEMPLATE], templateId: 'rio', frames: CARDS, laid, chapters: [{ id: 'c', markdown }] });
    if (!grid.ok) throw new Error(grid.reason);
    const text1 = applyTextChanges(markdown, grid.chapters[0]!.changes);
    const mid = build(text1, { ...RESHAPE_CONFIG, pageTemplates: grid.templates });
    const laid2 = laidFrames(mid, mid.pages.findIndex((p) => p.composed), 'content')!;
    const plan = planExtractModule({ templates: grid.templates, templateId: 'rio', frames: ['nota', 'imagen'], name: 'caja', laid: laid2, chapters: [{ id: 'c', markdown: text1 }] });
    if (!plan.ok) throw new Error(plan.reason);
    const text2 = applyTextChanges(text1, plan.chapters[0]!.changes);
    const after = build(text2, { ...RESHAPE_CONFIG, pageTemplates: plan.templates });
    expect(moved(before, after, { ...grid.instances, nota: 'caja[1].nota', imagen: 'caja[1].imagen' })).toEqual([]);
  });
});
