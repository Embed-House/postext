// ═══ Postext Cookbook · Nº 999 · A topic page in three boxes ═════════════════════
// https://postext.dev/en/cookbook/composed-bench
// Code: MIT · Text: original (CC BY 4.0) · Pictures: drawn in code
// Fonts: Source Sans 3 (SIL OFL 1.1) · Needs postext ≥ 1.35.0
//
// Not a published recipe: the composed-page bench's own fixture (#869), run with
// COOKBOOK_RECIPES_DIR=src/lib/cookbook/fixtures/recipes pnpm cookbook bench.
// The page template is the stand-in for page 8 of a primary-school social-science book
// that the engine's tests lay out (packages/postext/src/__tests__/composed/fixtures/
// page8.ts): a tabbed title, running text, and three boxes with tabs stacked in a group,
// each with its picture beside it. The form is here; every word is in content.<lang>.md.
import {
  buildDocumentWithFonts, renderPageToCanvas, registerResourceImage,
} from 'https://esm.sh/postext';

const LANG = 'es'; // @lang: the language of the sample document ('es' | 'en' | 'ca')
const RECIPE = 'composed-bench';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// #region palette: one ink, the topic colour, a tint and a ring for each box
const palette = {
  ink: '#231f20',
  topic: '#0885bf', // the band behind the page and the title
  paper: '#ffffff',
  blue: '#d8ecf9', blueRing: '#0885bf',
  green: '#e6f3b4', greenRing: '#66ae3e',
  yellow: '#fdf0c4', yellowRing: '#f99d1c',
  key: '#ffe500', // the highlighter behind a key word
};
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
const colorPalette = [
  ...Object.entries(palette).map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } })),
  { id: 'main-color', name: 'topic (defaults)', value: { hex: palette.topic, model: 'hex' } },
];
// #endregion

const SANS = 'Source Sans 3';
const at = (to, edge, x = 0, y = 0) => ({ anchor: { to, edge }, offset: { x: mm(x), y: mm(y) } });

// A box with a tab: its tint, and the tab on the side the picture leaves free.
const box = (id, fill, ring, tabSide) => ({
  id,
  backgroundEnabled: true,
  background: col(fill),
  border: { enabled: false },
  borderRadius: mm(1.5),
  padding: { top: mm(3), right: mm(4), bottom: mm(3.5), left: mm(4) },
  label: {
    position: tabSide, background: col('paper'), color: col('ink'),
    fontFamily: SANS, fontSize: pt(11), fontWeight: 700,
    height: mm(6.4), paddingX: mm(2.5), offset: mm(6.4), inset: mm(0),
    rule: { enabled: false, color: col(ring) },
  },
  body: { fontFamily: SANS, fontSize: pt(10.5), lineHeight: pt(15), color: col('ink'),
    boldColor: col('ink'), italicColor: col('ink'), firstLineIndent: pt(0) },
});

// The band behind the page, the white card and the topic's name: the page's decoration.
const decoration = {
  elements: [
    { kind: 'image', id: 'fondo', resourceId: '{attr.fondo}', decorative: true,
      placement: { ...at('bleed', 'top-left'), size: { width: 'fill', height: 'fill' } } },
    { kind: 'box', id: 'tarjeta',
      placement: { ...at('container', 'top-left', -6, -4),
        size: { width: mm(198), height: mm(250) } },
      style: { backgroundColor: col('paper'), borderRadius: mm(4) } },
    { kind: 'text', id: 'tema', content: '{attr.tema}', fontFamily: SANS, fontSize: pt(9),
      fontWeight: 600, color: col('paper'), placement: at('page', 'top-right', -10, 6) },
  ],
};

// #region answer: frames anchored to one another, three boxes in a stack
const pageTemplates = [{
  id: 'tema-cajas',
  header: false,
  decoration,
  frames: [
    { name: 'titulo', takes: 'h1', style: 'tab-titulo', width: mm(170),
      placement: at('container', 'top-left', -4, -2) },
    { name: 'texto', flow: true, width: mm(182), placement: at('#titulo', 'below', 4, 2) },
    { name: 'dinero', style: 'caja-azul', padding: { right: mm(62) }, minHeight: mm(36),
      width: mm(186), placement: at('#texto', 'below', 0, 9) },
    { name: 'dinero-fotos', layer: 2, width: mm(58), placement: at('#dinero', 'top-right', -2, 2) },
    { name: 'gasto', style: 'caja-verde', padding: { left: mm(82) }, minHeight: mm(62),
      width: mm(186) },
    { name: 'gasto-fotos', layer: 2, width: mm(76), placement: at('#gasto', 'top-left', 3, 9) },
    { name: 'ahorro', style: 'caja-amarilla', padding: { right: mm(50) }, minHeight: mm(30),
      width: mm(186) },
    { name: 'ahorro-fotos', layer: 2, width: mm(44), placement: at('#ahorro', 'right', -3) },
  ],
  // A box that grows pushes the ones below it down the page.
  groups: [{ name: 'cajas', kind: 'stack', frames: ['dinero', 'gasto', 'ahorro'], gap: mm(12) }],
}];
// #endregion

