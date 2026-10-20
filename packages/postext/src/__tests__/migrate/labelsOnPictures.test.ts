import { describe, it, expect } from 'vitest';
import { buildDocument, collectConfigWarnings, composedPaintOrder, moveTextToMarkdown } from '../../index';
import { createMeasurementCache } from '../../measure';
import type { PostextConfig, Resource, VDTDocument } from '../../index';
import { PORT_CHAPTERS, PORT_CONFIG } from './fixtures/textbookPort';

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

const metadata = { title: 'Our World' };
const art = (id: string): Resource => ({ id, typeId: 'deco', kind: 'bitmap', createdAt: 0, updatedAt: 0, bitmap: { fileId: `${id}.png`, format: 'png', width: 2300, height: 2880 } });
const RESOURCES: Resource[] = ['art-p1', 'art-p2', 'art-p3'].map(art);
const CONFIG: PostextConfig = { ...PORT_CONFIG, resourceTypes: [{ id: 'deco', name: 'Picture', shortLabel: '', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '' }] };
const run = (opts = {}) => moveTextToMarkdown({ config: CONFIG, chapters: PORT_CHAPTERS, metadata, resources: RESOURCES }, { labelsOnPictures: true, ...opts });

describe('labels on pictures (#918)', () => {
  it('turns a short text on the page picture into a label at an anchor of its resource', () => {
    const { config, chapters, resources, report } = run();
    const ch1 = chapters.find((c) => c.id === 'ch1')!.markdown;
    expect(ch1).toMatch(/:::figure\{resource="art-p2" slot="[\w-]+"\}\n::label\[Rain gauge\]\{at="rain-gauge"\}\n:::/);
    // The picture is a frame now: no page picture attribute on its page.
    expect(ch1).not.toContain('background="art-p2"');
    const anchors = resources!.find((r) => r.id === 'art-p2')!.anchors!;
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ id: 'rain-gauge', align: 'start', verticalAlign: 'top', style: expect.stringMatching(/^label-fixture-sans-9/) });
    expect(anchors[0]!.x).toBeCloseTo(150 / 230, 4);
    expect(anchors[0]!.width).toBeCloseTo(30 / 230, 4);
    expect(config.labelStyles?.map((s) => s.id)).toEqual([anchors[0]!.style]);
    expect(config.labelStyles![0]).toMatchObject({ fontFamily: 'Fixture Sans', fontSize: { value: 9, unit: 'pt' }, fontWeight: 400 });
    expect(report.labels).toMatchObject({ labels: 1, anchors: 1, labelStylesCreated: [anchors[0]!.style] });
    // Larger and longer texts on the picture stay frames.
    expect(ch1).toContain('The weather');
    expect(report.contentInConfigAfter.warnings).toBe(1);
    expect(collectConfigWarnings(config, { metadata }).filter((w) => w.kind === 'contentInConfig').map((w) => w.ownerId)).toEqual(['topic--p9']);
  });

  it('keeps paired brackets in a label, and leaves a text whose brackets do not pair as a frame', () => {
    const relabel = (content: string) => CONFIG.headingStyles!.map((st) => st.id !== 'topic--p2' ? st : {
      ...st,
      header: { elements: st.header!.elements.map((e) => (e.id === 'label-p2' ? { ...e, content } : e)) },
    });
    const migrate = (content: string) => moveTextToMarkdown({ config: { ...CONFIG, headingStyles: relabel(content) }, chapters: PORT_CHAPTERS, metadata, resources: RESOURCES }, { labelsOnPictures: true });
    const paired = migrate('Gauge [B]');
    const ch1 = paired.chapters.find((c) => c.id === 'ch1')!.markdown;
    expect(ch1).toContain('::label[Gauge [B]]{at="gauge-b"}');
    const doc = buildDocument({ markdown: ch1, resources: paired.resources! }, paired.config, createMeasurementCache());
    expect(findLabel(doc, 'Gauge [B]')).toBeDefined();
    const unpaired = migrate('Gauge B]');
    expect(unpaired.report.labels.labels).toBe(0);
    expect(unpaired.chapters.find((c) => c.id === 'ch1')!.markdown).toContain('Gauge B]');
  });

  it('is off by default, and keeps a picture whose resource it does not know', () => {
    const off = moveTextToMarkdown({ config: CONFIG, chapters: PORT_CHAPTERS, metadata, resources: RESOURCES });
    expect(off.chapters.map((c) => c.markdown).join('\n')).not.toContain(':::figure');
    expect(off.report.labels.labels).toBe(0);
    const unknown = moveTextToMarkdown({ config: CONFIG, chapters: PORT_CHAPTERS, metadata }, { labelsOnPictures: true });
    expect(unknown.chapters.map((c) => c.markdown).join('\n')).not.toContain(':::figure');
  });

  it('sets the label where the design set its text: the first baseline and the picture in place', () => {
    const before = buildDocument({ markdown: PORT_CHAPTERS[0]!.markdown, resources: RESOURCES }, CONFIG, createMeasurementCache());
    const { config, chapters, resources } = run();
    const after = buildDocument({ markdown: chapters.find((c) => c.id === 'ch1')!.markdown, resources: resources! }, config, createMeasurementCache());
    const designLine = findDesignLine(before, 'Rain gauge');
    const label = findLabel(after, 'Rain gauge');
    expect(designLine).toBeDefined();
    expect(label).toBeDefined();
    const mmPerPx = 25.4 / (before.config?.page?.dpi ?? 300);
    expect(Math.abs(label!.baseline - designLine!.baseline) * mmPerPx).toBeLessThan(0.3);
    expect(Math.abs(label!.left - designLine!.left) * mmPerPx).toBeLessThan(0.3);
    expect(label!.scale).toBeUndefined();
    // The figure's body stands on the picture's box: the whole page.
    expect(label!.body.x * mmPerPx).toBeCloseTo(0, 1);
    expect(label!.body.y * mmPerPx).toBeCloseTo(0, 1);
    expect(label!.body.width * mmPerPx).toBeCloseTo(230, 0);
  });
});

