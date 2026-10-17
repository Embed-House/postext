// ═══ Postext Cookbook · Nº 159 · Activity book with boxes that grow ══════════════
// https://postext.dev/en/cookbook/activity-book-growing-boxes
// Code: MIT · Text: original (CC BY 4.0) · Pictures: drawn in code
// Fonts: Andika, Baloo 2, Lexend (SIL OFL 1.1) · Needs postext ≥ 1.38.0
import {
  buildDocumentWithFonts, renderPageToCanvas, registerResourceImage,
} from 'https://esm.sh/postext';
import { renderToPdf, decompressWoff2 } from 'https://esm.sh/postext-pdf';

const LANG = 'en'; // @lang: the language of the sample document ('en' | 'es' | 'fr')
const RECIPE = 'activity-book-growing-boxes';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// #region palette: one ink, the water blue, the sun, and the pale fields of the boxes
const palette = {
  ink: '#1f2d38', // text
  sea: '#1d659c', // titles, tabs, list numbers
  sky: '#e2f0f9', // activity boxes, the cover's sky
  sun: '#f0a531', // the project's box, the sun
  leaf: '#4c8f55', // the cover's hills
  sand: '#fcf0d8', // the materials box
  rule: '#93bcd8', // answer lines, blanks
  paper: '#ffffff',
};
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
const colorPalette = [
  ...Object.entries(palette).map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } })),
  { id: 'main-color', name: 'sea (defaults)', value: { hex: palette.sea, model: 'hex' } },
];
// #endregion

const [TEXT, DISPLAY, LABEL] = ['Andika', 'Baloo 2', 'Lexend']; // Andika: for early readers
const W = 174; // mm: the width of the type area, and of every box
const LINE = 8; // mm between two answer lines: room for a child's handwriting
const at = (to, edge, x = 0, y = 0) => ({ anchor: { to, edge }, offset: { x: mm(x), y: mm(y) } });

// The head every sheet shares: the unit over the title band, the text with its drawing.
const kicker = { kind: 'text', id: 'tema', content: '{attr.tema}', fontFamily: LABEL,
  fontSize: pt(8.5), fontWeight: 600, color: col('sea'), textTransform: 'uppercase',
  letterSpacing: pt(1.4), placement: at('container', 'top-left') };
const opening = [
  { name: 'titulo', takes: 'h1', style: 'banda', width: mm(W),
    placement: at('container', 'top-left', 0, 6) },
  { name: 'texto', flow: true, width: mm(W - 52), minHeight: mm(36),
    placement: at('#titulo', 'below', 0, 4) },
  { name: 'dibujo', width: mm(44), placement: at('#titulo', 'below', W - 44, 4) },
];

// #region answer: boxes in a stack grow with their text; empty ruled frames hold the answers
// An empty frame is an answer space: the Markdown sends it nothing (optional: no slotEmpty).
// Its `rules` draw a line at the foot of every LINE mm of its height, so the lines are part
// of the frame and move with it when a box above grows. minHeight too: a box that runs out of
// room may not take the lines away from the child.
const answer = (name, lines) => ({ name, optional: true, width: mm(W), height: mm(LINE * lines),
  minHeight: mm(LINE * lines),
  rules: { every: mm(LINE), color: col('rule'), width: pt(0.75) } });
// A box is as tall as its text, never less than drawn: a longer text makes it taller and
// pushes everything after it in the group down the page.
const box = (name, style, minHeight) => ({ name, style, width: mm(W), minHeight: mm(minHeight) });
const sheet = {
  id: 'ficha',
  decoration: { elements: [kicker] },
  frames: [
    ...opening,
    // The group starts where its first box is placed: under the text, and runs down from there.
    { ...box('act-1', 'actividad', 22), placement: at('#texto', 'below', 0, 6) },
    answer('lineas-1', 3),
    box('act-2', 'actividad', 22),
    // The last box goes on overleaf, with the answer space after it, when its text outgrows
    // the page; the other two push it down instead.
    { ...box('act-3', 'actividad', 22), overflow: { continueIn: 'next-page' } },
    answer('lineas-3', 2),
  ],
  groups: [{ name: 'actividades', kind: 'stack', gap: mm(4.5),
    frames: ['act-1', 'lineas-1', 'act-2', 'act-3', 'lineas-3'] }],
};
// #endregion

