import { describe, it, expect } from 'vitest';
import { stripConfigDefaults } from '../../defaults/index.js';
import { resolveAllConfig } from '../../pipeline/config.js';
import type { PostextConfig } from '../../types.js';
import { clone, hex, pt, survives, sweepSizes, text, type Fields } from './stripRoundTrip.harness.js';

// #694: the strip must not change what a configuration resolves to. The
// sweep that sets every field of eight documents lives in
// stripRoundTrip.harness.ts and runs in the stripRoundTrip.part*.test.ts
// files, so the workers share it (#1118); here are the cases found by hand
// and the check that the sweep still finds what to try.


describe('what a heading style sets is no default (#694)', () => {
  const running: PostextConfig = {
    header: { elements: [text('runningHead', '{chapterTitle}')] },
    footer: { elements: [text('folio', '{pageNumber}')] },
  };
  const styled = (style: Fields): PostextConfig => ({ ...running, headingStyles: [{ id: 'cover', ...style }] } as PostextConfig);
  const coverOf = (config: PostextConfig) => resolveAllConfig(clone(config)).headingStyles[0]!;

  it('keeps the empty slot that silences the running head or the folio', () => {
    for (const slot of [{ elements: [] }, {}]) {
      const config = styled({ header: slot, footer: slot });
      const stripped = stripConfigDefaults(config);
      expect(stripped.headingStyles).toEqual(config.headingStyles);
      expect(coverOf(stripped).header).toEqual({ elements: [] });
      expect(coverOf(stripped).footer).toEqual({ elements: [] });
      expect(survives(config)).toBe(true);
    }
    // Unset, the style's pages take the document's.
    expect(coverOf(stripConfigDefaults(styled({}))).footer).toBeUndefined();
  });

  it('keeps a slot that restates the built-in one under a document that changed it', () => {
    const builtIn = resolveAllConfig({}).footer;
    const config = styled({ footer: clone(builtIn) });
    expect(stripConfigDefaults(config).headingStyles![0]!.footer).toEqual(builtIn);
    expect(survives(config)).toBe(true);
  });

  it('keeps empty margins, layout and body type, each a section of its own', () => {
    const config: PostextConfig = {
      ...styled({ margins: {}, layout: {}, bodyStyle: {} }),
      layout: { layoutType: 'double', gutterWidth: pt(30) },
    } as PostextConfig;
    expect(stripConfigDefaults(config).headingStyles).toEqual(config.headingStyles);
    expect(survives(config)).toBe(true);
  });

  it('still drops the static defaults and an empty palette', () => {
    expect(stripConfigDefaults(styled({ name: 'cover', numbered: true, toc: true, runningChapter: true, palette: {} })).headingStyles)
      .toEqual([{ id: 'cover' }]);
    expect(stripConfigDefaults(styled({ numbered: false, palette: { band: '#f6c297' } })).headingStyles)
      .toEqual([{ id: 'cover', numbered: false, palette: { band: '#f6c297' } }]);
  });
});

describe('the other values the sweep found (#694)', () => {
  it('keeps an empty list of box or chip styles: the built-in one does not come back', () => {
    const config: PostextConfig = { calloutStyles: [], chipStyles: [] };
    expect(stripConfigDefaults(config)).toEqual(config);
    expect(resolveAllConfig(stripConfigDefaults(config)).calloutStyles).toEqual([]);
    expect(resolveAllConfig(stripConfigDefaults(config)).chipStyles).toEqual([]);
    expect(resolveAllConfig({}).calloutStyles.map((style) => style.id)).toEqual(['note']);
    expect(resolveAllConfig({}).chipStyles.map((style) => style.id)).toEqual(['chip']);
  });

  it('keeps a reference colour set back to the default under another bold colour', () => {
    const main = resolveAllConfig({}).bodyText.referenceColor;
    const config: PostextConfig = { bodyText: { boldColor: hex('#aa0000'), referenceColor: main } };
    expect(resolveAllConfig({ bodyText: { boldColor: hex('#aa0000') } }).bodyText.referenceColor.hex).toBe('#aa0000');
    expect(stripConfigDefaults(config)).toEqual(config);
    expect(resolveAllConfig(stripConfigDefaults(config)).bodyText.referenceColor.hex).toBe(main.hex);
    // With the default bold colour, or none, it restates what it follows.
    expect(stripConfigDefaults({ bodyText: { referenceColor: main } })).toEqual({});
    expect(stripConfigDefaults({ bodyText: { boldColor: main, referenceColor: main } })).toEqual({});
  });
});

describe('the sweep finds what to try (#694)', () => {
  for (const { name, sections, cases } of sweepSizes()) {
    it(`finds the sections and fields of ${name}`, () => {
      expect(sections).toBeGreaterThanOrEqual(20);
      expect(cases).toBeGreaterThan(1500);
    });
  }
});
