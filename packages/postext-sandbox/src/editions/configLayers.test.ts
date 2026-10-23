import { describe, expect, it } from 'vitest';
import { defaultResourceTypes, overridePaths, sameConfig, type PostextConfig } from 'postext';
import { editionOverride, initialSharedConfig, pathsMeet, promoteFields, rebaseEdition, rebaseEditions, recordSharedConfig, removePaths, withoutOwnFields } from './configLayers.js';

// #1209: general settings and each edition's own fields, in the Sandbox.

const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

const en: PostextConfig = {
  locale: 'en',
  resourceTypes: defaultResourceTypes('en'),
  bodyText: { fontFamily: 'Lora', fontSize: pt(11) },
  calloutStyles: [{ id: 'note', background: hex('#eeeeee') }],
} as PostextConfig;
const shared = initialSharedConfig(en);
const es: PostextConfig = { ...en, locale: 'es', resourceTypes: defaultResourceTypes('es') } as PostextConfig;
const ar: PostextConfig = { ...en, locale: 'ar', resourceTypes: defaultResourceTypes('ar'), bodyText: { fontFamily: 'Amiri', fontSize: pt(11) } } as PostextConfig;

describe('general settings of a book in several languages', () => {
  it('start from the primary edition, its language and built-in wording aside', () => {
    expect(shared.locale).toBeUndefined();
    expect(shared.bodyText).toEqual(en.bodyText);
    expect(shared.resourceTypes?.every((t) => t.name === undefined)).toBe(true);
  });

  it('give each edition only the fields it sets differently', () => {
    expect(overridePaths(editionOverride(shared, en))).toEqual(['locale']);
    expect(overridePaths(editionOverride(shared, es))).toEqual(['locale']);
    expect(overridePaths(editionOverride(shared, ar)).sort()).toEqual(['bodyText.fontFamily', 'locale']);
  });

  it('rebase an edition on new general settings, keeping its own fields and wording', () => {
    const after = { ...shared, bodyText: { ...shared.bodyText, fontSize: pt(12) }, calloutStyles: [{ id: 'note', background: hex('#ffeecc') }] } as PostextConfig;
    const nextAr = rebaseEdition(shared, after, ar);
    expect(nextAr.bodyText).toEqual({ fontFamily: 'Amiri', fontSize: pt(12) });
    expect(nextAr.calloutStyles).toEqual([{ id: 'note', background: hex('#ffeecc') }]);
    expect(nextAr.resourceTypes?.find((t) => t.id === 'figure')?.name).toBe(defaultResourceTypes('ar').find((t) => t.id === 'figure')?.name);
    const nextEs = rebaseEdition(shared, after, es);
    expect(nextEs.resourceTypes?.find((t) => t.id === 'figure')?.name).toBe('Figura');
    const editions = rebaseEditions(shared, after, { ar: { config: ar }, es: { config: es } });
    expect(editions.es!.config.bodyText?.fontSize).toEqual(pt(12));
    expect(rebaseEditions(shared, shared, editions)).toBe(editions);
  });

  it('give an edition the general value back, or make its value general', () => {
    const back = withoutOwnFields(shared, ar, ['bodyText.fontFamily']);
    expect(back.bodyText?.fontFamily).toBe('Lora');
    expect(back.locale).toBe('ar');
    const promoted = promoteFields(shared, ar, ['bodyText.fontFamily']);
    expect(promoted.bodyText?.fontFamily).toBe('Amiri');
    expect(promoted.locale).toBeUndefined();
    expect(overridePaths(editionOverride(promoted, ar))).toEqual(['locale']);
    expect(overridePaths(editionOverride(promoted, es)).sort()).toEqual(['bodyText.fontFamily', 'locale']);
  });

  it('read a stored book: its general settings, else its primary edition', () => {
    expect(recordSharedConfig({ config: en })).toBeNull();
    expect(recordSharedConfig({ config: es, locale: 'es', editions: { en: { config: en } }, editionLocales: ['en', 'es'] })).toEqual(shared);
    expect(recordSharedConfig({ config: es, editions: { en: { config: en } }, sharedConfig: { layout: {} } as PostextConfig })).toEqual({ layout: {} });
    expect(sameConfig(recordSharedConfig({ config: en, locale: 'en', editions: { es: { config: es } }, editionLocales: ['en', 'es'] }), shared)).toBe(true);
  });
});

describe('setting paths', () => {
  it('meet when one holds the other', () => {
    expect(pathsMeet('bodyText', 'bodyText.fontSize')).toBe(true);
    expect(pathsMeet('calloutStyles', 'calloutStyles[id=note].background')).toBe(true);
    expect(pathsMeet('bodyText.font', 'bodyText.fontSize')).toBe(false);
  });

  it('come out of an override with what they hold', () => {
    const o = { bodyText: { fontFamily: 'Amiri', fontSize: null }, calloutStyles: [{ id: 'note', padding: pt(9) }, { id: 'tip', $remove: true }] };
    expect(removePaths(o, ['bodyText.fontSize'])).toEqual({ bodyText: { fontFamily: 'Amiri' }, calloutStyles: [{ id: 'note', padding: pt(9) }, { id: 'tip', $remove: true }] });
    expect(removePaths(o, ['calloutStyles[id=note]', 'calloutStyles[id=tip]'])).toEqual({ bodyText: { fontFamily: 'Amiri', fontSize: null } });
    expect(removePaths(o, ['bodyText'])).toEqual({ calloutStyles: o.calloutStyles });
  });
});

describe('a list entry the general settings drop', () => {
  it('goes from every edition, with what an edition changed of it', () => {
    const before = { calloutStyles: [{ id: 'note', background: hex('#eeeeee'), name: 'Note' }, { id: 'tip' }] } as PostextConfig;
    const after = { calloutStyles: [{ id: 'tip' }] } as PostextConfig;
    const edition = { locale: 'es', calloutStyles: [{ id: 'note', background: hex('#dddddd'), name: 'Note' }, { id: 'tip' }, { id: 'mine', background: hex('#123456') }, { id: 'bare' }] } as PostextConfig;
    expect(rebaseEdition(before, after, edition).calloutStyles).toEqual([{ id: 'tip' }, { id: 'mine', background: hex('#123456') }, { id: 'bare' }]);
  });
});