// #region continue: the project's steps go on on a page of their own, after their mark
const project = {
  id: 'proyecto',
  overflowTemplate: 'proyecto-sigue',
  decoration: { elements: [kicker] },
  frames: [
    ...opening,
    { ...box('material', 'material', 20), placement: at('#texto', 'below', 0, 9) },
    // As tall as its text, never past the foot of the page, at full size: the rest ends
    // with the language's mark (Continúa, Continued, À suivre) and goes on on an added page.
    { name: 'pasos', style: 'proyecto', width: mm(W), overflow: { continueIn: 'next-page' } },
  ],
  groups: [{ name: 'trabajo', kind: 'stack', gap: mm(9), frames: ['material', 'pasos'] }],
};
// The added page: the rest of the steps at the head, then lines for the child's notes,
// under a heading the page fence names (notas="…").
const projectGoesOn = {
  id: 'proyecto-sigue',
  decoration: { elements: [kicker,
    { kind: 'text', id: 'notas-titulo', content: '{attr.notas}', fontFamily: DISPLAY,
      fontSize: pt(15), fontWeight: 700, color: col('sea'),
      placement: { ...at('#notas', 'top-left', 0, -3), size: { width: mm(W) } } }] },
  frames: [
    { name: 'pasos', style: 'proyecto', width: mm(W),
      placement: at('container', 'top-left', 0, 9) },
    answer('notas', 6),
  ],
  groups: [{ name: 'trabajo', kind: 'stack', gap: mm(16), frames: ['pasos', 'notas'] }],
};
// #endregion

// #region cover: a sky drawn to the bleed, the title, and a line for the child's name
const cover = {
  id: 'portada', header: false, footer: false,
  decoration: { elements: [
    { kind: 'image', id: 'cielo', resourceId: 'portada', decorative: true,
      placement: { ...at('bleed', 'top-left'), size: { width: 'fill', height: mm(178) } } },
    { kind: 'rule', id: 'nombre-linea', direction: 'horizontal', thickness: pt(1),
      color: col('sea'), placement: { ...at('#nombre', 'bottom-left', 0, 1),
        size: { width: mm(W) } } },
  ] },
  frames: [
    { name: 'titulo', takes: 'h1', width: mm(W), placement: at('container', 'top-left', 0, 162) },
    { name: 'subtitulo', flow: true, width: mm(W) },
    { name: 'nombre', style: 'campo', width: mm(W), minHeight: mm(12) },
    { name: 'colofon', style: 'colofon', width: mm(W), placement: at('container', 'bottom-left') },
  ],
  groups: [{ name: 'portada', kind: 'stack', gap: mm(4),
    frames: ['titulo', 'subtitulo', 'nombre'] }],
};
// #endregion

// A box with a tab: the tab's words come from the Markdown (label="…").
const tabbed = (id, fill, tab, tabInk, extra = {}) => ({
  id, backgroundEnabled: true, background: col(fill), borderRadius: mm(3),
  border: { enabled: false },
  padding: { top: mm(3), right: mm(5), bottom: mm(3.5), left: mm(5) },
  label: { position: 'top-left', background: col(tab), color: col(tabInk), fontFamily: LABEL,
    fontSize: pt(9), fontWeight: 600, height: mm(6), paddingX: mm(3), offset: mm(6),
    inset: mm(4), rule: { enabled: false, color: col(tab) } },
  body: { fontFamily: TEXT, fontSize: pt(11.5), lineHeight: pt(16), color: col('ink'),
    boldColor: col('ink'), italicColor: col('ink'), firstLineIndent: pt(0) },
  ...extra,
});
const plain = (id, size, lead, color, extra = {}) => ({ id, backgroundEnabled: false,
  border: { enabled: false }, padding: { top: mm(0), right: mm(0), bottom: mm(0), left: mm(0) },
  body: { fontFamily: LABEL, fontSize: pt(size), lineHeight: pt(lead), color: col(color),
    boldColor: col(color), italicColor: col(color), firstLineIndent: pt(0) }, ...extra });

