/**
 * The overlap checks of composed pages (#1053, DESIGN §12.10): ink of a
 * frame under a frame painted over it (`frameCovered`) and ink past the
 * trim, the bleed or the box a frame is anchored inside
 * (`frameOutsideArea`). The fixture (`fixtures/overlap/`) holds the two
 * cases a real textbook's port passed `check` with: a caption clipped under
 * a picture frame on a higher layer, and a tab label under a cut-out photo;
 * besides, a note anchored inside a card that runs past its foot, and a
 * strap of text below the trim.
 */
// @ts-expect-error -- a Node built-in: the package compiles without @types/node.
import { readFileSync as readFile } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline/build';
import { createMeasurementCache } from '../../measure';
import { formatWarning } from '../../pipeline/contentWarnings';
import { composedReflowLog } from '../../composed/reflowLog';
import { validatePageTemplates } from '../../composed/validate';
import type { FrameConfig, PageTemplate } from '../../composed/types';
import type { ContentWarning, PostextConfig, Resource, VDTDocument } from '../../index';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const readFileSync = readFile as (path: URL, encoding: 'utf8') => string;
const DIR = new URL('./fixtures/overlap/', import.meta.url);
const CONFIG = JSON.parse(readFileSync(new URL('config.json', DIR), 'utf8')) as PostextConfig;
const MARKDOWN = readFileSync(new URL('overlap.md', DIR), 'utf8');
/** The fixture's pictures at their pixel sizes, 300 ppi (as the command
 *  line reads a folder of pictures). */
const RESOURCES: Resource[] = ([['chart', 1200, 600], ['photo', 900, 600], ['cutout', 720, 720]] as const).map(([id, width, height]) => ({
  id,
  typeId: 'pic',
  kind: 'bitmap' as const,
  caption: '',
  createdAt: 0,
  updatedAt: 0,
  bitmap: { fileId: `${id}.png`, format: 'png', width, height, resolution: 300 },
})) as Resource[];

type Covered = Extract<ContentWarning, { kind: 'frameCovered' }>;
type Outside = Extract<ContentWarning, { kind: 'frameOutsideArea' }>;

const mm = (value: number) => ({ value, unit: 'mm' as const });
const template = (): PageTemplate => structuredClone((CONFIG.pageTemplates as PageTemplate[])[0]!);
/** The fixture with frames changed by `patch` (by name). */
const withFrames = (patch: Record<string, Partial<FrameConfig>>, base: PageTemplate = template()): PageTemplate => ({
  ...base,
  frames: base.frames!.map((f) => (patch[f.name] ? { ...f, ...patch[f.name] } : f)),
});
const build = (tpl: PageTemplate = template(), markdown = MARKDOWN, extra: PostextConfig = {}): VDTDocument =>
  buildDocument({ markdown, resources: RESOURCES }, { ...CONFIG, ...extra, pageTemplates: [tpl] }, createMeasurementCache());
const covered = (doc: VDTDocument): Covered[] => (doc.contentWarnings ?? []).filter((w): w is Covered => w.kind === 'frameCovered');
const outside = (doc: VDTDocument): Outside[] => (doc.contentWarnings ?? []).filter((w): w is Outside => w.kind === 'frameOutsideArea');
const pair = (doc: VDTDocument, frame: string, by: string): Covered | undefined => covered(doc).find((w) => w.frame === frame && w.coveredBy === by);