const config = {
  locale: t({ es: 'es', en: 'en-gb', ca: 'ca' }),
  resourceTypes: [{ id: 'foto', name: t({ es: 'Foto', en: 'Photo', ca: 'Foto' }), shortLabel: '',
    numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '',
    defaultPlacement: { position: 'here' } }],
  colorPalette,
  page: {
    sizePreset: 'custom', width: mm(230), height: mm(288), dpi: 150,
    margins: { top: mm(24), bottom: mm(22), left: mm(22), right: mm(22), mirror: true },
  },
  layout: { layoutType: 'single' },
  bodyText: {
    fontFamily: SANS, fontSize: pt(12), lineHeight: pt(18), color: col('ink'),
    boldColor: col('ink'), italicColor: col('ink'), referenceColor: col('ink'),
    textAlign: 'left', firstLineIndent: pt(0), hyphenation: { enabled: false },
  },
  headings: {
    fontFamily: SANS, color: col('ink'), fontWeight: 700,
    balancing: { enabled: false },
    levels: [
      { level: 1, fontSize: pt(22), lineHeight: pt(26), color: col('topic'),
        breakBefore: { enabled: false } },
      { level: 2, fontSize: pt(15), lineHeight: pt(20), color: col('ink') },
    ],
  },
  unorderedLists: { bulletChar: '•', color: col('topic'), fontWeight: 700 },
  chipStyles: [{ id: 'clave', background: col('key'), color: col('ink'), fontWeight: 700 }],
  calloutStyles: [
    { id: 'tab-titulo', backgroundEnabled: true, background: col('paper'),
      border: { enabled: false }, borderRadius: mm(1),
      padding: { top: mm(1.5), right: mm(4), bottom: mm(1.5), left: mm(4) } },
    box('caja-azul', 'blue', 'blueRing', 'top-left'),
    box('caja-verde', 'green', 'greenRing', 'top-right'),
    box('caja-amarilla', 'yellow', 'yellowRing', 'top-left'),
  ],
  header: { elements: [] },
  footer: { elements: [{ kind: 'text', id: 'folio', content: '{pageNumber}', fontFamily: SANS,
    fontSize: pt(10), fontWeight: 700, color: col('ink'),
    placement: at('container', 'bottom-left') }] },
  pageTemplates,
};

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ ''; // content.<lang>.md, inlined by the Cookbook

// #region art: flat pictures of the boxes' proportions and the topic band
const ART = {
  'foto-dinero': [150, 100], 'foto-gasto': [190, 140], 'foto-ahorro': [115, 95],
  'banda-tema': [230, 288],
};
const RING = { 'foto-dinero': 'blueRing', 'foto-gasto': 'greenRing', 'foto-ahorro': 'yellowRing' };
function picture(id, [w, h]) {
  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" `
    + `width="${w * 4}" height="${h * 4}">${body}</svg>`;
  if (id === 'banda-tema') return svg(`<rect width="${w}" height="${h}" fill="${palette.topic}"/>`);
  const coin = (x, i) => `<circle cx="${w * x}" cy="${h * (0.55 - i * 0.05)}" r="${h * 0.16}" `
    + `fill="${palette.paper}" stroke="${palette.ink}" stroke-width="2"/>`;
  const coins = [0.3, 0.5, 0.7].map(coin).join('');
  return svg(`<rect width="${w}" height="${h}" rx="6" fill="${palette[RING[id]]}"/>${coins}`);
}
const ALT = {
  'foto-dinero': t({ es: 'Monedas sobre la mesa del aula', en: 'Coins on the classroom table',
    ca: 'Monedes damunt la taula de l’aula' }),
  'foto-gasto': t({ es: 'La lista de la compra de la excursión',
    en: 'The shopping list for the trip', ca: 'La llista de la compra de l’excursió' }),
  'foto-ahorro': t({ es: 'La hucha de la clase', en: 'The class money box',
    ca: 'La guardiola de la classe' }),
};
const resources = Object.entries(ART).map(([id, [w, h]]) => ({
  id, typeId: 'foto', kind: 'svg', caption: '', createdAt: 0, updatedAt: 0,
  ...(ALT[id] ? { altText: ALT[id] } : {}),
  svg: { fileId: `${id}.svg`, width: w * 4, height: h * 4 },
}));
for (const [id, size] of Object.entries(ART)) await loadSvg(`${id}.svg`, picture(id, size));
// #endregion

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = { 'Source Sans 3': ['400', '600', '700'] };

// ─── 4 · Build & show ───────────────────────────────────────────────────────
const doc = await buildDocumentWithFonts({ markdown, resources }, config, kitFonts(FONTS));
showPages(doc, { title: t({ es: 'La hucha de la clase', en: 'The class money box',
  ca: 'La guardiola de la classe' }) });

// @kit core fonts viewer images · the Cookbook inlines cookbook/_kit/*.js here
