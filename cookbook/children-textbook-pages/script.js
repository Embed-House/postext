// ═══ Postext Cookbook · Nº 156 · A children's textbook unit in three languages ═══
// https://postext.dev/en/cookbook/children-textbook-pages
// Code: MIT · Text: original (CC BY 4.0) · Pictures: generated with diffusion models
// Fonts: Nunito, Fredoka (SIL OFL 1.1) · Needs postext ≥ 1.43.0
import {
  buildDocumentWithFonts, renderPageToCanvas, registerResourceImage,
} from 'https://esm.sh/postext';
import { renderToPdf, decompressWoff2 } from 'https://esm.sh/postext-pdf';

const LANG = 'es'; // @lang: the language of the sample document ('es' | 'en' | 'ca')
const RECIPE = 'children-textbook-pages';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// #region palette: one ink and three families (water, field, sun), each with an accent, a tint
// for its boxes and a ground for its pages. The boxes and the pages are written once with the
// `tema` entries (water by default); a topic's template swaps their values.
const FAMILIES = {
  agua: { main: '#1b6aa0', tint: '#e1f0fa', ground: '#d3e8f6' },
  campo: { main: '#336f27', tint: '#e5f1dc', ground: '#d9ebcb' },
  sol: { main: '#9a5209', tint: '#fcefd2', ground: '#f8e6b8' },
};
const palette = { ink: '#1d2f3f', muted: '#4f6272', rule: '#7e98ab', paper: '#ffffff',
  agua: FAMILIES.agua.main, campo: FAMILIES.campo.main, // the blue of the folios and the contents
  tema: FAMILIES.agua.main, 'tema-tint': FAMILIES.agua.tint, 'tema-ground': FAMILIES.agua.ground };
// What a topic's template changes: the three `tema` entries take the family's values.
const swap = (f) => `tema=${FAMILIES[f].main}, tema-tint=${FAMILIES[f].tint}, `
  + `tema-ground=${FAMILIES[f].ground}`;
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
const colorPalette = [
  ...Object.entries(palette).map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } })),
  { id: 'main-color', name: 'water (defaults)', value: { hex: palette.agua, model: 'hex' } },
];
// #endregion

const [TEXT, DISPLAY] = ['Nunito', 'Fredoka'];
const PAGE = { w: 210, h: 280, top: 18, bottom: 18, inner: 14, outer: 12 }; // mm, mirrored
const HALF = PAGE.w - PAGE.inner - PAGE.outer; // one page's type area: 184 mm
const SHEET = 2 * HALF + 2 * PAGE.inner; // a spread's content area: 396 mm
const RIGHT = HALF + 2 * PAGE.inner; // where the right page's type area starts on the sheet
const LINE = 8; // mm between two answer lines
const TAB = 22; // mm of the title frame left of its words: the number badge stands there
const at = (to, edge, x = 0, y = 0) => ({ anchor: { to, edge }, offset: { x: mm(x), y: mm(y) } });
const onRight = at('container', 'top-left', RIGHT); // every frame of the right page's stack

// #region boxes: callout styles that extend each other
// Two steps of `extends`: the box (shape, type, tab), then the kind. The colours are `tema`
// entries, so one style serves the three topics and the page's palette tints it.
const tab = (f) => ({ position: 'top-left', background: col(f), color: col('paper'),
  fontFamily: DISPLAY, fontSize: pt(12), fontWeight: 600, height: mm(7), paddingX: mm(3.2),
  offset: mm(7), inset: mm(5), rule: { enabled: false, color: col(f) } });
const boxText = { fontFamily: TEXT, fontSize: pt(12), lineHeight: pt(17.5), color: col('ink'),
  boldColor: col('ink'), italicColor: col('ink'), firstLineIndent: pt(0), textAlign: 'left',
  paragraphSpacing: true };
