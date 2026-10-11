import { describe, expect, it } from 'vitest';
import { canonicalSteps, formatPath, getAtPath, identityKeyOf, leafEntries, mergePatch, parsePath, patchPaths, setAtPath } from './configPaths';

const config = {
  page: { margins: { top: { value: 2, unit: 'cm' } }, dpi: 300 },
  headingStyles: [{ id: 'chapter', fontSize: 24 }, { id: 'section', fontSize: 16 }],
};

describe('parsePath', () => {
  it('reads keys, positions and ids', () => {
    expect(parsePath('page.margins.top')).toEqual([{ key: 'page' }, { key: 'margins' }, { key: 'top' }]);
    expect(parsePath('headingStyles[1].fontSize')).toEqual([{ key: 'headingStyles' }, { index: 1 }, { key: 'fontSize' }]);
    expect(parsePath('calloutStyles[id=note].title')).toEqual([{ key: 'calloutStyles' }, { where: 'id', value: 'note' }, { key: 'title' }]);
    expect(parsePath('headings.levels[level=2]')).toEqual([{ key: 'headings' }, { key: 'levels' }, { where: 'level', value: '2' }]);
    expect(formatPath(parsePath('headings.levels[level=2].fontSize[0]'))).toBe('headings.levels[level=2].fontSize[0]');
    expect(parsePath('')).toEqual([]);
  });

  it('refuses what is not a path', () => {
    expect(() => parsePath('page..top')).toThrow(/not a setting path/);
    expect(() => parsePath('page[x]')).toThrow(/not a setting path/);
  });
});

describe('getAtPath', () => {
  it('follows keys, positions and ids', () => {
    expect(getAtPath(config, 'page.margins.top.value')).toBe(2);
    expect(getAtPath(config, 'headingStyles[1].fontSize')).toBe(16);
    expect(getAtPath(config, 'headingStyles[id=chapter].fontSize')).toBe(24);
    expect(getAtPath(config, 'page.margins.bottom')).toBeUndefined();
    expect(getAtPath(config, 'bodyText.fontSize')).toBeUndefined();
    expect(getAtPath(config, '')).toBe(config);
  });
});

describe('setAtPath', () => {
  it('writes without touching what it was given', () => {
    const next = setAtPath(config, 'page.margins.bottom', { value: 3, unit: 'cm' });
    expect(getAtPath(next, 'page.margins.bottom')).toEqual({ value: 3, unit: 'cm' });
    expect(getAtPath(next, 'page.margins.top')).toBe(config.page.margins.top);
    expect(next.headingStyles).toBe(config.headingStyles);
    expect(config.page.margins).not.toHaveProperty('bottom');
  });

  it('makes the sections on the way', () => {
    expect(setAtPath({}, 'bodyText.hyphenation.enabled', false)).toEqual({ bodyText: { hyphenation: { enabled: false } } });
  });

  it('removes a setting, and the sections that leaves empty', () => {
    expect(setAtPath(config, 'page.dpi', undefined)).toEqual({ ...config, page: { margins: config.page.margins } });
    expect(setAtPath(config, 'page.margins.top', undefined)).toEqual({ ...config, page: { dpi: 300 } });
    expect(setAtPath({ page: { dpi: 300 } }, 'page.dpi', undefined)).toEqual({});
    expect(setAtPath(config, 'bodyText.fontSize', undefined)).toEqual(config);
  });

  it('writes list items by position and by id', () => {
    expect(getAtPath(setAtPath(config, 'headingStyles[0].fontSize', 30), 'headingStyles[id=chapter].fontSize')).toBe(30);
    expect(getAtPath(setAtPath(config, 'headingStyles[id=section].fontSize', 14), 'headingStyles[1]')).toEqual({ id: 'section', fontSize: 14 });
    // An id the list does not hold yet is a new item, at the end.
    expect(setAtPath(config, 'headingStyles[id=part].fontSize', 40).headingStyles[2]).toEqual({ id: 'part', fontSize: 40 });
    expect(setAtPath(config, 'headingStyles[2]', { id: 'x' }).headingStyles).toHaveLength(3);
    expect(setAtPath(config, 'headingStyles[0]', undefined).headingStyles).toEqual([{ id: 'section', fontSize: 16 }]);
    expect(() => setAtPath(config, 'headingStyles[5].fontSize', 1)).toThrow(/next free position is \[2\]/);
  });

  it('says when the path runs through something that is not there to hold it', () => {
    expect(() => setAtPath(config, 'page.dpi.value', 1)).toThrow(/page\.dpi is not an object/);
    expect(() => setAtPath(config, 'page[0]', 1)).toThrow(/is not a list/);
  });
});