const folio = (id, parity, edge, x) => ({ kind: 'text', id, content: '{pageNumber}', parity,
  fontFamily: DISPLAY, fontSize: pt(11), fontWeight: 800, color: col('paper'),
  align: 'center', box: { backgroundColor: col('sea'), borderRadius: mm(4) },
  placement: { ...at('page', edge, x, -9), size: { width: mm(8), height: mm(8) } } });
const bookTitle = (id, parity, edge, x) => ({ kind: 'text', id, content: '{title} · {subtitle}',
  parity, fontFamily: LABEL, fontSize: pt(7.5), fontWeight: 500, color: col('sea'),
  textTransform: 'uppercase', letterSpacing: pt(1.1), placement: at('page', edge, x, -11) });

const config = {
  locale: t({ es: 'es', en: 'en-gb', fr: 'fr' }), // hyphenation and the continuation mark
  resourceTypes: [{ id: 'dibujo', name: t({ es: 'Dibujo', en: 'Drawing', fr: 'Dessin' }),
    shortLabel: '', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal',
    captionPrefix: '', defaultPlacement: { position: 'here' } }],
  colorPalette,
  page: {
    sizePreset: 'custom', width: mm(210), height: mm(280), dpi: 150,
    margins: { top: mm(20), bottom: mm(22), left: mm(20), right: mm(16), mirror: true },
  },
  layout: { layoutType: 'single' },
  bodyText: {
    fontFamily: TEXT, fontSize: pt(11.5), lineHeight: pt(16), color: col('ink'),
    boldColor: col('ink'), italicColor: col('ink'), referenceColor: col('ink'),
    textAlign: 'left', firstLineIndent: pt(0), paragraphSpacing: true,
    hyphenation: { enabled: true }, optimalLineBreaking: true,
    avoidWidows: true, avoidOrphans: true, avoidRunts: true,
  },
  headings: {
    fontFamily: DISPLAY, color: col('sea'), fontWeight: 700,
    balancing: { enabled: false },
    levels: [
      // Every sheet is a composed page, which starts a page of its own.
      { level: 1, fontSize: pt(25), lineHeight: pt(30), fontWeight: 800, color: col('paper'),
        breakBefore: { enabled: false }, marginTop: pt(0), marginBottom: pt(0) },
      { level: 3, fontSize: pt(13.5), lineHeight: pt(17), marginTop: pt(6), marginBottom: pt(2) },
    ],
  },
  headingStyles: [{ id: 'portada', fontSize: pt(54), lineHeight: pt(54), fontWeight: 800,
    color: col('sea'), marginTop: pt(0), marginBottom: pt(0) }],
  unorderedLists: { bulletChar: '•', color: col('sea'), fontWeight: 700, itemSpacing: pt(3) },
  orderedLists: { numberFormat: 'arabic', fontFamily: DISPLAY, fontWeight: 800, color: col('sea'),
    itemSpacing: pt(4) },
  chipStyles: [
    // An empty chip, :chip[ ]{style="hueco"}, is a blank to write in: padding and an outline.
    { id: 'hueco', fontFamily: LABEL, background: col('paper'), borderColor: col('rule'),
      borderWidth: pt(0.9), borderRadius: mm(1.4), paddingX: mm(13), paddingY: em(0.1) },
    { id: 'casilla', fontFamily: LABEL, background: col('paper'), borderColor: col('sea'),
      borderWidth: pt(0.9), borderRadius: mm(1), paddingX: em(0.55), paddingY: em(0.05),
      gap: em(0.5) },
  ],
  calloutStyles: [
    tabbed('actividad', 'sky', 'sea', 'paper'),
    tabbed('material', 'sand', 'sun', 'ink'),
    tabbed('proyecto', 'paper', 'sun', 'ink',
      { border: { enabled: true, color: col('sun'), width: pt(1.5) } }),
    { ...plain('banda', 25, 30, 'paper'), backgroundEnabled: true, background: col('sea'),
      borderRadius: mm(3), padding: { top: mm(2.5), right: mm(5), bottom: mm(3), left: mm(5) } },
    plain('campo', 10, 14, 'sea', { padding: { top: mm(5), right: mm(0), bottom: mm(0),
      left: mm(0) } }),
    plain('colofon', 7.5, 10, 'ink'),
  ],
  header: { elements: [] },
  footer: { elements: [
    folio('folio-par', 'even', 'bottom-left', 20),
    bookTitle('titulo-par', 'even', 'bottom-left', 32),
    folio('folio-impar', 'odd', 'bottom-right', -20),
    bookTitle('titulo-impar', 'odd', 'bottom-right', -32),
  ] },
  pageTemplates: [cover, sheet, project, projectGoesOn],
};

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ ''; // content.<lang>.md, inlined by the Cookbook

