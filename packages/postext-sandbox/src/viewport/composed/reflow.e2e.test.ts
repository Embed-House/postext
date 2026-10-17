// What moved and why on a composed page (#868), on P4's p. 8 stand-in
// laid out by the engine: its first box lengthened, the Reflow panel's
// sentences in English and Spanish (the Sandbox's own labels), the marks
// on the page (declared box, arrows to the laid one, numbered badges) and
// the Design mode's badges (auto, minimum, maximum, pin).

import { beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, createMeasurementCache } from 'postext';
import type { PostextConfig, Resource, VDTDocument, VDTFrame, VDTPage } from 'postext';
import { DEFAULT_LABELS, type SandboxLabels } from '../../types';
import { documentReflow, reflowEntries, reflowSentence, reflowShort } from './reflowText';
import { reflowMarksFor } from './reflowMarks';
import { designBadgesFor } from './designBadges';

// Every glyph the same width: the layout is the same on every machine.
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return { font: '', measureText: (s: string) => ({ width: s.length * 7 }) };
  }
};

type Fixture = (locale: 'es' | 'en') => { markdown: string; config: PostextConfig; resources: Resource[] };
const FIXTURES = '../../../../postext/src/__tests__/composed/fixtures/';
const LOCALES = ['en', 'es', 'ca', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ar'] as const;
let page8Fixture: Fixture;
const messages = new Map<string, Record<string, string>>();
beforeAll(async () => {
  page8Fixture = ((await import(/* @vite-ignore */ new URL(`${FIXTURES}page8.ts`, import.meta.url).href)) as { page8Fixture: Fixture }).page8Fixture;
  for (const l of LOCALES) {
    const m = (await import(/* @vite-ignore */ new URL(`../../../../../apps/web/messages/${l}.json`, import.meta.url).href)) as { default?: { Sandbox: Record<string, string> }; Sandbox?: Record<string, string> };
    messages.set(l, (m.default ?? m).Sandbox!);
  }
});

/** The Sandbox's labels in a site locale, as the web app hands them over. */
function labelsOf(locale: string): SandboxLabels {
  return { ...DEFAULT_LABELS, ...messages.get(locale) } as SandboxLabels;
}

const mm = (value: number) => ({ value, unit: 'mm' as const });
const DPI = 300;
const MM = DPI / 25.4;
const paras = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w} ${i} `.repeat(30).trim()).join('\n\n');
/** The stand-in's Markdown with more paragraphs in its first box. */
const lengthened = (markdown: string, extra: string): string => markdown.replace(/(:::frame\{slot="dinero"[^\n]*\n)/, `$1${extra}\n\n`);
const build = (markdown: string, config: PostextConfig, resources: Resource[]): VDTDocument =>
  buildDocument({ markdown, resources }, config, createMeasurementCache());
const composedPage = (doc: VDTDocument): VDTPage => doc.pages.find((p) => p.composed)!;
const frameOf = (page: VDTPage, name: string): VDTFrame => page.composed!.frames.find((f) => f.name === name)!;
const patched = (config: PostextConfig, frames: Record<string, Record<string, unknown>>): PostextConfig => {
  const tpl = config.pageTemplates![0]!;
  return { ...config, pageTemplates: [{ ...tpl, frames: tpl.frames!.map((f) => (frames[f.name] ? { ...f, ...frames[f.name] } : f)) }] };
};

describe('the Reflow panel on the p. 8 stand-in (#868)', () => {
  it('says nothing moved while the text fits the template as drawn', () => {
    const { markdown, config, resources } = page8Fixture('en');
    const doc = build(markdown, config, resources);
    expect(documentReflow(doc, DEFAULT_LABELS, 'en')).toEqual([]);
    expect(reflowMarksFor(composedPage(doc))).toEqual([]);
  });

  for (const locale of ['en', 'es'] as const) {
    it(`${locale}: a lengthened first box — the box grew, the boxes below moved by as much, each sentence names why`, () => {
      const { markdown, config, resources } = page8Fixture(locale);
      const before = composedPage(build(markdown, config, resources));
      const doc = build(lengthened(markdown, paras(3, locale === 'es' ? 'Más dinero' : 'More money')), config, resources);
      const page = composedPage(doc);
      const grew = (frameOf(page, 'dinero').rect.height - frameOf(before, 'dinero').rect.height) / MM;
      expect(grew).toBeGreaterThan(5);
      const labels = labelsOf(locale);
      const [entry, ...rest] = documentReflow(doc, labels, locale);
      expect(rest).toEqual([]);
      expect(entry!.template).toBe('tema-cajas');
      expect(entry!.pageLabel).toBe(String(page.pageLabel ?? page.pageNumberValue));
      // The frames in log order, numbered: the box that grew first, then
      // what it pushed.
      expect(entry!.entries.map((e) => [e.number, e.frame])).toEqual([[1, 'dinero'], [2, 'gasto'], [3, 'gasto-fotos'], [4, 'ahorro'], [5, 'ahorro-fotos']]);
      const by = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.round(grew * 10) / 10);
      const [dinero, gasto] = entry!.entries;
      if (locale === 'en') {
        expect(dinero!.lines).toEqual([`dinero grew ${by} mm to hold its content`]);
        expect(gasto!.lines).toEqual([`gasto moved down ${by} mm to make room for dinero`]);
      } else {
        expect(dinero!.lines).toEqual([`dinero ha crecido ${by} mm para que quepa su contenido`]);
        expect(gasto!.lines).toEqual([`gasto ha bajado ${by} mm para dejar sitio a dinero`]);
      }
      // No English from the engine in the Spanish panel.
      if (locale === 'es') for (const e of entry!.entries) for (const line of e.lines) expect(line).not.toMatch(/\b(grew|moved|down|to make room)\b/);
      expect(dinero!.short).toBe(`+${by} mm`);
      expect(gasto!.short).toBe(`↓ ${by} mm`);
    });
  }

  it('draws the declared box and an arrow to the box as laid, for every frame that changed', () => {
    const { markdown, config, resources } = page8Fixture('en');
    const before = composedPage(build(markdown, config, resources));
    const page = composedPage(build(lengthened(markdown, paras(3, 'More money')), config, resources));
    const marks = reflowMarksFor(page, 'en');
    expect(marks.map((m) => m.number)).toEqual([1, 2, 3, 4, 5]);
    const [dinero, gasto] = marks;
    // The box that grew: its declared box is the template's, an arrow at
    // its foot from the declared height to the laid one, no move.
    expect(dinero!.declared).toEqual(frameOf(before, 'dinero').rect);
    expect(dinero!.arrows.map((a) => a.kind)).toEqual(['size']);
    const size = dinero!.arrows[0]!;
    expect(size.from.y).toBeCloseTo(dinero!.frame.rect.y + dinero!.declared!.height, 6);
    expect(size.to.y).toBeCloseTo(dinero!.frame.rect.y + dinero!.frame.rect.height, 6);
    // A box pushed down: one arrow from its declared top to its laid top,
    // as long as the growth.
    expect(gasto!.declared).toEqual(frameOf(before, 'gasto').rect);
    expect(gasto!.arrows.map((a) => a.kind)).toEqual(['move']);
    const move = gasto!.arrows[0]!;
    expect(move.to.y - move.from.y).toBeCloseTo(dinero!.frame.rect.height - dinero!.declared!.height, 3);
    expect(move.to.x).toBeCloseTo(move.from.x, 6);
  });

  it('a photo scaled to make room: «its pictures are at 92.5 %», and the text scale', () => {
    const { markdown, config, resources } = page8Fixture('en');
    const inBox = markdown.replace('slot="dinero-fotos"', 'slot="dinero"');
    const natural = frameOf(composedPage(build(inBox, config, resources)), 'dinero').rect.height / MM;
    const doc = build(inBox, patched(config, { dinero: { height: mm(Math.floor(natural) - 4), minHeight: undefined } }), resources);
    const page = composedPage(doc);
    const scale = frameOf(page, 'dinero').imageScale!;
    expect(scale).toBeLessThan(1);
    const [entry] = documentReflow(doc, DEFAULT_LABELS, 'en');
    const pct = new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(Math.round(scale * 1000) / 10);
    expect(entry!.entries.find((e) => e.frame === 'dinero')!.lines).toContain(`dinero: its pictures are at ${pct} %`);
    expect(reflowShort({ frame: 'x', kind: 'textScaled', scale: 0.875 }, 'es')).toBe('87,5 %');
    expect(reflowSentence({ frame: 'x', kind: 'textScaled', scale: 0.875 }, labelsOf('de'), { locale: 'de' })).toBe('x: sein Text steht bei 87,5 %, damit er passt');
  });

  it('words every kind of event, with its cause, in each locale', () => {
    const l = labelsOf('fr');
    expect(reflowSentence({ frame: 'gasto', kind: 'resized', fromMm: 62, toMm: 58.5, cause: 'dinero' }, l, { locale: 'fr' })).toBe('gasto a cédé 3,5 mm à dinero');
    expect(reflowSentence({ frame: 'foto', kind: 'resized', fromMm: 40, toMm: 36, axis: 'x' }, DEFAULT_LABELS)).toBe('foto is 4 mm narrower than drawn');
    expect(reflowSentence({ frame: 'b', kind: 'moved', fromMm: 20, toMm: 14, axis: 'x', cause: 'gutter' }, DEFAULT_LABELS)).toBe('b moved left 6 mm to keep clear of the spine');
    expect(reflowSentence({ frame: 'dinero', kind: 'continued', toPage: 8, cause: 'resto' }, DEFAULT_LABELS, { pageLabel: (i) => String(i + 1) })).toBe('dinero continues on page 9, in resto');
    expect(reflowSentence({ frame: 'dinero', kind: 'overflow', toMm: 3.4 }, labelsOf('es'), { locale: 'es' })).toBe('dinero sigue sin caber por 3,4 mm: lo que sobra se corta al pie');
    expect(reflowShort({ frame: 'b', kind: 'moved', fromMm: 20, toMm: 14, axis: 'x' })).toBe('← 6 mm');
    // Every locale has every sentence, with the same tokens as English.
    for (const locale of ['es', 'ca', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ar']) {
      const labels = labelsOf(locale);
      for (const key of Object.keys(DEFAULT_LABELS).filter((k) => /^(reflow|designBadge|proposal)/.test(k)) as (keyof SandboxLabels)[]) {
        const tokens = (s: string) => [...s.matchAll(/__(\w+)__/g)].map((m) => m[1]).sort();
        expect(tokens(labels[key] as string), `${locale} ${key}`).toEqual(tokens(DEFAULT_LABELS[key] as string));
      }
    }
  });

  it('numbers a page’s frames once each, in log order', () => {
    const page = {
      composed: {
        frames: [{ id: 'cp0:a', name: 'a' }, { id: 'cp0:b', name: 'b' }],
        log: [{ frame: 'a', kind: 'grew' }, { frame: 'b', kind: 'moved' }, { frame: 'a', kind: 'textScaled', scale: 0.9 }],
      },
    } as unknown as VDTPage;
    expect(reflowEntries(page).map((e) => [e.number, e.frame, e.frameId, e.events.length])).toEqual([[1, 'a', 'cp0:a', 2], [2, 'b', 'cp0:b', 1]]);
  });
});

describe('Design mode shows how each frame is sized (#868)', () => {
  const words = { auto: 'auto', min: 'min __mm__ mm', max: 'max __mm__ mm', pinned: 'pinned' };

  it('auto heights, minimums, maximums and pins, where the frame is laid', () => {
    const { markdown, config, resources } = page8Fixture('en');
    const cfg = patched(config, { dinero: { maxHeight: mm(72) }, 'gasto-fotos': { pin: true } });
    const doc = build(markdown, cfg, resources);
    const page = composedPage(doc);
    const badges = new Map(designBadgesFor(doc, page, words, 'en').map((b) => [b.frame.name, b]));
    const dinero = badges.get('dinero')!;
    expect(dinero.text).toBe('auto · min 36 mm · max 72 mm');
    expect(dinero.autoHeight).toBe(true);
    expect(dinero.min!.offsetPx).toBeCloseTo(36 * MM, 6);
    expect(dinero.max!.offsetPx).toBeCloseTo(72 * MM, 6);
    expect(badges.get('gasto')!.text).toBe('auto · min 62 mm');
    // A pinned frame says so (its height follows its photo).
    expect(badges.get('gasto-fotos')!.pinned).toBe(true);
    expect(badges.get('gasto-fotos')!.text).toMatch(/pinned$/);
    // In the reader's language and numerals.
    const de = designBadgesFor(doc, page, { auto: 'auto', min: labelsOf('de').designBadgeMin, max: labelsOf('de').designBadgeMax, pinned: labelsOf('de').designBadgePinned }, 'de');
    expect(de.find((b) => b.frame.name === 'ahorro')!.text).toBe('auto · min. 30 mm');
  });

  it('a fixed height without a maximum is not «auto»', () => {
    const { markdown, config, resources } = page8Fixture('en');
    const doc = build(markdown, patched(config, { dinero: { height: mm(36), minHeight: undefined } }), resources);
    const badge = designBadgesFor(doc, composedPage(doc), words).find((b) => b.frame.name === 'dinero');
    expect(badge).toBeUndefined();
  });
});