describe('decoration painted over the picture (#957)', () => {
  const mmv = (value: number) => ({ value, unit: 'mm' as const });
  const at = (x: number, y: number, w: number, h: number) => ({ anchor: { to: 'page' as const, edge: 'top-left' as const }, offset: { x: mmv(x), y: mmv(y) }, size: { width: mmv(w), height: mmv(h) } });
  const tag = (id: string, x: number, y: number, w: number, h: number) => ({ kind: 'box', id, placement: at(x, y, w, h), style: { backgroundColor: { hex: '#2468c0', model: 'hex' as const } } }) as never;
  /** The p2 design with its elements replaced by those `change` makes. */
  const withElements = (change: (elements: readonly never[]) => never[]): PostextConfig => ({
    ...CONFIG,
    headingStyles: CONFIG.headingStyles!.map((st) => (st.id !== 'topic--p2' ? st : { ...st, header: { elements: change(st.header!.elements as never[]) } })),
  });
  const migrate = (config: PostextConfig) => moveTextToMarkdown({ config, chapters: PORT_CHAPTERS, metadata, resources: RESOURCES }, { labelsOnPictures: true });
  const pictureFrame = (config: PostextConfig) => config.pageTemplates!.flatMap((t) => t.frames ?? []).find((f) => f.name.startsWith('picture-'));
  /** The design: the page picture, a tag over it at the top, the label. */
  const tagged = (extra: never[] = [], before: never[] = []) => withElements((els) => [
    ...before,
    els.find((e) => (e as { id: string }).id === 'page')!,
    tag('tag', 0, 0, 90, 14),
    ...extra,
    els.find((e) => (e as { id: string }).id === 'label-p2')!,
    ...els.filter((e) => /^(kicker|title|body)-p2/.test((e as { id: string }).id)),
  ]);

  it('goes below the decoration when nothing lies under the picture, so the tag stays over it', () => {
    const { config, chapters, resources } = migrate(tagged());
    const frame = pictureFrame(config)!;
    expect(frame.layer).toBe(-1);
    const markdown = chapters.find((c) => c.id === 'ch1')!.markdown;
    const doc = buildDocument({ markdown, resources: resources! }, config, createMeasurementCache());
    const page = doc.pages.find((p) => p.composed?.frames.some((f) => f.name === frame.name))!;
    const order = composedPaintOrder(page).map((i) => (i.kind === 'frame' ? i.frame.name : i.kind));
    // The picture is painted before the decoration, which holds the tag.
    expect(order.indexOf(frame.name)).toBeLessThan(order.indexOf('decoration'));
    expect(page.composed!.decoration?.blocks.length).toBeGreaterThan(0);
  });

  it('is reported when the design also painted decoration under the picture', () => {
    const { config, report } = migrate(tagged([], [tag('floor', 10, 10, 60, 60)]));
    expect(pictureFrame(config)!.layer).toBe(0);
    expect(JSON.stringify(report.pages)).toContain('overPicture');
  });

  it('is reported, at layer 0, when the decoration over the picture would cover a label', () => {
    const { config, report } = migrate(tagged([tag('cover', 140, 140, 60, 30)]));
    expect(pictureFrame(config)!.layer).toBe(0);
    expect(JSON.stringify(report.pages)).toContain('overPicture');
  });

  it('keeps layer 0 where nothing was painted over the picture', () => {
    const { config, report } = migrate(withElements((els) => els.filter((e) => !/^(card|hl)-p2$/.test((e as { id: string }).id))));
    expect(pictureFrame(config)!.layer).toBe(0);
    expect(JSON.stringify(report.pages)).not.toContain('overPicture');
  });
});

function findDesignLine(doc: VDTDocument, text: string): { baseline: number; left: number } | undefined {
  for (const page of doc.pages) {
    for (const slot of [page.header, page.footer, page.composed?.decoration]) {
      for (const b of slot?.blocks ?? []) {
        if (b.kind !== 'text') continue;
        const line = b.lines.find((l) => l.text.includes(text));
        if (line) return { baseline: line.baselineY, left: b.bbox.x + line.xOffset };
      }
    }
  }
  return undefined;
}

function findLabel(doc: VDTDocument, text: string): { baseline: number; left: number; scale?: number; body: { x: number; y: number; width: number } } | undefined {
  const blocks = doc.pages.flatMap((p) => [...(p.floats ?? []), ...p.columns.flatMap((c) => c.blocks)]);
  for (const b of [...doc.blocks, ...blocks]) {
    const rb = b.resourceBlock;
    const label = rb?.labels?.find((l) => l.text === text);
    if (!rb || !label?.layout) continue;
    const bx = b.bbox.x + rb.bodyRect.x;
    const by = b.bbox.y + rb.bodyRect.y;
    const line = label.layout.lines[0]!;
    return {
      baseline: by + label.layout.y + line.baseline,
      left: bx + label.layout.x + line.bbox.x,
      ...(label.layout.scale !== undefined ? { scale: label.layout.scale } : {}),
      body: { x: bx, y: by, width: rb.bodyRect.width },
    };
  }
  return undefined;
}
