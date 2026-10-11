import { describe, it, expect } from 'vitest';
import { CONFIG_VERSION, migrateBundleConfig, migrateConfig, pinLegacyInlineCaptionSide } from '../../bundle/configVersion';
import { resolveAllConfig } from '../../pipeline/config';
import { stripConfigDefaults } from '../../defaults';
import type { PostextConfig } from '../../types';

// #729: a configuration stored before a resource set in the text took
// `placement.captionSide` (configVersion 11 or older, postext 1.27 or
// earlier) keeps the caption of such a resource under it in a
// column-and-a-half layout, unless it says otherwise; content that embeds
// no resource, and every other layout, is left alone.

const EMBED = 'Text.\n\n::resource{id="fig"}\n\nMore text.';
const SIDE: PostextConfig = { layout: { layoutType: 'oneAndHalf', sideColumnRole: 'floats' } };

describe('layout.inlineCaptionSide (#729)', () => {
  it('is on by default, read as a boolean, and stripped when it restates the default', () => {
    expect(resolveAllConfig({}).layout.inlineCaptionSide).toBe(true);
    expect(resolveAllConfig({ layout: { inlineCaptionSide: false } }).layout.inlineCaptionSide).toBe(false);
    expect(resolveAllConfig({ layout: { inlineCaptionSide: 'no' as unknown as boolean } }).layout.inlineCaptionSide).toBe(true);
    expect(stripConfigDefaults({ layout: { inlineCaptionSide: true } }).layout).toBeUndefined();
    expect(stripConfigDefaults({ layout: { inlineCaptionSide: false } }).layout).toEqual({ inlineCaptionSide: false });
  });
});

describe('pinLegacyInlineCaptionSide (#729)', () => {
  it('writes inlineCaptionSide: false on a column-and-a-half layout, keeping its other fields', () => {
    const out = migrateConfig(SIDE, 11, { content: EMBED });
    expect(out.layout).toEqual({ layoutType: 'oneAndHalf', sideColumnRole: 'floats', inlineCaptionSide: false });
    expect(resolveAllConfig(out).layout.inlineCaptionSide).toBe(false);
    // The stored configuration is not touched.
    expect(SIDE.layout).toEqual({ layoutType: 'oneAndHalf', sideColumnRole: 'floats' });
    // The pin survives the strip: it is not the default.
    expect(stripConfigDefaults(out).layout?.inlineCaptionSide).toBe(false);
  });

  it('leaves every other layout, and a configuration that sets the key, as they are', () => {
    for (const config of [{}, { layout: {} }, { layout: { layoutType: 'single' } }, { layout: { layoutType: 'double' } }] as PostextConfig[]) {
      expect(pinLegacyInlineCaptionSide(config)).toBe(config);
      expect(migrateConfig(config, 11, { content: EMBED }).layout?.inlineCaptionSide).toBeUndefined();
    }
    for (const value of [true, false]) {
      const config: PostextConfig = { layout: { layoutType: 'oneAndHalf', inlineCaptionSide: value } };
      expect(pinLegacyInlineCaptionSide(config)).toBe(config);
      expect(migrateConfig(config, 11, { content: EMBED }).layout?.inlineCaptionSide).toBe(value);
    }
  });

  it('pins every version before 12 whose content may embed a resource, none from 12', () => {
    for (const v of [undefined, 1, 5, 8, 9, 10, 11]) {
      expect(migrateConfig(SIDE, v, { content: EMBED }).layout?.inlineCaptionSide, String(v)).toBe(false);
      // Unknown content may embed one.
      expect(migrateConfig(SIDE, v).layout?.inlineCaptionSide, String(v)).toBe(false);
      expect(migrateConfig(SIDE, v, { content: 'No embeds here.' }).layout?.inlineCaptionSide, String(v)).toBeUndefined();
    }
    expect(migrateConfig(SIDE, CONFIG_VERSION, { content: EMBED })).toBe(SIDE);
  });

  it('pins a bundle on its merged layers', () => {
    // The layout type comes from a locale's layer.
    const base: PostextConfig = { layout: { gutterWidth: { value: 10, unit: 'pt' } } };
    const merged = migrateBundleConfig(base, [{ layout: { layoutType: 'oneAndHalf' } }], 11, { content: EMBED });
    expect(merged.layout?.inlineCaptionSide).toBe(false);
    expect(migrateBundleConfig(base, [{ layout: { layoutType: 'double' } }], 11, { content: EMBED }).layout?.inlineCaptionSide).toBeUndefined();
    expect(migrateBundleConfig(base, [{ layout: { layoutType: 'oneAndHalf' } }], CONFIG_VERSION, { content: EMBED }).layout?.inlineCaptionSide).toBeUndefined();
  });
});
