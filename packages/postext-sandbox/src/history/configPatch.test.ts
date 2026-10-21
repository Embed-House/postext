import { describe, expect, it } from 'vitest';
import { applyPatch, carryPatch, diffConfig, formatPatchPath, patchCovers, patchIsEmpty, patchSettingPaths, patchTopKeys } from './configPatch.js';

const mm = (value: number) => ({ value, unit: 'mm' });

describe('config patches', () => {
  const before = {
    page: { width: mm(120), margins: { top: mm(10), bottom: mm(12) } },
    pageTemplates: [{ id: 'tema', frames: [{ name: 'titulo', width: mm(170) }, { name: 'texto', flow: true }] }],
    headings: { levels: [{ level: 1, fontSize: { value: 20, unit: 'pt' } }] },
  };

  it('names the leaves that changed, and nothing equal in content', () => {
    const after = {
      ...before,
      page: { ...before.page, margins: { ...before.page.margins, top: mm(14) } },
      pageTemplates: [{ ...before.pageTemplates[0]!, frames: [{ name: 'titulo', width: mm(160) }, { name: 'texto', flow: true }] }],
      headings: JSON.parse(JSON.stringify(before.headings)),
    };
    const patch = diffConfig(before, after);
    expect(patch.map((op) => op.path)).toEqual([
      ['page', 'margins', 'top', 'value'],
      ['pageTemplates', 0, 'frames', 0, 'width', 'value'],
    ]);
    expect(applyPatch(after, patch, 'before')).toEqual(before);
    expect(applyPatch(before, patch, 'after')).toEqual(after);
    expect(patchTopKeys(patch)).toEqual(['page', 'pageTemplates']);
  });

  it('takes a list that grew or shrank whole, and a key added or removed', () => {
    const after = { ...before, pageTemplates: [...before.pageTemplates, { id: 'otra', frames: [] }], footnotes: { rule: true } };
    const patch = diffConfig(before, after);
    expect(patch.map((op) => op.path)).toEqual([['pageTemplates'], ['footnotes']]);
    const back = applyPatch(after, patch, 'before');
    expect(back).toEqual(before);
    expect('footnotes' in back).toBe(false);
  });

  it('only walks the keys an UPDATE_CONFIG writes', () => {
    const after = { ...before, page: { ...before.page, width: mm(130) }, stray: 1 };
    expect(diffConfig(before, after, ['page']).map((op) => op.path)).toEqual([['page', 'width', 'value']]);
  });

  it('puts the leaves back on a configuration that changed elsewhere since', () => {
    const after = { ...before, page: { ...before.page, width: mm(130) } };
    const patch = diffConfig(before, after);
    const later = { ...after, headings: { levels: [] } };
    expect(applyPatch(later, patch, 'before')).toEqual({ ...before, headings: { levels: [] } });
  });

  it('carries a step on over the writes it covers, and sees one that comes back', () => {
    const one = { ...before, page: { ...before.page, width: mm(1) } };
    const first = diffConfig(before, one);
    const two = { ...before, page: { ...before.page, width: mm(13) } };
    const second = diffConfig(one, two);
    expect(patchCovers(first, second)).toBe(true);
    const carried = carryPatch(first, two);
    expect(applyPatch(two, carried, 'before')).toEqual(before);
    expect(patchIsEmpty(carryPatch(first, before))).toBe(true);
    // A branch made by the first write covers the leaves under it.
    const made = diffConfig({}, { bodyText: { fontSize: mm(1) } });
    expect(patchCovers(made, diffConfig({ bodyText: { fontSize: mm(1) } }, { bodyText: { fontSize: mm(12) } }))).toBe(true);
    expect(patchCovers(first, diffConfig(before, { ...before, headings: {} }))).toBe(false);
  });

  it('names the settings as the tools write them', () => {
    expect(formatPatchPath(before, ['pageTemplates', 0, 'frames', 1, 'flow'])).toBe('pageTemplates[id=tema].frames[1].flow');
    expect(formatPatchPath(before, ['headings', 'levels', 0, 'fontSize'])).toBe('headings.levels[level=1].fontSize');
    const added = diffConfig({}, { bodyText: { fontSize: mm(11), lineHeight: mm(5) } });
    expect(patchSettingPaths({}, added)).toEqual(['bodyText.fontSize', 'bodyText.lineHeight']);
  });
});