const none = { top: mm(0), right: mm(0), bottom: mm(0), left: mm(0) }; // no padding
const calloutStyles = [
  { id: 'caja', backgroundEnabled: true, background: col('paper'), borderRadius: mm(3),
    border: { enabled: false }, padding: { top: mm(3.4), right: mm(5), bottom: mm(4), left: mm(5) },
    body: boxText, lists: { color: col('ink'), gap: mm(2), itemSpacing: mm(1.6) } },
  { id: 'caja-tema', extends: 'caja', label: tab('tema'), lists: { color: col('tema') } },
  { id: 'dato', extends: 'caja-tema', background: col('tema-tint') },
  { id: 'palabras', extends: 'caja-tema',
    border: { enabled: true, color: col('tema'), width: pt(1.4) } },
  { id: 'actividad', extends: 'caja-tema',
    stripe: { enabled: true, side: 'left', width: pt(4), color: col('tema') } },
  // Plain frames: the title (its tab and number are decoration), a picture's card and an answer
  // space. The title leaves room on the left for the number.
  { id: 'titulo', extends: 'caja', backgroundEnabled: false,
    padding: { top: mm(2.6), right: mm(6), bottom: mm(3.2), left: mm(TAB) } },
  { id: 'titulo-plano', extends: 'titulo', padding: { left: mm(8) } },
  { id: 'portada', extends: 'caja', background: col('agua'), borderRadius: mm(4),
    padding: { top: mm(2.6), right: mm(8), bottom: mm(3.6), left: mm(8) } },
  { id: 'foto', extends: 'caja', borderRadius: mm(2),
    padding: { top: mm(1.8), right: mm(1.8), bottom: mm(2.2), left: mm(1.8) } },
  { id: 'respuesta', extends: 'caja', padding: none },
  { id: 'colofon', extends: 'caja', backgroundEnabled: false, padding: none,
    body: { ...boxText, fontSize: pt(8), lineHeight: pt(11), color: col('muted') } },
];
// #endregion

// #region answer: one base template and a family of topics that extend it
// Ground, title tab and number are decoration anchored to the title frame, so the tab is as
// tall as the title needs. The number is the title's own counter, `{headingNumber}`, painted
// over the frame's left padding. A topic extends the base, swaps the palette and adds frames.
const ground = () => ({ kind: 'box', id: 'ground', decorative: true,
  placement: { ...at('bleed', 'top-left'), size: { width: 'fill', height: 'fill' } },
  style: { backgroundColor: col('tema-ground') } });
const titleTab = () => ({ kind: 'box', id: 'tab', decorative: true,
  placement: { ...at('#titulo', 'top-left'),
    size: { width: mm(HALF), height: { to: '#titulo', edge: 'bottom' } } },
  style: { backgroundColor: col('tema'), borderRadius: mm(4) } });
const badge = () => ({ kind: 'text', id: 'number', content: '{headingNumber}',
  fontFamily: DISPLAY, fontSize: pt(22), fontWeight: 700, color: col('tema'), align: 'center',
  box: { backgroundColor: col('paper'), borderRadius: mm(6) },
  placement: { ...at('#titulo', 'top-left', 5, 2.4), size: { width: mm(12), height: mm(12) } } });
const title = { name: 'titulo', takes: 'h1', style: 'titulo', width: mm(HALF),
  placement: at('container', 'top-left') };

const base = {
  id: 'tema', spread: true, gutter: mm(12),
  decoration: { elements: [ground(), titleTab(), badge()] },
  frames: [title, { name: 'texto', flow: true, columns: 2, columnGap: mm(7), width: mm(HALF),
    fit: { minScale: 0.9 } }],
  groups: [{ name: 'izquierda', kind: 'stack', gap: mm(6), frames: ['titulo', 'texto'] }],
};
const topic = (id, f, more) => ({ id, extends: 'tema', palette: swap(f), ...more });
const box = (name, style, minHeight, more) => ({ name, style, width: mm(HALF),
  minHeight: mm(minHeight), ...more });
