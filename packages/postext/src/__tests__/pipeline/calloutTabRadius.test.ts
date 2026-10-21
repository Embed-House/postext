import { describe, it, expect } from 'vitest';
import { buildDocument } from '../../pipeline';
import { createMeasurementCache } from '../../measure';
import { resolveAllConfig } from '../../pipeline/config';
import { stripCalloutStylesDefaults } from '../../defaults';
import { boxOutline, boxStylePathBlocks } from '../../design/boxShape';
import { createBoundingBox } from '../../vdt';
import type { CalloutStyleConfig, PostextConfig, VDTBlock, VDTDesignBlock, VDTDesignBoxBlock, VDTDesignPathBlock, VDTDocument } from '../../index';

// #1102: a label tab with corners of its own, apart from the box or
// joined to it.

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: [...s].length * size * 0.6 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx {
    return new StubCtx();
  }
};

const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const config = (style: Partial<CalloutStyleConfig>): PostextConfig => ({
  page: { width: pt(500), height: pt(700), dpi: 72, margins: { top: pt(40), bottom: pt(20), left: pt(30), right: pt(20) } },
  layout: { layoutType: 'single' },
  header: { elements: [] },
  footer: { elements: [] },
  bodyText: { fontSize: pt(10), lineHeight: pt(14) },
  calloutStyles: [{ id: 'card', title: '', background: hex('#fafafa'), padding: { top: pt(6), right: pt(6), bottom: pt(6), left: pt(6) }, ...style }],
});
const build = (style: Partial<CalloutStyleConfig>): VDTDocument =>
  buildDocument({ markdown: ':::callout{type="card" label="Words"}\nBody of the box.\n:::' }, config(style), createMeasurementCache());
const overlay = (doc: VDTDocument): VDTDesignBlock[] =>
  doc.blocks.find((b): b is VDTBlock => b.type === 'callout')!.designOverlay?.blocks ?? [];
/** The tab's fill: the 14 px tall box. */
const tabBox = (doc: VDTDocument) => overlay(doc).find((b): b is VDTDesignBoxBlock => b.kind === 'box' && b.bbox.height === 14)!;
const paths = (doc: VDTDocument) => overlay(doc).filter((b): b is VDTDesignPathBlock => b.kind === 'path');
const label = (extra: Record<string, unknown> = {}) => ({
  fontSize: pt(10), height: pt(14), paddingX: pt(5), color: hex('#ffffff'), background: hex('#336699'), ...extra,
}) as CalloutStyleConfig['label'];

describe('label.borderRadius (#1102)', () => {
  it('resolves only when set and is kept by the strip', () => {
    const resolve = (l: CalloutStyleConfig['label']) => resolveAllConfig({ calloutStyles: [{ id: 'x', label: l }] }).calloutStyles[0]!.label!;
    expect(resolve({}).borderRadius).toBeUndefined();
    expect(resolve({ borderRadius: pt(3) }).borderRadius).toEqual(pt(3));
    expect(stripCalloutStylesDefaults([{ id: 'x', label: { borderRadius: { topLeft: pt(3) } } }])).toEqual([{ id: 'x', label: { borderRadius: { topLeft: pt(3) } } }]);
  });
});

describe('a tab apart from the box with corners of its own (#1102)', () => {
  it('stays square by default, as before', () => {
    expect(tabBox(build({ label: label() })).box).toEqual({ backgroundColor: '#336699', borderWidthPx: 0, borderRadiusPx: 0 });
  });

  it('rounds every corner with one radius', () => {
    expect(tabBox(build({ label: label({ borderRadius: pt(4) }) })).box).toEqual({ backgroundColor: '#336699', borderWidthPx: 0, borderRadiusPx: 4 });
  });

  it('rounds the corners it names, drawn through the box outline', () => {
    const tab = tabBox(build({ label: label({ borderRadius: { topLeft: pt(5), topRight: pt(5) } }) }));
    expect(tab.box.borderRadiiPx).toEqual([5, 5, 0, 0]);
    const [fill] = boxStylePathBlocks(tab.bbox.x, tab.bbox.y, tab.bbox.width, tab.bbox.height, tab.box);
    expect(fill!.fill).toBe('#336699');
    const cmds = fill!.subpaths[0]!;
    // Two rounded corners are two curves; the square foot has none.
    expect(cmds.filter((c) => c.op === 'C')).toHaveLength(2);
    expect(boxOutline(tab.bbox, tab.box.borderRadiiPx!).vertices.map((v) => v.r)).toEqual([5, 5, 0, 0]);
  });
});

describe('a joined tab with its own radius (#1102)', () => {
  const joined = (extra: Record<string, unknown> = {}, position = 'top-left') => build({
    borderRadius: pt(6),
    border: { enabled: true, color: hex('#336699'), width: pt(1) },
    label: label({ position, joined: true, inset: pt(12), ...extra }),
  });

  it('copies the box corner when it sets none, as before', () => {
    expect(paths(joined({ borderRadius: pt(6) }))[0]!.subpaths).toEqual(paths(joined())[0]!.subpaths);
  });

  it('rounds its outer corners with their own radii, the fillets kept', () => {
    const own = paths(joined({ borderRadius: { topLeft: pt(2), topRight: pt(0) } }))[0]!;
    const base = paths(joined())[0]!;
    expect(own.subpaths).not.toEqual(base.subpaths);
    // One curve fewer: the tab's square top-right corner.
    const curves = (p: VDTDesignPathBlock) => p.subpaths[0]!.filter((c) => c.op === 'C').length;
    expect(curves(own)).toBe(curves(base) - 1);
  });

  it('builds the outline with a radius per outer corner', () => {
    const box = createBoundingBox(0, 0, 200, 100);
    const radii = [6, 6, 6, 6] as const;
    const head = boxOutline(box, radii, { edge: 'top', x0: 20, x1: 80, height: 14, radius: [2, 7], fillet: 6 });
    const tabTop = head.vertices.filter((v) => v.y === -14);
    expect(tabTop.map((v) => [v.x, v.r])).toEqual([[20, 2], [80, 7]]);
    // The fillets keep their own radius.
    expect(head.vertices.filter((v) => v.concave).map((v) => v.r)).toEqual([6, 6]);
    const foot = boxOutline(box, radii, { edge: 'bottom', x0: 20, x1: 80, height: 14, radius: [3, 7], fillet: 6 });
    const tabFoot = foot.vertices.filter((v) => v.y === 114);
    // Walked clockwise: the right corner (at x1) first.
    expect(tabFoot.map((v) => [v.x, v.r])).toEqual([[80, 7], [20, 3]]);
    // A tall radius is clamped to the tab, as the single one was.
    const tall = boxOutline(box, radii, { edge: 'top', x0: 20, x1: 80, height: 14, radius: [40, 40], fillet: 6 });
    expect(tall.vertices.filter((v) => v.y === -14).map((v) => v.r)).toEqual([8, 8]);
  });

  it('takes the foot corners for a tab at the foot', () => {
    const own = paths(joined({ borderRadius: { bottomLeft: pt(0), bottomRight: pt(0), topLeft: pt(9) } }, 'bottom-left'))[0]!;
    const base = paths(joined({}, 'bottom-left'))[0]!;
    const curves = (p: VDTDesignPathBlock) => p.subpaths[0]!.filter((c) => c.op === 'C').length;
    expect(curves(own)).toBe(curves(base) - 2);
  });
});
