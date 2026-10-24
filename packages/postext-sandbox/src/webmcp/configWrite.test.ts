import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { coerceSetting, resolveEffectiveConfig } from './configEffective.js';
import { getAtPath } from './configPaths.js';
import { planWrite } from './configWrite.js';
import './tools/testHarness.js';

const resolve = (config: PostextConfig) => resolveEffectiveConfig(config, 'en');

/** `config` with `value` written at `path`, and what it resolves to. */
function write(config: PostextConfig, path: string, value: unknown) {
  const plan = planWrite(config, resolve(config), path, value, resolve);
  return { ...plan, resolved: resolve(plan.next) };
}

describe('a setting written into a book that stores none of its own', () => {
  it('goes into a section as that member alone', () => {
    const { next, seeded } = write({}, 'bodyText.hyphenation.enabled', false);
    expect(next).toEqual({ bodyText: { hyphenation: { enabled: false } } });
    expect(seeded).toBeUndefined();
  });

  it('takes the rest of a length along', () => {
    const { next, resolved, seeded } = write({}, 'page.width.value', 20);
    expect(next).toEqual({ page: { width: { value: 20, unit: 'cm' } } });
    expect(getAtPath(resolved, 'page.width')).toEqual({ value: 20, unit: 'cm' });
    expect(seeded).toEqual(['page.width']);
  });

  it('overrides one level of the headings and leaves the others to the design', () => {
    const before = resolve({});
    const { next, resolved, path } = write({}, 'headings.levels[1].fontSize.value', 20);
    expect(path).toBe('headings.levels[level=2].fontSize.value');
    expect(next.headings?.levels).toEqual([{ level: 2, fontSize: { value: 20, unit: 'pt' } }]);
    expect(getAtPath(resolved, 'headings.levels[level=2].fontSize.value')).toBe(20);
    expect(getAtPath(resolved, 'headings.levels[level=1]')).toEqual(getAtPath(before, 'headings.levels[level=1]'));
    expect(getAtPath(resolved, 'headings.levels[level=3]')).toEqual(getAtPath(before, 'headings.levels[level=3]'));
  });

  it('writes the running head as designed before changing one of its elements', () => {
    const before = resolve({});
    const { next, resolved, seeded } = write({}, 'header.elements[id=titleOdd].fontSize.value', 9);
    expect(seeded).toEqual(['header']);
    expect(next.header?.elements).toHaveLength((getAtPath(before, 'header.elements') as unknown[]).length);
    expect(getAtPath(resolved, 'header.elements[id=titleOdd].fontSize')).toEqual({ value: 9, unit: 'pt' });
    expect(getAtPath(resolved, 'header.elements[id=rule].thickness')).toEqual(getAtPath(before, 'header.elements[id=rule].thickness'));
    expect(getAtPath(resolved, 'header.elements[id=titleOdd].content')).toBe(getAtPath(before, 'header.elements[id=titleOdd].content'));
  });

  it('keeps the name of the built-in callout style, and its text following the body text', () => {
    const { next, resolved } = write({}, 'calloutStyles[id=note].floatBarrier', true);
    expect(next.calloutStyles).toEqual([{ id: 'note', name: 'Note', floatBarrier: true }]);
    expect(getAtPath(resolved, 'calloutStyles[id=note].name')).toBe('Note');
  });

  it('keeps the name of the built-in exercise style, and its other settings to the language (#1226)', () => {
    const { next, resolved } = write({}, 'exerciseStyles[id=exercise].number.shape', 'disc');
    expect(next.exerciseStyles).toEqual([{ id: 'exercise', name: 'Exercise', number: { shape: 'disc' } }]);
    expect(getAtPath(resolved, 'exerciseStyles[id=exercise].name')).toBe('Exercise');
    expect(write({}, 'exercises.digital.check', 'instant').next).toEqual({ exercises: { digital: { check: 'instant' } } });
  });

  it('starts a list told apart by position from the resolved one', () => {
    const before = resolve({});
    const { resolved } = write({}, 'cjk.bookTitleBrackets[1].open', '<');
    expect(getAtPath(resolved, 'cjk.bookTitleBrackets[1].open')).toBe('<');
    expect(getAtPath(resolved, 'cjk.bookTitleBrackets[0]')).toEqual(getAtPath(before, 'cjk.bookTitleBrackets[0]'));
  });

  it('reaches the sections the engine resolves only when a book sets them', () => {
    expect(getAtPath(resolve({}), 'print.preflight.enabled')).toBeTypeOf('boolean');
    expect(getAtPath(resolve({}), 'folio.paper')).toBeTypeOf('object');
    expect(getAtPath(resolve({}), 'comics.lettering')).toBeTypeOf('object');
    const { next } = write({}, 'pdfGeneration.accessible', true);
    expect(next).toEqual({ pdfGeneration: { accessible: true } });
  });
});

