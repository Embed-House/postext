import { describe, expect, it } from 'vitest';
import type { Resource } from 'postext';
import { applyTextChanges } from '../book/textChanges';
import { labelStyleRefs, labelStyleUsage, renameAnchorStyle, renameLabelStyleChanges } from './labelRefs';

const MD = [
  ':::figure{resource="map" slot="map"}',
  '::label[Madrid]{at="madrid" style="city"}',
  "::label[Rio]{at=\"rio\" style='river'}",
  '::label[Plain]{at="p"}',
  '::label[Cities [capital]]{at="x" style=city}',
  ':::',
  '',
  '```',
  '::label[Not a label]{style="city"}',
  '```',
  '',
  'Text ::label[inline]{style="city"} is no label line.',
].join('\n');

describe('the label styles a text names (#994)', () => {
  it('finds the style of each label line, in quotes or bare, and skips code and prose', () => {
    expect(labelStyleRefs(MD).map((r) => r.style)).toEqual(['city', 'river', 'city']);
    for (const r of labelStyleRefs(MD)) expect(MD.slice(r.from, r.to)).toBe(r.style);
  });

  it('renames the style on every label line that names it and nothing else', () => {
    const next = applyTextChanges(MD, renameLabelStyleChanges(MD, 'city', 'town'));
    expect(next).toContain('{at="madrid" style="town"}');
    expect(next).toContain('{at="x" style=town}');
    expect(next).toContain("style='river'");
    // Code and prose keep the old id.
    expect(next).toContain('::label[Not a label]{style="city"}');
    expect(next).toContain('Text ::label[inline]{style="city"}');
  });

  it('renames the style of the anchors that name it and returns only those resources', () => {
    const resources = [
      { id: 'a', anchors: [{ id: 'x', x: 0, y: 0, style: 'city' }, { id: 'y', x: 0, y: 0, style: 'river' }] },
      { id: 'b', anchors: [{ id: 'z', x: 0, y: 0 }] },
    ] as unknown as Resource[];
    const out = renameAnchorStyle(resources, 'city', 'town');
    expect(out.map((r) => r.id)).toEqual(['a']);
    expect(out[0]!.anchors!.map((x) => x.style)).toEqual(['town', 'river']);
    expect(resources[0]!.anchors![0]!.style).toBe('city');
  });

  it('counts anchors and label lines per style', () => {
    const resources = [{ id: 'a', anchors: [{ id: 'x', x: 0, y: 0, style: 'city' }] }] as unknown as Resource[];
    const use = labelStyleUsage(resources, [labelStyleRefs(MD)]);
    expect(use.get('city')).toEqual({ anchors: 1, lines: 2 });
    expect(use.get('river')).toEqual({ anchors: 0, lines: 1 });
  });
});
