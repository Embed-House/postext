/**
 * Writes public/docs-examples/river-places-before.postext, the book the guide
 * "Moving a book to composed pages" follows from one-off frames to a grid and
 * a module: a page template that draws six photo cards one frame at a time
 * (photo1…photo6, caption1…caption6) and a box with a picture beside its text.
 *
 *   pnpm dlx --allow-build=esbuild tsx scripts/docs/cards-sample.mjs
 *
 * The words are invented for the guide. The pictures are the paintings of the
 * Cookbook's children's textbook recipe (cookbook/children-textbook-pages),
 * cut down to 360 px with ImageMagick when `magick` is on the path.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBundle } from 'postext';

const mm = (value) => ({ value, unit: 'mm' });
const pt = (value) => ({ value, unit: 'pt' });
const hex = (h, paletteId) => ({ hex: h, model: 'hex', ...(paletteId ? { paletteId } : {}) });

const INK = hex('#1d2f3f', 'ink');
const WATER = hex('#1b6aa0', 'water');
const TINT = hex('#dcebf6', 'water-tint');
const PAPER = hex('#ffffff', 'paper');

const BODY = 'Nunito';
const DISPLAY = 'Fredoka';
const boxText = { fontFamily: BODY, fontSize: pt(11), lineHeight: pt(16), color: INK, firstLineIndent: pt(0), textAlign: 'left' };

const calloutStyles = [
  { id: 'title', backgroundEnabled: true, background: WATER, borderRadius: mm(4), border: { enabled: false },
    padding: { top: mm(2.6), right: mm(8), bottom: mm(3.4), left: mm(8) }, body: { ...boxText, color: PAPER } },
  { id: 'photo', backgroundEnabled: true, background: PAPER, borderRadius: mm(2), border: { enabled: true, color: TINT, width: pt(1) },
    padding: { top: mm(1.8), right: mm(1.8), bottom: mm(1.8), left: mm(1.8) }, body: boxText },
  { id: 'caption', backgroundEnabled: true, background: TINT, borderRadius: mm(3), border: { enabled: false },
    padding: { top: mm(1.2), right: mm(3), bottom: mm(1.6), left: mm(3) }, body: { ...boxText, fontSize: pt(10), lineHeight: pt(13) } },
  { id: 'fact', backgroundEnabled: true, background: TINT, borderRadius: mm(3), border: { enabled: false },
    padding: { top: mm(4), right: mm(5), bottom: mm(4), left: mm(5) }, body: boxText,
    label: { position: 'top-left', background: WATER, color: PAPER, fontFamily: DISPLAY, fontSize: pt(11), fontWeight: 600,
      height: mm(7), paddingX: mm(3), offset: mm(7), inset: mm(5), rule: { enabled: false, color: WATER } } },
];

const W = 56; // a card's width: three cards and two gaps of 8 mm fill the 184 mm measure
const GAP = 8;
const card = (n) => {
  const placement = n === 1 ? { anchor: { to: '#text', edge: 'below' }, offset: { y: mm(8) } }
    : n === 4 ? { anchor: { to: '#photo1', edge: 'below' }, offset: { y: mm(14) } }
      : { anchor: { to: `#photo${n - 1}`, edge: 'right-of' }, offset: { x: mm(GAP) } };
  return [
    { name: `photo${n}`, style: 'photo', width: mm(W), placement },
    { name: `caption${n}`, style: 'caption', width: 'auto', layer: 2, overlap: 'allow',
      placement: { anchor: { to: `#photo${n}`, edge: 'bottom' }, offset: { y: mm(4) } } },
  ];
};

const places = {
  id: 'places', name: 'Places of the river',
  frames: [
    { name: 'title', style: 'title', takes: 'h1', width: 'fill' },
    { name: 'text', flow: true, width: 'fill', placement: { anchor: { to: '#title', edge: 'below' }, offset: { y: mm(6) } } },
    ...[1, 2, 3, 4, 5, 6].flatMap(card),
    { name: 'fact', style: 'fact', width: 'fill', minHeight: mm(36), padding: { right: mm(52) },
      placement: { anchor: { to: '#photo4', edge: 'below' }, offset: { y: mm(16) } } },
    { name: 'fact-picture', width: mm(40), layer: 2, exclude: 'push',
      placement: { anchor: { to: '#fact', edge: 'top-right' }, offset: { x: mm(-5), y: mm(5) } } },
  ],
};

const config = {
  locale: 'en-gb',
  colorPalette: [
    { id: 'ink', name: 'ink', value: hex('#1d2f3f') }, { id: 'water', name: 'water', value: hex('#1b6aa0') },
    { id: 'water-tint', name: 'water tint', value: hex('#dcebf6') }, { id: 'paper', name: 'paper', value: hex('#ffffff') },
  ],
  page: { sizePreset: 'custom', width: mm(210), height: mm(280), dpi: 150,
    margins: { top: mm(18), bottom: mm(18), left: mm(13), right: mm(13), mirror: false } },
  layout: { layoutType: 'single' },
  bodyText: { ...boxText, fontSize: pt(12), lineHeight: pt(17), paragraphSpacing: true, hyphenation: { enabled: true } },
  headings: { fontFamily: DISPLAY, fontWeight: 600, color: INK, levels: [{ level: 1, fontSize: pt(26), lineHeight: pt(30),
    color: PAPER, marginTop: pt(0), marginBottom: pt(0), breakBefore: { enabled: false } }] },
  resourceTypes: [{ id: 'picture', name: 'Picture', shortLabel: '', numberingTemplate: '', resetOn: 'never',
    counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } }],
  calloutStyles,
  pageTemplates: [places],
};

const cards = [
  ['spring', 'The spring'], ['stream', 'A stream'], ['waterfall', 'The waterfall'],
  ['fields', 'The fields'], ['mill', 'The mill'], ['canoes', 'The canoes'],
];
const markdown = `---
title: "Places of the river"
---

::::page{template="places"}
# Places of the river

Six places on the way from the mountains to the sea. Which one is nearest to your school?

${cards.map(([id, words], i) => `:::frame{slot="photo${i + 1}"}
::resource{id="${id}"}
:::

:::frame{slot="caption${i + 1}"}
${words}
:::`).join('\n\n')}

:::frame{slot="fact" label="Did you know?"}
Volunteers clean the banks of the river every spring. They pick up plastic, cut back brambles and count the birds that nest there.
:::

:::frame{slot="fact-picture"}
::resource{id="banks"}
:::
::::
`;

// The paintings, cut down for a small file.
const ASSETS = fileURLToPath(new URL('../../../../cookbook/children-textbook-pages/assets/', import.meta.url));
const SOURCES = { spring: 'nacimiento', stream: 'arroyo', waterfall: 'cascada', fields: 'riego', mill: 'molino', canoes: 'piraguas', banks: 'limpieza' };
const work = mkdtempSync(join(tmpdir(), 'cards-sample-'));
const files = {};
const resources = Object.entries(SOURCES).map(([id, name]) => {
  const src = join(ASSETS, `${name}-720.jpg`);
  let bytes = readFileSync(src);
  let width = 720, height = 540, resolution = 330;
  try {
    const out = join(work, `${id}.jpg`);
    execFileSync('magick', [src, '-resize', '360x270', '-strip', '-quality', '72', out]);
    bytes = readFileSync(out);
    width = 360; height = 270; resolution = 165;
  } catch {
    // No ImageMagick: the full-size painting goes in.
  }
  files[`${id}.jpg`] = bytes;
  return { id, typeId: 'picture', kind: 'bitmap', caption: '', altText: '', createdAt: 0, updatedAt: 0,
    bitmap: { fileId: `${id}.jpg`, format: 'jpeg', width, height, resolution } };
});

const { bytes, warnings } = await createBundle({
  id: 'river-places-before',
  name: 'Places of the river, before grids',
  description: 'A one-page textbook whose template draws six photo cards one frame at a time, and a box with a picture beside its text.',
  locale: 'en',
  chapters: [{ title: 'Places of the river', markdown }],
  config,
  resources,
  files,
  mtime: Date.UTC(2026, 9, 20),
});
for (const w of warnings) console.warn(w);
const out = fileURLToPath(new URL('../../public/docs-examples/river-places-before.postext', import.meta.url));
writeFileSync(out, bytes);
console.log(out, bytes.length, 'bytes');