describe('lists whose items have a name', () => {
  const resolved = { headings: { levels: [{ level: 1, size: 18 }, { level: 2, size: 15 }] }, brackets: [{ open: '<' }, { open: '«' }] };

  it('are told apart by id or by level, the others by position', () => {
    expect(identityKeyOf(config.headingStyles)).toBe('id');
    expect(identityKeyOf(resolved.headings.levels)).toBe('level');
    expect(identityKeyOf(resolved.brackets)).toBeNull();
    expect(identityKeyOf([{ id: 'a' }, { id: 'a' }])).toBeNull();
  });

  it('a position in the resolved list is the item it names, whatever a book stores', () => {
    const path = formatPath(canonicalSteps(resolved, parsePath('headings.levels[1].size')));
    expect(path).toBe('headings.levels[level=2].size');
    // A book that only stores level 2 holds it at position 0.
    const stored = { headings: { levels: [{ level: 2, size: 20 }] } };
    expect(getAtPath(stored, path)).toBe(20);
    expect(formatPath(canonicalSteps(resolved, parsePath('brackets[1].open')))).toBe('brackets[1].open');
    expect(formatPath(canonicalSteps(resolved, parsePath('nothing[3].here')))).toBe('nothing[3].here');
  });

  it('a new item starts from what names it, a number where the others carry numbers', () => {
    expect(setAtPath({ headings: { levels: [{ level: 2, size: 20 }] } }, 'headings.levels[level=3].size', 12).headings.levels).toEqual([{ level: 2, size: 20 }, { level: 3, size: 12 }]);
    expect(setAtPath({}, 'headings.levels[level=3].size', 12)).toEqual({ headings: { levels: [{ level: 3, size: 12 }] } });
    expect(setAtPath({}, 'styles[id=7].size', 12)).toEqual({ styles: [{ id: '7', size: 12 }] });
  });

  it('removing from an item the list does not hold changes nothing', () => {
    expect(setAtPath(config, 'headingStyles[id=part].fontSize', undefined)).toEqual(config);
  });

  it('lists every leaf by its path', () => {
    expect([...leafEntries({ ...resolved, empty: {}, none: [] }).keys()]).toEqual([
      'headings.levels[level=1].level', 'headings.levels[level=1].size', 'headings.levels[level=2].level', 'headings.levels[level=2].size',
      'brackets[0].open', 'brackets[1].open', 'empty', 'none',
    ]);
  });
});

describe('mergePatch', () => {
  it('merges objects, removes on null and replaces lists', () => {
    const next = mergePatch(config, { page: { dpi: null, margins: { top: { value: 1 } } }, headingStyles: [], locale: 'es' });
    expect(next).toEqual({ page: { margins: { top: { value: 1, unit: 'cm' } } }, headingStyles: [], locale: 'es' });
    expect(config.page.dpi).toBe(300);
  });

  it('lists the paths a patch writes', () => {
    expect(patchPaths({ page: { dpi: null, margins: { top: { value: 1 } } }, headingStyles: [] })).toEqual(['page.dpi', 'page.margins.top.value', 'headingStyles']);
  });
});