const answer = (name, lines) => ({ name, optional: true, style: 'respuesta', width: mm(HALF),
  height: mm(LINE * lines), minHeight: mm(LINE * lines),
  rules: { every: mm(LINE), color: col('rule'), width: pt(0.75) } });
// A picture that sits at the corner of a box and pushes its text aside.
const corner = (name) => ({ name: `${name}-foto`, layer: 2, width: mm(56), exclude: 'push',
  placement: at(`#${name}`, 'top-right', -5, 8) });
// #endregion

const questions = [1, 2, 3].flatMap((n) => [box(`pregunta-${n}`, 'dato', 14),
  answer(`respuesta-${n}`, 3)]);
const pageTemplates = [
  base,
  // Water: text, a strip of three pictures and a box; three boxes grow down the right page.
  topic('tema-agua', 'agua', {
    frames: [
      ...[1, 2, 3].map((n) => ({ name: `foto-${n}`, style: 'foto', width: mm((HALF - 10) / 3),
        ...(n === 1 && { placement: at('#texto', 'below', 0, 8) }) })),
      box('probar', 'palabras', 46, { placement: at('#foto-1', 'below', 0, 10) }),
      { ...box('sabias', 'dato', 40), placement: onRight },
      { ...box('palabras', 'palabras', 62), placement: onRight },
      { ...box('actividades', 'actividad', 58), placement: onRight },
    ],
    groups: [
      { name: 'fotos', kind: 'row', gap: mm(5), frames: ['foto-1', 'foto-2', 'foto-3'] },
      { name: 'derecha', kind: 'stack', gap: mm(12),
        frames: ['sabias', 'palabras', 'actividades'] },
    ],
  }),
  // Field: one map across the spread; under it a text, and three boxes that share a width.
  topic('tema-campo', 'campo', {
    frames: [
      { name: 'mapa', crossGutter: true, width: mm(SHEET) },
      box('actividad', 'actividad', 24),
      ...[1, 2, 3].map((n) => ({ name: `curso-${n}`, style: 'dato', width: mm(56),
        minHeight: mm(46), shrink: 1,
        ...(n === 1 && { placement: at('#mapa', 'below', RIGHT, 6) }) })),
    ],
    groups: [
      { name: 'izquierda', kind: 'stack', gap: mm(6),
        frames: ['titulo', 'mapa', 'texto', 'actividad'] },
      { name: 'cursos', kind: 'row', gap: mm(6), frames: ['curso-1', 'curso-2', 'curso-3'] },
    ],
  }),
  // Sun: boxes with a picture at their corner that pushes the text aside.
  topic('tema-sol', 'sol', {
    frames: [
      box('cuidar', 'palabras', 64, { padding: { right: mm(64) } }), corner('cuidar'),
      box('turno', 'actividad', 40),
      ...[1, 2, 3].flatMap((n) => [
        box(`uso-${n}`, 'dato', 66, { padding: { right: mm(64) }, placement: onRight }),
        corner(`uso-${n}`),
      ]),
    ],
    groups: [
      { name: 'izquierda', kind: 'stack', gap: mm(12),
        frames: ['titulo', 'texto', 'cuidar', 'turno'] },
      { name: 'derecha', kind: 'stack', gap: mm(12), frames: ['uso-1', 'uso-2', 'uso-3'] },
    ],
  }),
  // Before the unit: questions, each with room to write.
  { id: 'saberes', header: false,
    decoration: { elements: [titleTab()] },
    frames: [{ ...title, style: 'titulo-plano' },
      { name: 'texto', flow: true, width: mm(HALF) }, ...questions],
    groups: [{ name: 'pagina', kind: 'stack', gap: mm(7),
      frames: ['titulo', 'texto', ...questions.map((q) => q.name)] }] },
  // The contents: a frame takes the :::toc and lays it by the contents' own rules (part rows,
  // leaders, each part kept with its entries); the ground is the template's decoration.
  { id: 'indice',
    decoration: { elements: [ground(), titleTab()] },
    frames: [{ ...title, style: 'titulo-plano' },
      { name: 'lista', takes: 'toc', width: mm(HALF) },
      { name: 'mapa', style: 'foto', width: mm(HALF) }],
    groups: [{ name: 'pagina', kind: 'stack', gap: mm(7), frames: ['titulo', 'lista', 'mapa'] }] },
  // The opener: a painting to the bleed, the title over its foot.
  { id: 'unidad', header: false, footer: false,
    decoration: { elements: [
      { kind: 'image', id: 'portada', resourceId: 'portada', decorative: true,
        placement: { ...at('bleed', 'top-left'), size: { width: 'fill', height: mm(157.5) } } },
      { kind: 'text', id: 'kicker', content: '{attr.unidad}', fontFamily: DISPLAY,
        fontSize: pt(11), fontWeight: 600, letterSpacing: pt(1), textTransform: 'uppercase',
        color: col('agua'), // the room the 7 mm band leaves over the capitals, at the sides too
        box: { backgroundColor: col('paper'), borderRadius: mm(2),
          padding: { left: mm(2), right: mm(2) } },
        placement: { ...at('#titulo', 'top-left', 0, -9), size: { height: mm(7) } } },
    ] },
    frames: [
      { name: 'titulo', takes: 'h1', style: 'portada', width: mm(120),
        placement: at('container', 'top-left', 0, 104) },
      { name: 'texto', flow: true, width: mm(160) },
      box('aprenderas', 'dato', 36),
      { name: 'colofon', style: 'colofon', width: mm(HALF),
        placement: at('container', 'bottom-left') },
    ],
    groups: [{ name: 'pagina', kind: 'stack', gap: mm(7),
      frames: ['titulo', 'texto', 'aprenderas'] }] },
];

