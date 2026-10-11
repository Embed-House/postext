import { describe, expect, it } from 'vitest';
import { getAtPath, mergePatch, parsePath, patchPaths, setAtPath } from './configPaths';

const config = {
  page: { margins: { top: { value: 2, unit: 'cm' } }, dpi: 300 },
  headingStyles: [{ id: 'chapter', fontSize: 24 }, { id: 'section', fontSize: 16 }],
};

describe('parsePath', () => {
  it('reads keys, positions and ids', () => {
    expect(parsePath('page.margins.top')).toEqual([{ key: 'page' }, { key: 'margins' }, { key: 'top' }]);
    expect(parsePath('headingStyles[1].fontSize')).toEqual([{ key: 'headingStyles' }, { index: 1 }, { key: 'fontSize' }]);
    expect(parsePath('calloutStyles[id=note].title')).toEqual([{ key: 'calloutStyles' }, { id: 'note' }, { key: 'title' }]);
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