describe('a setting the book already stores', () => {
  it('is written where it is', () => {
    const config: PostextConfig = { page: { width: { value: 12, unit: 'cm' } } };
    expect(write(config, 'page.width.value', 13).next).toEqual({ page: { width: { value: 13, unit: 'cm' } } });
  });

  it('is found by its level in a list that stores only some levels', () => {
    const config: PostextConfig = { headings: { levels: [{ level: 3, italic: true }] } };
    const { next } = write(config, 'headings.levels[2].italic', false);
    expect(next.headings?.levels).toEqual([{ level: 3, italic: false }]);
  });

  it('is removed, a part of a length taking the whole length with it', () => {
    const config: PostextConfig = { page: { width: { value: 12, unit: 'cm' } }, bodyText: { fontWeight: 500 } };
    const gone = write(config, 'page.width.value', undefined);
    expect(gone.next).toEqual({ bodyText: { fontWeight: 500 } });
    expect(gone.path).toBe('page.width');
    expect(write(config, 'bodyText.fontWeight', undefined).next).toEqual({ page: config.page });
  });
});

describe('the shape of a value', () => {
  const length = { value: 2, unit: 'cm' };

  it('a length takes a number, a text or an object', () => {
    expect(coerceSetting('p', 3, length)).toEqual({ value: 3, unit: 'cm' });
    expect(coerceSetting('p', '11pt', length)).toEqual({ value: 11, unit: 'pt' });
    expect(coerceSetting('p', ' 0.5 mm', length)).toEqual({ value: 0.5, unit: 'mm' });
    expect(coerceSetting('p', { value: 4 }, length)).toEqual({ value: 4, unit: 'cm' });
    expect(() => coerceSetting('page.width', 'wide', length)).toThrow(/page\.width is a length: give \{ "value": 2, "unit": "cm" \}/);
    expect(() => coerceSetting('page.width', '3 furlongs', length)).toThrow(/The units: cm, mm, in, pt, px, em, rem/);
  });

  it('a colour takes a hex text or an object', () => {
    const colour = { hex: '#000000', model: 'hex' };
    expect(coerceSetting('c', '#ABC', colour)).toEqual({ hex: '#aabbcc', model: 'hex' });
    expect(coerceSetting('c', '1f3a5f', colour)).toEqual({ hex: '#1f3a5f', model: 'hex' });
    expect(coerceSetting('c', { hex: '#fff', paletteId: 'main' }, colour)).toEqual({ hex: '#fff', model: 'hex', paletteId: 'main' });
    expect(() => coerceSetting('c', 'navy', colour)).toThrow(/is a colour/);
  });

  it('a switch, a number, a text, a list and an object take their own kind', () => {
    expect(() => coerceSetting('a.enabled', 1, true)).toThrow(/a\.enabled takes true or false, and the value given is a number\. It is true now\./);
    expect(() => coerceSetting('a.columns', true, 2)).toThrow(/takes a number/);
    expect(() => coerceSetting('a.font', { family: 'x' }, 'Serif')).toThrow(/takes a text/);
    expect(() => coerceSetting('a.items', 'x', [])).toThrow(/takes a list/);
    expect(() => coerceSetting('a.box', 3, { top: 1 })).toThrow(/takes an object \(its members: top\)/);
    // A keyword where the setting resolves to a switch or a number.
    expect(coerceSetting('a.hyphenateAcrossColumns', 'withinPage', false)).toBe('withinPage');
    expect(coerceSetting('cjk.trimLineStart', 'auto', true)).toBe('auto');
    expect(() => coerceSetting('a.enabled', 'no', true)).toThrow(/takes true or false, and the value given is a string/);
    expect(() => coerceSetting('cjk.trimLineStart', 'no', true)).toThrow(/takes true, false or "auto"/);
    expect(coerceSetting('a.words', 'line', 3)).toBe('line');
    // A setting the engine has no value for takes what it is given.
    expect(coerceSetting('a.new', { any: 1 }, undefined)).toEqual({ any: 1 });
  });
});