const head = (id, content, parity, edge, x) => ({ kind: 'text', id, content, parity,
  fontFamily: TEXT, fontSize: pt(8), fontWeight: 700, letterSpacing: pt(1), color: col('muted'),
  textTransform: 'uppercase', placement: at('page', edge, x, 9) });
const folio = (id, parity, edge, x) => ({ kind: 'text', id, content: '{pageNumber}', parity,
  fontFamily: DISPLAY, fontSize: pt(11), fontWeight: 600, color: col('paper'), align: 'center',
  box: { backgroundColor: col('agua'), borderRadius: mm(4) },
  placement: { ...at('page', edge, x, -8), size: { width: mm(8), height: mm(8) } } });

// #region contents: the toc settings; a frame of the 'indice' template takes the :::toc
const toc = {
  levels: [
    { level: 1, fontFamily: DISPLAY, fontSize: pt(15), lineHeight: pt(22), fontWeight: 500,
      color: col('ink'), numberFontWeight: 600, numberColor: col('agua'), numberWidth: mm(9),
      marginTop: pt(4) },
    { level: 2, fontFamily: TEXT, fontSize: pt(11.5), lineHeight: pt(18), indent: mm(9),
      color: col('ink') },
  ],
  pageNumber: { fontFamily: DISPLAY, fontWeight: 500, width: mm(9), color: col('agua') },
  leader: { char: '.', gap: mm(1.5) },
  parts: { height: pt(34), marginTop: pt(12), marginBottom: pt(4), design: { elements: [
    { kind: 'box', id: 'band', decorative: true,
      placement: { ...at('container', 'top-left'), size: { width: 'fill', height: 'fill' } },
      style: { backgroundColor: col('paper'), borderRadius: mm(3) } },
    { kind: 'text', id: 'letter', content: '{number}', fontFamily: DISPLAY, fontSize: pt(16),
      fontWeight: 700, color: col('paper'), align: 'center',
      box: { backgroundColor: col('agua'), borderRadius: mm(4) },
      placement: { ...at('container', 'left', 2, 0), size: { width: mm(8), height: mm(8) } } },
    { kind: 'text', id: 'name', content: '{titleText}', fontFamily: DISPLAY, fontSize: pt(13),
      fontWeight: 600, color: col('agua'), placement: at('container', 'left', 14, 0) },
  ] } },
};
// #endregion

