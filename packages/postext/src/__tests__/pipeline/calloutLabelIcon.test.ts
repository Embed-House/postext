import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline';
import { resolveCalloutStylesConfig } from '../../defaults/calloutStyles';
import { resolveBodyTextConfig } from '../../defaults/bodyText';
import { resolveHeadingsConfig } from '../../defaults/headings';
import { resolveUnorderedListsConfig } from '../../defaults/unorderedLists';
import type { PostextConfig, Resource, VDTBlock, VDTDesignBlock, VDTDesignImageBlock, VDTDesignTextBlock, VDTDocument } from '../../index';

// #981: the picture of a label tab can stand inside the tab, before the words.

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

const pt = (value: number) => ({ value, unit: 'pt' as const });
const RING: Resource = { id: 'ring', typeId: 'figure', kind: 'svg', altText: '', createdAt: 0, updatedAt: 0, svg: { fileId: 'ring.svg', width: 20, height: 10 } };

const config = (placement?: 'beside' | 'inside', extra: Record<string, unknown> = {}): PostextConfig => ({
  page: { width: pt(500), height: pt(700), dpi: 72, margins: { top: pt(20), bottom: pt(20), left: pt(30), right: pt(20) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontSize: pt(10), lineHeight: pt(14) },
  calloutStyles: [{
    id: 'tab', title: '', padding: { top: pt(6), right: pt(6), bottom: pt(6), left: pt(6) },
    label: { fontSize: pt(10), fontWeight: 400, position: 'top-left', height: pt(14), paddingX: pt(6), offset: pt(7), icon: { resourceId: 'ring', width: pt(8), gap: pt(3), ...(placement ? { placement } : {}) }, ...extra },
  }] as never,
});
const build = (placement?: 'beside' | 'inside', extra?: Record<string, unknown>): VDTDocument =>
  buildDocument({ markdown: ':::callout{type="tab" label="Money"}\nBody of the box.\n:::', resources: [RING] }, config(placement, extra));
const overlay = (doc: VDTDocument): VDTDesignBlock[] => (doc.blocks.find((b): b is VDTBlock => b.type === 'callout')!.designOverlay?.blocks ?? []);
const tab = (doc: VDTDesignBlock[]) => doc.find((b) => b.kind === 'box' && Math.abs(b.bbox.height - 14) < 1e-6)!;
const words = (blocks: VDTDesignBlock[]) => blocks.find((b): b is VDTDesignTextBlock => b.kind === 'text' && b.lines[0]?.text === 'Money')!;
const icon = (blocks: VDTDesignBlock[]) => blocks.find((b): b is VDTDesignImageBlock => b.kind === 'image')!;

describe('label.icon.placement (#981)', () => {
  it('resolves to beside, keeps inside, and ignores anything else', () => {
    const body = resolveBodyTextConfig();
    const [a, b, c] = resolveCalloutStylesConfig(
      [
        { id: 'a', label: {} },
        { id: 'b', label: { icon: { placement: 'inside' } } },
        { id: 'c', label: { icon: { placement: 'sideways' as never } } },
      ],
      body, resolveHeadingsConfig({}), resolveUnorderedListsConfig(undefined, body),
    );
    expect(a!.label!.icon.placement).toBe('beside');
    expect(b!.label!.icon.placement).toBe('inside');
    expect(c!.label!.icon.placement).toBe('beside');
  });

  it('beside is what it was: the picture past the tab, the tab as wide as its words', () => {
    for (const placement of [undefined, 'beside' as const]) {
      const blocks = overlay(build(placement));
      const t = tab(blocks);
      expect(t.bbox.width).toBeCloseTo(5 * 7 + 2 * 6, 3);
      expect(icon(blocks).bbox.x).toBeCloseTo(t.bbox.x + t.bbox.width + 3, 3);
      expect(words(blocks).lines[0]!.xOffset).toBeCloseTo(6, 3);
    }
  });

  it('inside puts the picture at the start of the tab, widens the tab and moves the words after it', () => {
    const blocks = overlay(build('inside'));
    const t = tab(blocks);
    const img = icon(blocks);
    // 20 × 10 picture in an 8 pt wide, 14 pt tall slot: 8 × 4.
    expect(img.bbox.width).toBeCloseTo(8, 3);
    expect(img.bbox.height).toBeCloseTo(4, 3);
    expect(t.bbox.width).toBeCloseTo(6 + 8 + 3 + 5 * 7 + 6, 3);
    expect(img.bbox.x).toBeCloseTo(t.bbox.x + 6, 3);
    expect(img.bbox.y + img.bbox.height / 2).toBeCloseTo(t.bbox.y + t.bbox.height / 2, 3);
    expect(words(blocks).lines[0]!.xOffset).toBeCloseTo(6 + 8 + 3, 3);
    // The picture is wholly inside the tab, the words end inside it.
    expect(img.bbox.x + img.bbox.width).toBeLessThanOrEqual(t.bbox.x + t.bbox.width);
    expect(words(blocks).lines[0]!.xOffset + words(blocks).lines[0]!.width).toBeLessThanOrEqual(t.bbox.width - 6 + 1e-6);
  });

  it('inside on a tab at the right corner grows towards the left', () => {
    const left = tab(overlay(build('inside', { position: 'top-left' })));
    const right = overlay(build('inside', { position: 'top-right' }));
    const t = tab(right);
    expect(t.bbox.width).toBeCloseTo(left.bbox.width, 3);
    expect(icon(right).bbox.x).toBeCloseTo(t.bbox.x + 6, 3);
    const box = build('inside', { position: 'top-right' }).blocks.find((b) => b.type === 'callout')!;
    expect(t.bbox.x + t.bbox.width).toBeCloseTo(box.bbox.x + box.bbox.width, 3);
  });

  it('without a picture to draw the tab is the plain one', () => {
    const doc = buildDocument({ markdown: ':::callout{type="tab" label="Money"}\nBody.\n:::', resources: [] }, config('inside'));
    const t = tab(overlay(doc));
    expect(t.bbox.width).toBeCloseTo(5 * 7 + 2 * 6, 3);
    expect(overlay(doc).some((b) => b.kind === 'image')).toBe(false);
  });

  it('a right-to-left document lays the tab out in its flow, which the page paints mirrored', () => {
    const rtl = buildDocument({ markdown: ':::callout{type="tab" label="Money"}\nBody.\n:::', resources: [RING] }, { ...config('inside', { position: 'top-start' }), direction: 'rtl' });
    const blocks = overlay(rtl);
    const t = tab(blocks);
    // The start of the flow is its left: the picture, then the words.
    expect(icon(blocks).bbox.x).toBeCloseTo(t.bbox.x + 6, 3);
    expect(words(blocks).lines[0]!.xOffset).toBeCloseTo(6 + 8 + 3, 3);
  });

  it('a box set against the document direction starts at the other end', () => {
    const doc = buildDocument({ markdown: ':::callout{type="tab" label="Money" dir="rtl"}\nBody.\n:::', resources: [RING] }, config('inside', { position: 'top-start' }));
    const blocks = overlay(doc);
    const t = tab(blocks);
    const box = doc.blocks.find((b) => b.type === 'callout')!;
    // Its start is the right end of the box: the tab hugs it, the picture sits at its right end.
    expect(t.bbox.x + t.bbox.width).toBeCloseTo(box.bbox.x + box.bbox.width, 3);
    expect(icon(blocks).bbox.x + icon(blocks).bbox.width).toBeCloseTo(t.bbox.x + t.bbox.width - 6, 3);
    expect(words(blocks).lines[0]!.xOffset).toBeCloseTo(6, 3);
  });
});