describe('frameCovered (#1053)', () => {
  const doc = build();

  it('reports a caption clipped under a picture frame on a higher layer', () => {
    const w = pair(doc, 'figure', 'photo')!;
    expect(w).toMatchObject({ template: 'overlaps', fenceIndex: 0, pageIndex: 0, locale: 'en', configPath: '/pageTemplates/0/frames/0', coveredByPath: '/pageTemplates/0/frames/1' });
    expect(w.text).toMatch(/^Rainfall in the four seasons/);
    expect(w.overlapMm2).toBeGreaterThan(10);
    expect(w.sourceStart).toBeGreaterThan(0);
    // Painting the photo under the figure would hide the photo under the
    // chart: not proposed. A caption does not run round a pushing frame:
    // no exclude either. Moving the photo off the caption is.
    expect(w.proposals.map((p) => p.kind)).toEqual(['move']);
  });

  it('reports a tab label under a cut-out photo', () => {
    const w = pair(doc, 'card', 'cutout')!;
    expect(w.text).toMatch(/^Field notes/);
    expect(w.coveredByPath).toBe('/pageTemplates/0/frames/3');
    const move = w.proposals.find((p) => p.kind === 'move');
    expect(move).toMatchObject({ kind: 'move', frame: 'cutout' });
  });

  it('reports nothing else on the fixture: the note sits clear of the card text, the strap over nothing', () => {
    expect(covered(doc).map((w) => `${w.frame}<${w.coveredBy}`).sort()).toEqual(['card<cutout', 'figure<photo']);
  });

  it('the proposed move uncovers the tab', () => {
    const w = pair(doc, 'card', 'cutout')!;
    const move = w.proposals.find((p): p is Extract<Covered['proposals'][number], { kind: 'move' }> => p.kind === 'move')!;
    const cut = template().frames!.find((f) => f.name === 'cutout')!;
    const off = cut.placement!.offset!;
    const moved = withFrames({ cutout: { placement: { ...cut.placement!, offset: { x: mm((off.x as { value: number }).value + move.dxMm), y: mm((off.y as { value: number }).value + move.dyMm) } } } });
    expect(pair(build(moved), 'card', 'cutout')).toBeUndefined();
  });

  it('the proposed move uncovers the caption', () => {
    const w = pair(doc, 'figure', 'photo')!;
    const move = w.proposals.find((p): p is Extract<Covered['proposals'][number], { kind: 'move' }> => p.kind === 'move')!;
    const photo = template().frames!.find((f) => f.name === 'photo')!;
    const moved = withFrames({ photo: { placement: { ...photo.placement!, offset: { x: mm(move.dxMm), y: mm(move.dyMm) } } } });
    expect(pair(build(moved), 'figure', 'photo')).toBeUndefined();
  });

  it('proposes exclude: push for body text under a picture, and a layer swap where the text lies on nothing opaque', () => {
    const tpl: PageTemplate = {
      id: 'overlaps',
      frames: [
        { name: 'text', width: mm(120), placement: { anchor: { to: 'container', edge: 'top-left' } } },
        { name: 'photo', layer: 2, width: mm(40), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(30), y: mm(2) } } },
      ],
    };
    const md = `::::page{template="overlaps"}\n:::frame{slot="text"}\n${'The mill keeps a record of each season. '.repeat(30)}\n:::\n\n::resource{id="photo" slot="photo"}\n::::\n`;
    const w = pair(build(tpl, md), 'text', 'photo')!;
    expect(w.proposals.map((p) => p.kind)).toEqual(['layer', 'exclude', 'move']);
    expect(w.proposals[0]).toEqual({ kind: 'layer', path: '/pageTemplates/0/frames/1/layer', value: 0 });
    expect(w.proposals[1]).toEqual({ kind: 'exclude', path: '/pageTemplates/0/frames/1/exclude', value: 'push' });
    // Pushing, the photo sends the lines round it: nothing is covered.
    const pushed = build(withFrames({ photo: { exclude: 'push' } }, tpl), md);
    expect(pair(pushed, 'text', 'photo')).toBeUndefined();
    // Under the text, the photo hides nothing.
    const lowered = build(withFrames({ photo: { layer: 0 } }, tpl), md);
    expect(covered(lowered)).toEqual([]);
  });

  it("a frame with no fill and no picture covers nothing between its lines", () => {
    // A frameless frame over the card's text, painted after it, its one
    // word at its foot, below the card's lines.
    const tpl = template();
    tpl.frames!.push({ name: 'veil', layer: 3, width: mm(60), height: mm(30), verticalAlign: 'bottom', placement: { anchor: { to: '#card', edge: 'top-left' }, offset: { y: mm(8) } } });
    const md = MARKDOWN.replace('\n::::', '\n\n:::frame{slot="veil"}\nWet\n:::\n::::');
    const d = build(tpl, md);
    expect(d.pages[0]!.composed!.frames.find((f) => f.name === 'veil')!.blockIds.length).toBeGreaterThan(0);
    expect(covered(d).filter((w) => w.coveredBy === 'veil')).toEqual([]);
    // Given a fill, it hides the card's lines.
    tpl.frames![tpl.frames!.length - 1] = { ...tpl.frames![tpl.frames!.length - 1]!, style: 'sticky' };
    const filled = pair(build(tpl, md), 'card', 'veil');
    expect(filled?.text).toMatch(/river/);
  });

  it("overlap: 'allow' on either frame silences the pair", () => {
    expect(pair(build(withFrames({ photo: { overlap: 'allow' } })), 'figure', 'photo')).toBeUndefined();
    expect(pair(build(withFrames({ figure: { overlap: 'allow' } })), 'figure', 'photo')).toBeUndefined();
    // The other pair still reports.
    expect(pair(build(withFrames({ photo: { overlap: 'allow' } })), 'card', 'cutout')).toBeDefined();
  });

  it('is written for the command line, and the reflow log names it', () => {
    const w = pair(doc, 'card', 'cutout')!;
    const text = formatWarning(w);
    expect(text).toContain('Frame "card" of template "overlaps" (en) lies under frame "cutout"');
    expect(text).toContain('"Field notes');
    expect(text).toContain("overlap: 'allow'");
    const lines = composedReflowLog(doc)[0]!.lines;
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^figure lies under photo \([\d.]+ mm²\)$/), expect.stringMatching(/^card lies under cutout/)]));
  });
});

