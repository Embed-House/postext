import { describe, expect, it } from 'vitest';
import { resolvePageTemplate, type PostextConfig } from 'postext';
import { templateSheet } from './templateSheet';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const config: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(200), height: mm(280), margins: { top: mm(20), bottom: mm(20), left: mm(25), right: mm(15), mirror: true } } as never,
  pageTemplates: [
    { id: 'one', frames: [{ name: 'a', width: mm(60), height: mm(40), next: 'b' }, { name: 'b', placement: { anchor: { to: '#a', edge: 'right-of' }, offset: { x: mm(5) } }, width: mm(50), height: mm(40) }] },
    { id: 'two', spread: true, gutter: mm(10), frames: [{ name: 'wide', height: mm(50) }] },
  ],
};

describe('templateSheet', () => {
  it('draws a page with its margins, the frames and their chain', () => {
    const s = templateSheet(config, resolvePageTemplate(config, 'one')!);
    expect(s.width).toBe(200);
    expect(s.content[0]).toEqual({ x: 25, y: 20, width: 160, height: 240 });
    expect(s.frames.find((f) => f.name === 'b')!.rect.x).toBeCloseTo(25 + 60 + 5);
    expect(s.chains).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('mirrors the margins on a verso', () => {
    const s = templateSheet(config, resolvePageTemplate(config, 'one', { parity: 'verso' })!, 'verso');
    expect(s.content[0]!.x).toBe(15);
  });

  it('draws a spread as one sheet with the gutter marked', () => {
    const s = templateSheet(config, resolvePageTemplate(config, 'two')!);
    expect(s.width).toBe(400);
    expect(s.pages).toHaveLength(2);
    expect(s.gutter).toEqual({ x: 195, y: 0, width: 10, height: 280 });
    const wide = s.frames[0]!.rect;
    expect(wide.x).toBe(15);
    expect(wide.width).toBe(400 - 15 - 15);
  });
});