// #region art-labels: the map's label styles and anchors; the words are in the Markdown
// An anchor is a point of the painting (fractions of its width and height) and a label style;
// every language's ::label lines use the same anchors.
const halo = { color: col('paper'), width: pt(1.8) };
const labelStyles = [
  { id: 'sierra', fontFamily: DISPLAY, fontSize: pt(13), fontWeight: 600, color: col('ink'),
    textTransform: 'uppercase', letterSpacing: 0.14, halo },
  { id: 'agua', fontFamily: TEXT, fontSize: pt(11), fontWeight: 700, fontStyle: 'italic',
    color: { hex: '#0b3a5c', model: 'hex' }, halo },
  { id: 'mar', fontFamily: TEXT, fontSize: pt(12), fontWeight: 700, fontStyle: 'italic',
    color: col('paper'), halo: { color: { hex: '#0b3a5c', model: 'hex' }, width: pt(1.8) } },
  { id: 'pueblo', fontFamily: DISPLAY, fontSize: pt(12), fontWeight: 600, color: col('ink'), halo },
  { id: 'curso', fontFamily: DISPLAY, fontSize: pt(10.5), fontWeight: 600, color: col('paper'),
    textTransform: 'uppercase', letterSpacing: 0.08, background: col('campo'),
    padding: mm(1.6) },
];
const ANCHORS = [
  { id: 'sierra', x: 0.21, y: 0.055, style: 'sierra' },
  { id: 'nacimiento', x: 0.065, y: 0.115, style: 'agua', align: 'start' },
  { id: 'fontalba', x: 0.135, y: 0.255, style: 'pueblo', verticalAlign: 'top' },
  { id: 'embalse', x: 0.31, y: 0.155, style: 'agua', width: 0.12 },
  { id: 'molinar', x: 0.505, y: 0.35, style: 'pueblo', verticalAlign: 'bottom' },
  { id: 'aldamar', x: 0.845, y: 0.505, style: 'pueblo', verticalAlign: 'bottom' },
  { id: 'mar', x: 0.965, y: 0.28, style: 'mar' },
  { id: 'rio', x: 0.61, y: 0.715, style: 'agua', rotate: -3 },
  { id: 'alto', x: 0.17, y: 0.45, style: 'curso' },
  { id: 'medio', x: 0.4, y: 0.77, style: 'curso' },
  { id: 'bajo', x: 0.74, y: 0.865, style: 'curso' },
];
// #endregion