describe('frameOutsideArea (#1053)', () => {
  const doc = build();

  it('reports a frame anchored inside a box that runs past it, with fixes', () => {
    const w = outside(doc).find((x) => x.frame === 'note')!;
    expect(w).toMatchObject({ past: 'frame', target: 'card', configPath: '/pageTemplates/0/frames/4', pageIndex: 0, locale: 'en' });
    expect(w.sides.bottom).toBeGreaterThan(10);
    expect(w.excessMm).toBe(w.sides.bottom);
    const kinds = w.proposals.map((p) => p.kind);
    expect(kinds).toEqual(['maxHeight', 'continueNextPage', 'minHeight', 'move']);
    const max = w.proposals[0] as Extract<Outside['proposals'][number], { kind: 'maxHeight' }>;
    expect(max.path).toBe('/pageTemplates/0/frames/4/maxHeight');
    const min = w.proposals[2] as Extract<Outside['proposals'][number], { kind: 'minHeight' }>;
    expect(min).toMatchObject({ path: '/pageTemplates/0/frames/2/minHeight', frame: 'card' });
    // The card raised to the proposed minimum holds the note.
    expect(outside(build(withFrames({ card: { minHeight: min.value } }))).filter((x) => x.frame === 'note')).toEqual([]);
    // Held to the proposed maximum it is inside too.
    expect(outside(build(withFrames({ note: { height: max.value } }))).filter((x) => x.frame === 'note')).toEqual([]);
  });

  it('reports text past the trim', () => {
    const w = outside(doc).find((x) => x.frame === 'strap')!;
    expect(w).toMatchObject({ past: 'trim', configPath: '/pageTemplates/0/frames/5' });
    expect(w.sides.bottom).toBeGreaterThan(0.3);
    // Held by its foot, a smaller height would not bring it in: moved up it is.
    expect(w.proposals).toEqual([{ kind: 'move', frame: 'strap', dxMm: 0, dyMm: -w.sides.bottom! }]);
    const strap = template().frames!.find((f) => f.name === 'strap')!;
    const up = withFrames({ strap: { placement: { ...strap.placement!, offset: { x: mm(20), y: mm(14 - w.sides.bottom! - 0.5) } } } });
    expect(outside(build(up)).filter((x) => x.frame === 'strap')).toEqual([]);
    expect(formatWarning(w)).toContain('runs');
    expect(formatWarning(w)).toContain('past the trim');
  });

  it('a fill or a picture may run into the bleed; past it, it is reported', () => {
    const band = (y: number): PageTemplate => ({
      id: 'overlaps',
      frames: [{ name: 'band', style: 'sticky', width: mm(240), height: mm(30), placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(-3), y: mm(y) } } }],
    });
    const md = '::::page{template="overlaps"}\n:::frame{slot="band"}\nBand\n:::\n::::\n';
    // 240 mm on a 200 mm sheet from 3 mm left of the trim: 37 mm past its
    // right edge, with no bleed.
    const w = outside(build(band(0), md)).find((x) => x.frame === 'band')!;
    expect(w).toMatchObject({ past: 'bleed' });
    expect(w.sides.left).toBeCloseTo(3, 0);
    expect(w.sides.right).toBeCloseTo(37, 0);
  });

  it("does not report a frame placed by an element edge or whose anchor point lies outside the box", () => {
    expect(outside(doc).filter((x) => x.frame === 'cutout' || x.frame === 'photo' || x.frame === 'card' || x.frame === 'figure')).toEqual([]);
  });

  it("overlap: 'allow' silences it", () => {
    expect(outside(build(withFrames({ note: { overlap: 'allow' } }))).filter((x) => x.frame === 'note')).toEqual([]);
    expect(outside(build(withFrames({ strap: { overlap: 'allow' } }))).filter((x) => x.frame === 'strap')).toEqual([]);
  });

  it('the reflow log names it', () => {
    const lines = composedReflowLog(doc)[0]!.lines;
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^note runs [\d.]+ mm past card$/), expect.stringMatching(/^strap runs [\d.]+ mm past the trim$/)]));
  });
});

