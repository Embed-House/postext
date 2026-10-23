import { describe, it, expect } from 'vitest';
import { commonConfig, diffConfigLayers, mergeConfigLayers, overridePaths, sameConfig } from '../../defaults/configLayers.js';
import { migrateBundleConfig } from '../../bundle/configVersion.js';
import { planBundle, readBundle } from '../../bundle/codec.js';
import type { PostextConfig } from '../../types.js';

// #1209: a book's configuration as general settings plus, per language, an
// override merged field by field.

const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

const general: PostextConfig = {
  bodyText: { fontFamily: 'Lora', fontSize: pt(11), color: hex('#222222') },
  calloutStyles: [
    { id: 'note', background: hex('#eeeeee'), padding: pt(6) },
    { id: 'tip', background: hex('#ddffdd') },
  ],
  headings: { levels: [{ level: 1, fontSize: pt(24) }, { level: 2, fontSize: pt(18) }] },
} as PostextConfig;

describe('mergeConfigLayers', () => {
  it('merges objects field by field and keyed lists entry by entry', () => {
    const merged = mergeConfigLayers(general, {
      bodyText: { fontFamily: 'Amiri' },
      calloutStyles: [{ id: 'note', padding: pt(8) }, { id: 'warn', background: hex('#ffdddd') }],
      headings: { levels: [{ level: 2, fontSize: pt(20) }] },
    });
    expect(merged.bodyText).toEqual({ fontFamily: 'Amiri', fontSize: pt(11), color: hex('#222222') });
    expect(merged.calloutStyles).toEqual([
      { id: 'note', background: hex('#eeeeee'), padding: pt(8) },
      { id: 'tip', background: hex('#ddffdd') },
      { id: 'warn', background: hex('#ffdddd') },
    ]);
    expect(merged.headings?.levels).toEqual([{ level: 1, fontSize: pt(24) }, { level: 2, fontSize: pt(20) }]);
    // The general layer is untouched.
    expect(general.bodyText?.fontFamily).toBe('Lora');
  });

  it('replaces colours and lengths whole', () => {
    const merged = mergeConfigLayers(general, { bodyText: { color: { hex: '#000000', model: 'cmyk', cmyk: { c: 0, m: 0, y: 0, k: 100 } } } });
    expect(merged.bodyText?.color).toEqual({ hex: '#000000', model: 'cmyk', cmyk: { c: 0, m: 0, y: 0, k: 100 } });
    const back = mergeConfigLayers({ bodyText: { color: { hex: '#000000', model: 'cmyk', cmyk: { c: 0, m: 0, y: 0, k: 100 } } } } as PostextConfig, { bodyText: { color: hex('#333333') } });
    expect(back.bodyText?.color).toEqual(hex('#333333'));
  });

  it('reads null as the default and $remove as no entry', () => {
    const merged = mergeConfigLayers(general, { bodyText: { fontSize: null }, calloutStyles: [{ id: 'tip', $remove: true }] });
    expect(merged.bodyText).toEqual({ fontFamily: 'Lora', color: hex('#222222') });
    expect(merged.calloutStyles?.map((s) => s.id)).toEqual(['note']);
  });

  it('returns the general settings themselves with no override', () => {
    expect(mergeConfigLayers(general, {})).toBe(general);
    expect(mergeConfigLayers(general, undefined)).toBe(general);
  });
});

describe('diffConfigLayers', () => {
  const editions: PostextConfig[] = [
    general,
    mergeConfigLayers(general, { bodyText: { fontFamily: 'Amiri', fontSize: null } }),
    { ...general, calloutStyles: [general.calloutStyles![1]!, { id: 'note', background: hex('#000000') }] } as PostextConfig,
    { bodyText: { fontFamily: 'Noto Serif JP' } } as PostextConfig,
    { ...general, calloutStyles: [{ id: 'note', background: hex('#eeeeee'), padding: pt(6) }, { id: 'new' }] } as PostextConfig,
  ];

  it('is the override that rebuilds the edition', () => {
    for (const own of editions) {
      const override = diffConfigLayers(general, own);
      expect(sameConfig(mergeConfigLayers(general, override), own)).toBe(true);
    }
  });

  it('names only the fields that differ', () => {
    expect(diffConfigLayers(general, general)).toEqual({});
    const own = mergeConfigLayers(general, { calloutStyles: [{ id: 'note', padding: pt(9) }] });
    expect(diffConfigLayers(general, own)).toEqual({ calloutStyles: [{ id: 'note', padding: pt(9) }] });
    expect(overridePaths(diffConfigLayers(general, own))).toEqual(['calloutStyles[id=note].padding']);
  });
});

