import { describe, expect, it } from 'vitest';
import type { VDTComposedPage, VDTFrame } from 'postext';
import { flowBoxOnSheet, frameAtSource, frameById, frameByName, frameCorners, frameHandleAt, frameHitAt, frameIsEmpty, framesTopFirst, pointInFrame, sheetToFlow } from './frameHit.js';

function frame(name: string, rect: VDTFrame['rect'], extra: Partial<VDTFrame> = {}): VDTFrame {
  return { id: `cp0:${name}`, name, rect, rotate: 0, layer: 1, scale: 1, overflowPx: 0, blockIds: [], configPath: '/pageTemplates/0/frames/0', ...extra };
}

function page(frames: VDTFrame[]): { composed: VDTComposedPage } {
  return {
    composed: { template: 't', fenceIndex: 0, role: 'composed', attrs: {}, attrSources: {}, frames, log: [], configPath: '/pageTemplates/0', sourceStart: 0, sourceEnd: 100 },
  };
}

describe('frameHitAt', () => {
  const body = frame('body', { x: 0, y: 0, width: 100, height: 100 }, { sourceStart: 10, sourceEnd: 60 });
  const caption = frame('caption', { x: 20, y: 70, width: 60, height: 20 }, { layer: 2, sourceStart: 30, sourceEnd: 40 });
  const p = page([caption, body]);

  it('finds the frame on top first, by layer', () => {
    expect(frameHitAt(p, 50, 80)?.name).toBe('caption');
    expect(frameHitAt(p, 50, 20)?.name).toBe('body');
    expect(frameHitAt(p, 150, 20)).toBeNull();
  });

  it('at equal layers the later frame of the template is on top', () => {
    const a = frame('a', { x: 0, y: 0, width: 50, height: 50 });
    const b = frame('b', { x: 25, y: 25, width: 50, height: 50 });
    expect(frameHitAt(page([a, b]), 30, 30)?.name).toBe('b');
    expect(framesTopFirst(page([a, b])).map((f) => f.name)).toEqual(['b', 'a']);
  });

  it('is null off a composed page', () => {
    expect(frameHitAt({}, 10, 10)).toBeNull();
    expect(frameHitAt(null, 10, 10)).toBeNull();
  });

  it('follows a turned frame', () => {
    // A 100 × 10 bar turned 90° about its centre (50, 5) stands from y −45 to 55.
    const bar = frame('bar', { x: 0, y: 0, width: 100, height: 10 }, { rotate: 90 });
    expect(pointInFrame(bar, 50, 40)).toBe(true);
    expect(pointInFrame(bar, 90, 5)).toBe(false);
    const corners = frameCorners(bar);
    expect(corners[0].x).toBeCloseTo(55);
    expect(corners[0].y).toBeCloseTo(-45);
  });

  it('looks frames up by id, name and source offset (the narrowest)', () => {
    expect(frameById(p, 'cp0:body')?.name).toBe('body');
    expect(frameByName(p, 'caption')?.id).toBe('cp0:caption');
    expect(frameAtSource(p, 35)?.name).toBe('caption');
    expect(frameAtSource(p, 15)?.name).toBe('body');
    expect(frameAtSource(p, 90)).toBeNull();
  });

  it('tells an empty frame', () => {
    expect(frameIsEmpty(frame('x', { x: 0, y: 0, width: 1, height: 1 }))).toBe(true);
    expect(frameIsEmpty(body)).toBe(false);
    expect(frameIsEmpty(frame('y', { x: 0, y: 0, width: 1, height: 1 }, { continuedFrom: 'cp0:body' }))).toBe(false);
  });

  it('names the resize handle under the pointer', () => {
    expect(frameHandleAt(body, 50, 50, 4)).toBe('move');
    expect(frameHandleAt(body, 0, 50, 4)).toBe('w');
    expect(frameHandleAt(body, 101, 101, 4)).toBe('se');
    expect(frameHandleAt(body, 50, -3, 4)).toBe('n');
    expect(frameHandleAt(body, 200, 200, 4)).toBeNull();
  });
});

describe('frames of a page laid in a flow frame (#929)', () => {
  const W = 1000;
  const rtl = { flow: { writingMode: 'horizontal-tb' as const, direction: 'rtl' as const, mirror: { originX: W } } };
  const vertical = { flow: { writingMode: 'vertical-rl' as const, rotation: { direction: 'cw' as const, originX: W, originY: 0, width: 1400, height: W } } };
  const box = { x: 100, y: 200, width: 300, height: 50 };

  it('maps a sheet point into the flow, the identity without one', () => {
    expect(sheetToFlow(rtl as never, 900, 210)).toEqual({ x: 100, y: 210 });
    expect(sheetToFlow(vertical as never, 900, 210)).toEqual({ x: 210, y: 100 });
    expect(sheetToFlow({} as never, 900, 210)).toEqual({ x: 900, y: 210 });
  });

  it('puts a flow box on the sheet: mirrored with its turn reversed, or turned a quarter keeping it', () => {
    expect(flowBoxOnSheet(rtl as never, box, 12)).toEqual({ rect: { x: 600, y: 200, width: 300, height: 50 }, rotate: -12 });
    expect(flowBoxOnSheet(vertical as never, box, 12)).toEqual({ rect: { x: 750, y: 100, width: 50, height: 300 }, rotate: 12 });
    expect(flowBoxOnSheet(null, box)).toEqual({ rect: box, rotate: 0 });
  });
});