describe('the overlap checks on a spread (#1053)', () => {
  const spread: PageTemplate = {
    id: 'sheet',
    spread: true,
    gutter: mm(10),
    frames: [
      { name: 'left', width: mm(120), placement: { anchor: { to: 'container', edge: 'top-left' } } },
      { name: 'right', width: mm(120), placement: { anchor: { to: 'container', edge: 'top-right' } } },
      { name: 'stamp', layer: 2, width: mm(30), placement: { anchor: { to: 'container', edge: 'top-right' }, offset: { x: mm(-20), y: mm(2) } } },
    ],
  };
  const md = [
    '::::page{template="sheet" spread}',
    ':::frame{slot="left"}',
    'The left page holds the first half of the walk along the river.',
    ':::',
    '',
    ':::frame{slot="right"}',
    `${'The right page holds the second half, past the mill and the bridge. '.repeat(6)}`,
    ':::',
    '',
    '::resource{id="cutout" slot="stamp"}',
    '::::',
    '',
  ].join('\n');

  it('reads the warning on the page that holds the covered frame, and checks the facing copies of nothing', () => {
    const doc = build(spread, md);
    const ws = covered(doc);
    expect(ws.map((w) => `${w.frame}<${w.coveredBy}`)).toEqual(['right<stamp']);
    const pages = doc.pages.filter((p) => p.composed?.spread);
    expect(pages).toHaveLength(2);
    // The right frame is on the second page of the sheet.
    const holder = pages.find((p) => p.composed!.frames.some((f) => f.name === 'right' && f.blockIds.length > 0))!;
    expect(ws[0]!.pageIndex).toBe(holder.index);
    expect(holder.composed!.log.some((e) => e.kind === 'covered' && e.frame === 'right')).toBe(true);
  });
});

describe('FrameConfig.overlap (#1053)', () => {
  it("is 'check' or 'allow'; any other word is reported", () => {
    const tpl = withFrames({ photo: { overlap: 'sometimes' as never } });
    const ws = validatePageTemplates({ ...CONFIG, pageTemplates: [tpl] });
    expect(ws).toEqual([expect.objectContaining({ kind: 'unknownConfigValue', path: '/pageTemplates/0/frames/1/overlap', value: 'sometimes', used: 'check' })]);
    expect(validatePageTemplates({ ...CONFIG, pageTemplates: [withFrames({ photo: { overlap: 'allow' } })] })).toEqual([]);
  });
});
