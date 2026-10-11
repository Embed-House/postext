import { describe, it, expect } from 'vitest';
import { collectFontUsage } from '../fonts/usage';
import { configFontFaces } from '../fonts/prepare';
import type { PostextConfig } from '../types';

// #741: `collectFontUsage` read no `boldFontWeight` but the code face's. A
// book whose bold is 600 was laid out by the command line with the 700 face
// standing in (the 600 was never fetched): wider bold runs, another wrap,
// 8 pages where the capture and the Sandbox give 7.

const has = (usage: Map<string, { weight: number; style: string }[]>, family: string, weight: number, style = 'normal') =>
  (usage.get(family) ?? []).some((u) => u.weight === weight && u.style === style);

describe('collectFontUsage: the bold weight a configuration names (#741)', () => {
  it('asks the body family for bodyText.boldFontWeight, upright and italic', () => {
    const usage = collectFontUsage({ bodyText: { fontFamily: 'Red Hat Text', boldFontWeight: 600 } });
    expect(usage.get('Red Hat Text')).toContainEqual({ weight: 600, style: 'normal' });
    expect(usage.get('Red Hat Text')).toContainEqual({ weight: 600, style: 'italic' });
    // The four standard variants stay.
    for (const [weight, style] of [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] as const) {
      expect(has(usage, 'Red Hat Text', weight, style)).toBe(true);
    }
  });

  it('follows the body\'s rule about italics', () => {
    // An Arabic document sets `*…*` in bold: no italics, of any weight.
    const arabic = collectFontUsage({ locale: 'ar', bodyText: { fontFamily: 'Amiri', boldFontWeight: 600 } });
    expect(has(arabic, 'Amiri', 600)).toBe(true);
    expect(has(arabic, 'Amiri', 600, 'italic')).toBe(false);
    // Chinese text whose emphasis holds no Latin letter: dots, no italics.
    const chinese = collectFontUsage({ locale: 'zh-Hans', bodyText: { fontFamily: 'Noto Serif SC', boldFontWeight: 900 } }, { latinEmphasis: false });
    expect(has(chinese, 'Noto Serif SC', 900)).toBe(true);
    expect(has(chinese, 'Noto Serif SC', 900, 'italic')).toBe(false);
  });

  it('asks the default body family when the configuration names the weight alone', () => {
    const usage = collectFontUsage({ bodyText: { boldFontWeight: 600 } });
    const families = [...usage.entries()].filter(([, uses]) => uses.some((u) => u.weight === 600));
    expect(families).toHaveLength(1);
  });

  it('asks a paragraph style for its own bold in its own family, else the body\'s', () => {
    const config: PostextConfig = {
      bodyText: { fontFamily: 'Lora', boldFontWeight: 600 },
      paragraphStyles: [
        { id: 'lead', name: 'Lead', fontFamily: 'Inter', boldFontWeight: 800 },
        { id: 'aside', name: 'Aside', fontFamily: 'Karla' },
        { id: 'note', name: 'Note', boldFontWeight: 500 },
        { id: 'slanted', name: 'Slanted', fontFamily: 'Cormorant', italic: true, boldFontWeight: 600 },
      ],
    };
    const usage = collectFontUsage(config);
    expect(has(usage, 'Inter', 800)).toBe(true);
    expect(has(usage, 'Inter', 600)).toBe(false);
    // No weight of its own: the body's bold, in the style's family.
    expect(has(usage, 'Karla', 600)).toBe(true);
    // No family of its own: its weight in the body's family.
    expect(has(usage, 'Lora', 500)).toBe(true);
    // A slanted text sets its bold runs slanted.
    expect(has(usage, 'Cormorant', 600, 'italic')).toBe(true);
  });

  it('asks a box body for its bold', () => {
    const usage = collectFontUsage({
      bodyText: { fontFamily: 'Lora' },
      calloutStyles: [
        { id: 'warning', name: 'Warning', body: { fontFamily: 'Red Hat Text', boldFontWeight: 600 } },
        { id: 'tip', name: 'Tip', body: { boldFontWeight: 800 } },
        { id: 'plain', name: 'Plain' },
      ],
    } as PostextConfig);
    expect(has(usage, 'Red Hat Text', 600)).toBe(true);
    expect(has(usage, 'Lora', 800)).toBe(true);
  });

  it('asks a table style\'s families for the body\'s bold, which sets their bold runs', () => {
    const usage = collectFontUsage({
      bodyText: { fontFamily: 'Lora', boldFontWeight: 600 },
      tableStyle: { bodyFontFamily: 'Inter' },
      tableStyles: [{ id: 'data', name: 'Data', headerFontFamily: 'Oswald' }],
    } as PostextConfig);
    expect(has(usage, 'Inter', 600)).toBe(true);
    expect(has(usage, 'Oswald', 600)).toBe(true);
  });

  it('asks a chip\'s own family for the body\'s bold, which a chip in a bold run is set in', () => {
    const usage = collectFontUsage({
      bodyText: { fontFamily: 'Red Hat Text', boldFontWeight: 600 },
      chipStyles: [{ id: 'key', name: 'Key', fontFamily: 'Red Hat Display' }],
    } as PostextConfig);
    expect(has(usage, 'Red Hat Display', 600)).toBe(true);
  });

  it('asks headings and contents entries for the heavier of their weight and the body\'s bold', () => {
    const usage = collectFontUsage({
      bodyText: { fontFamily: 'Lora', boldFontWeight: 600 },
      headings: { fontFamily: 'Oswald', fontWeight: 400, levels: [{ level: 2, fontFamily: 'Inter', fontWeight: 800 }] },
    });
    expect(has(usage, 'Oswald', 600)).toBe(true);
    // Already heavier than the body's bold: its own weight sets its bold.
    expect(has(usage, 'Inter', 600)).toBe(false);
  });

  it('adds nothing when the bold is 700', () => {
    const base: PostextConfig = {
      bodyText: { fontFamily: 'Lora' },
      paragraphStyles: [{ id: 'lead', name: 'Lead', fontFamily: 'Inter' }],
      calloutStyles: [{ id: 'warning', name: 'Warning', body: { fontFamily: 'Karla' } }],
      tableStyle: { bodyFontFamily: 'Oswald' },
      headings: { fontFamily: 'Oswald', fontWeight: 400 },
    } as PostextConfig;
    const explicit: PostextConfig = { ...base, bodyText: { fontFamily: 'Lora', boldFontWeight: 700 } };
    const flat = (config: PostextConfig) => [...collectFontUsage(config).entries()].map(([f, uses]) => [f, uses.map((u) => `${u.weight}${u.style[0]}`).sort()]);
    expect(flat(explicit)).toEqual(flat(base));
    for (const uses of collectFontUsage(base).values()) {
      // Only the weights the configuration spells out and the standard four.
      expect(uses.every((u) => u.weight === 400 || u.weight === 700)).toBe(true);
    }
  });

  it('reaches prepareFonts: configFontFaces requests the bold weight', () => {
    const faces = configFontFaces({ bodyText: { fontFamily: 'Red Hat Text', boldFontWeight: 600 } });
    expect(faces).toContainEqual({ family: 'Red Hat Text', weight: 600, style: 'normal' });
    expect(faces).toContainEqual({ family: 'Red Hat Text', weight: 600, style: 'italic' });
  });
});