// #region art: the water cycle on the cover, the planet, the three states, the rain gauge
const P = palette;
const svgDoc = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" `
  + `width="${w * 10}" height="${h * 10}">${body}</svg>`;
const cloud = (x, y, s, fill = P.paper) => `<g transform="translate(${x} ${y}) scale(${s})" `
  + `fill="${fill}">`
  + '<circle cx="0" cy="0" r="9"/><circle cx="11" cy="-5" r="11"/><circle cx="24" cy="0" r="9"/>'
  + '<rect x="-9" y="0" width="42" height="9" rx="4.5"/></g>';
const arrow = (x1, y1, x2, y2, color) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const tip = (d, o) => `${(x2 - d * Math.cos(a + o)).toFixed(1)},`
    + `${(y2 - d * Math.sin(a + o)).toFixed(1)}`;
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${color}" stroke-width="1.6" `
    + `stroke-linecap="round" stroke-dasharray="3 3" fill="none"/>`
    + `<path d="M${x2} ${y2} L${tip(5, 0.45)} L${tip(5, -0.45)} Z" fill="${color}"/>`;
};
const rain = (x, y) => [0, 6, 12, 18].map((dx, i) => `<path d="M${x + dx} ${y + (i % 2) * 3} `
  + `l-2 7" stroke="${P.sea}" stroke-width="1.6" stroke-linecap="round"/>`).join('');