const config = {
  canvasViewer: { pageGap: 0 }, // the Canvas joins the two pages of a spread
  locale: t({ es: 'es', en: 'en-gb', ca: 'ca' }),
  resourceTypes: [{ id: 'dibujo', name: t({ es: 'Dibujo', en: 'Picture', ca: 'Dibuix' }),
    shortLabel: '', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal',
    captionPrefix: '', defaultPlacement: { position: 'here' } }],
  colorPalette,
  page: { sizePreset: 'custom', width: mm(PAGE.w), height: mm(PAGE.h), dpi: 150,
    margins: { top: mm(PAGE.top), bottom: mm(PAGE.bottom), left: mm(PAGE.inner),
      right: mm(PAGE.outer), mirror: true } },
  layout: { layoutType: 'single' },
  bodyText: { fontFamily: TEXT, fontSize: pt(12), lineHeight: pt(17.5), color: col('ink'),
    boldColor: col('ink'), italicColor: col('ink'), referenceColor: col('ink'),
    textAlign: 'left', firstLineIndent: pt(0), paragraphSpacing: true,
    hyphenation: { enabled: true }, optimalLineBreaking: true,
    avoidWidows: true, avoidOrphans: true, avoidRunts: true },
  headings: { fontFamily: DISPLAY, fontWeight: 600, color: col('ink'), levels: [
    { level: 1, fontSize: pt(28), lineHeight: pt(32), color: col('paper'), marginTop: pt(0),
      marginBottom: pt(0), breakBefore: { enabled: false } },
    { level: 2, fontSize: pt(15), lineHeight: pt(19), marginTop: pt(9), marginBottom: pt(3) },
  ] },
  // Headings that are not entries of the unit: no number, no row in the contents.
  headingStyles: [
    { id: 'portada', numbered: false, toc: false, fontSize: pt(46), lineHeight: pt(48) },
    { id: 'previo', numbered: false, toc: false },
  ],
  toc,
  parts: { page: false }, // a part is a row of the contents, with no divider page
  unorderedLists: { bulletChar: '•', color: col('agua'), fontWeight: 700, itemSpacing: pt(3) },
  orderedLists: { numberFormat: 'arabic', fontFamily: DISPLAY, fontWeight: 600,
    color: col('agua'), itemSpacing: pt(4) },
  labelStyles,
  captionStyle: { fontFamily: TEXT, fontSize: pt(9), color: col('ink'), descriptionItalic: true,
    gap: pt(4) },
  calloutStyles,
  header: { elements: [
    head('materia', '{subtitle}', 'even', 'top-left', PAGE.outer),
    head('unidad', '{title}', 'odd', 'top-right', -PAGE.outer),
  ] },
  footer: { elements: [folio('folio-par', 'even', 'bottom-left', PAGE.outer),
    folio('folio-impar', 'odd', 'bottom-right', -PAGE.outer)] },
  pageTemplates,
};

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ ''; // content.<lang>.md, inlined by the Cookbook

// #region art: nine paintings (JPEGs in assets/), the pictures of the unit
// Painted with a diffusion model in a coloured-pencil and watercolour manner, cut to the shape
// of the frames that show them and declared with their pixels. Nothing is written on them: the
// names on the map are ::label lines of the Markdown, standing at the anchors below.
const ART = { portada: ['portada-1400.jpg', 1400, 1021, 165],
  mapa: ['mapa-1900.jpg', 1900, 730, 122],
  ...Object.fromEntries(['nacimiento', 'arroyo', 'cascada', 'riego', 'molino', 'piraguas',
    'limpieza'].map((id) => [id, [`${id}-720.jpg`, 720, 540, 330]])) };
const resources = await Promise.all(Object.entries(ART).map(async ([id, [fileId, w, h, ppi]]) => {
  await loadImage(fileId, asset(fileId));
  return { id, typeId: 'dibujo', kind: 'bitmap', caption: '', altText: '', createdAt: 0,
    updatedAt: 0, bitmap: { fileId, format: 'jpeg', width: w, height: h, resolution: ppi },
    ...(id === 'mapa' && { anchors: ANCHORS }) };
}));
// The map again with no anchors, small, under the contents.
resources.push({ ...resources.find((r) => r.id === 'mapa'), id: 'rio', anchors: [] });
// #endregion

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = { Nunito: ['400', '400i', '700'], Fredoka: ['500', '600', '700'] };

// ─── 4 · Build & show ───────────────────────────────────────────────────────
const doc = await buildDocumentWithFonts({ markdown, resources }, config, kitFonts(FONTS));
showPages(doc, { title: t({ es: 'Nuestro río', en: 'Our river', ca: 'El nostre riu' }) });
offerPdf(() => renderToPdf(doc, { fontProvider: fontsourceProvider, resourceBytes: imageBytes }),
  `${RECIPE}.pdf`);

// @kit core fonts viewer pdf images · the Cookbook inlines cookbook/_kit/*.js here