describe('commonConfig', () => {
  it('keeps what every edition sets the same', () => {
    const es = mergeConfigLayers(general, { bodyText: { fontFamily: 'Lora' }, locale: 'es' } as never);
    const ar = mergeConfigLayers(general, { bodyText: { fontFamily: 'Amiri' }, locale: 'ar', calloutStyles: [{ id: 'note', padding: pt(9) }] } as never);
    const shared = commonConfig([es, ar]);
    expect(shared.locale).toBeUndefined();
    expect(shared.bodyText).toEqual({ fontSize: pt(11), color: hex('#222222') });
    expect(shared.calloutStyles).toEqual([{ id: 'note', background: hex('#eeeeee') }, { id: 'tip', background: hex('#ddffdd') }]);
    for (const own of [es, ar]) expect(sameConfig(mergeConfigLayers(shared, diffConfigLayers(shared, own)), own)).toBe(true);
  });
});

describe('locale layer in a bundle', () => {
  const shared = { bodyText: { fontFamily: 'Lora', fontSize: pt(11) } } as PostextConfig;
  const locale = { bodyText: { fontFamily: 'Amiri' } } as PostextConfig;

  it('merges field by field under rules 21', () => {
    expect(migrateBundleConfig({}, [shared, locale], 21).bodyText).toEqual({ fontFamily: 'Amiri', fontSize: pt(11) });
  });

  it('replaces top-level keys under older rules', () => {
    expect(migrateBundleConfig({}, [shared, locale], 20).bodyText?.fontSize).toBeUndefined();
  });

  it('round-trips general settings and per-language overrides', async () => {
    const sharedConfig = { bodyText: { fontFamily: 'Lora', fontSize: pt(12) }, calloutStyles: [{ id: 'note', background: hex('#eeeeee') }] } as PostextConfig;
    const es = mergeConfigLayers(sharedConfig, { locale: 'es' });
    const ar = mergeConfigLayers(sharedConfig, { locale: 'ar', bodyText: { fontFamily: 'Amiri' }, calloutStyles: [{ id: 'note', background: hex('#ffeecc') }] });
    const plan = planBundle(
      { id: 'b', name: 'Book', locale: 'es' },
      {
        chapters: [{ title: 'Uno', markdown: '# Uno\n\nTexto.' }],
        config: es,
        sharedConfig,
        resources: [],
        localized: { ar: { chapters: [{ title: 'واحد', markdown: '# واحد\n\nنص.' }], config: ar } },
      },
    );
    const { manifest } = plan;
    expect(manifest.config).toEqual({ bodyText: { fontFamily: 'Lora', fontSize: pt(12) }, calloutStyles: [{ id: 'note', background: hex('#eeeeee') }] });
    expect(manifest.localized?.es?.config).toEqual({ locale: 'es' });
    expect(manifest.localized?.ar?.config).toEqual({ locale: 'ar', bodyText: { fontFamily: 'Amiri' }, calloutStyles: [{ id: 'note', background: hex('#ffeecc') }] });

    const files = new Map<string, ArrayBuffer>();
    const enc = new TextEncoder();
    files.set('preset.json', enc.encode(JSON.stringify(manifest)).buffer as ArrayBuffer);
    for (const c of plan.chapterFiles) files.set(c.path, enc.encode(c.markdown).buffer as ArrayBuffer);
    const read = (path: string) => (files.has(path) ? Promise.resolve(files.get(path)!) : Promise.reject(new Error(path)));
    const readAr = await readBundle(manifest, read, { locale: 'ar', baseConfig: {} as PostextConfig, traceContours: false });
    expect(readAr.config.bodyText).toEqual({ fontFamily: 'Amiri', fontSize: pt(12) });
    expect(readAr.config.calloutStyles).toEqual([{ id: 'note', background: hex('#ffeecc') }]);
    expect(readAr.sharedConfig?.bodyText).toEqual({ fontFamily: 'Lora', fontSize: pt(12) });
    const readEs = await readBundle(manifest, read, { locale: 'es', baseConfig: {} as PostextConfig, traceContours: false });
    expect(readEs.config.locale).toBe('es');
    expect(readEs.config.bodyText?.fontFamily).toBe('Lora');
  });
});