const ART = {
  portada: [210, 178, () => `<rect width="210" height="178" fill="${P.sky}"/>`
    + `<circle cx="168" cy="38" r="17" fill="${P.sun}"/>`
    + Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      const p = (r) => `${(168 + r * Math.cos(a)).toFixed(1)} ${(38 + r * Math.sin(a)).toFixed(1)}`;
      return `<path d="M${p(22)} L${p(29)}" stroke="${P.sun}" stroke-width="2.4" `
        + 'stroke-linecap="round"/>';
    }).join('')
    + cloud(28, 40, 1.2) + cloud(86, 26, 0.9) + rain(30, 58)
    + `<path d="M0 132 L34 84 L52 104 L74 70 L112 132 Z" fill="${P.leaf}"/>`
    + `<path d="M74 70 L66 82 L72 80 L76 85 L81 80 L74 70 Z" fill="${P.paper}"/>`
    + `<path d="M58 132 C70 120 64 112 76 104" stroke="${P.sea}" stroke-width="3" fill="none"/>`
    + `<path d="M0 132 L210 132 L210 178 L0 178 Z" fill="${P.sea}"/>`
    + [140, 152, 164].map((y) => `<path d="M${y - 120} ${y} q8 -4 16 0 t16 0 t16 0" `
      + `stroke="${P.sky}" stroke-width="1.4" fill="none"/>`).join('')
    + arrow(150, 126, 128, 66, P.paper) + arrow(176, 124, 160, 70, P.paper)
    + arrow(120, 30, 70, 34, P.paper)],
  planeta: [56, 46, () => `<circle cx="26" cy="23" r="20" fill="${P.sea}"/>`
    + `<path d="M14 10 q8 -2 10 6 q-2 7 -9 6 q-5 -4 -1 -12 Z" fill="${P.leaf}"/>`
    + `<path d="M30 26 q9 -3 11 4 q-1 8 -8 9 q-6 -5 -3 -13 Z" fill="${P.leaf}"/>`
    + `<path d="M20 5 q6 -3 12 0 q-6 3 -12 0 Z" fill="${P.sky}"/>`
    + `<path d="M48 18 q-5 8 0 12 q5 -4 0 -12 Z" fill="${P.sea}" stroke="${P.paper}" `
    + 'stroke-width="1"/>'],
  estados: [56, 46, () => `<rect x="3" y="24" width="14" height="14" rx="2.5" fill="${P.sky}" `
    + `stroke="${P.sea}" stroke-width="1.4"/>`
    + `<path d="M22 18 L24 42 L36 42 L38 18 Z" fill="${P.sky}" stroke="${P.sea}" `
    + 'stroke-width="1.4"/>'
    + `<path d="M23 27 L37 27" stroke="${P.sea}" stroke-width="1"/>`
    + `<path d="M23.3 27 L24 42 L36 42 L36.7 27 Z" fill="${P.sea}"/>`
    + [44, 49, 54].map((x) => `<path d="M${x - 4} 40 q-3 -6 0 -12 t0 -12" stroke="${P.rule}" `
      + `stroke-width="1.6" fill="none" stroke-linecap="round"/>`).join('')],
  pluviometro: [56, 46, () => `<path d="M18 10 L40 10 L40 42 Q40 44 38 44 L20 44 Q18 44 18 42 Z" `
    + `fill="${P.sky}" stroke="${P.sea}" stroke-width="1.4"/>`
    + `<path d="M16 10 L42 10 L33 19 L25 19 Z" fill="${P.paper}" stroke="${P.sea}" `
    + 'stroke-width="1.4"/>'
    + '<path d="M18.7 30 L39.3 30 L39.3 42 Q39.3 43.3 38 43.3 L20 43.3 Q18.7 43.3 18.7 42 Z" '
    + `fill="${P.sea}"/>`
    + [22, 26, 30, 34, 38].map((y) => `<path d="M40 ${y} l5 0" stroke="${P.ink}" `
      + 'stroke-width="1"/>').join('')
    + cloud(4, 4, 0.35, P.rule) + rain(6, 8).replaceAll('l-2 7', 'l-1 4')],
};
const ALT = {
  portada: t({
    es: 'El ciclo del agua: el sol calienta el mar, el vapor sube a las nubes y la lluvia cae '
      + 'en la montaña y vuelve por el río',
    en: 'The water cycle: the sun warms the sea, vapour rises to the clouds, and rain falls on '
      + 'the hills and runs back down the river',
    fr: 'Le cycle de l’eau : le soleil chauffe la mer, la vapeur monte aux nuages, la pluie '
      + 'tombe sur la montagne et revient par la rivière' }),
  planeta: t({ es: 'La Tierra, casi toda azul, y una gota de agua',
    en: 'The Earth, mostly blue, and a drop of water',
    fr: 'La Terre, presque toute bleue, et une goutte d’eau' }),
  estados: t({ es: 'Un cubito de hielo, un vaso de agua y vapor',
    en: 'An ice cube, a glass of water and steam',
    fr: 'Un glaçon, un verre d’eau et de la vapeur' }),
  pluviometro: t({ es: 'Una botella cortada con una regla: el pluviómetro',
    en: 'A cut bottle with a ruler: the rain gauge',
    fr: 'Une bouteille coupée avec une règle : le pluviomètre' }),
};
const resources = Object.entries(ART).map(([id, [w, h]]) => ({
  id, typeId: 'dibujo', kind: 'svg', caption: '', altText: ALT[id], createdAt: 0, updatedAt: 0,
  svg: { fileId: `${id}.svg`, width: w * 10, height: h * 10 },
}));
for (const [id, [w, h, draw]] of Object.entries(ART)) {
  await loadSvg(`${id}.svg`, svgDoc(w, h, draw()));
}
// #endregion

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = { // text, display and label faces, loaded before the build
  Andika: ['400', '400i', '700'], 'Baloo 2': ['700', '800'], Lexend: ['500', '600'],
};

// ─── 4 · Build & show ───────────────────────────────────────────────────────
const doc = await buildDocumentWithFonts({ markdown, resources }, config, kitFonts(FONTS));
showPages(doc, { title: t({ es: 'El agua, de viaje', en: 'Water on the move',
  fr: 'L’eau en voyage' }) });
offerPdf(() => renderToPdf(doc, { fontProvider: fontsourceProvider, resourceBytes: imageBytes }),
  `${RECIPE}.pdf`);

// @kit core fonts viewer pdf images · the Cookbook inlines cookbook/_kit/*.js here
