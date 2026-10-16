// ═══ Postext Cookbook · Nº 093 · One text in four citation styles ════════════════
// https://postext.dev/en/cookbook/one-text-four-citation-styles
// Code: MIT · Text: original (CC BY 4.0) · Pictures: none
// Fonts: Source Serif 4, Source Sans 3 (SIL OFL 1.1) · Needs postext ≥ 1.34.0
import {
  buildDocumentWithFonts, renderPageToCanvas, registerCitationEngine,
} from 'https://esm.sh/postext';
import { createCiteprocEngine, STYLES, LOCALES } from 'https://esm.sh/postext-citeproc';

const LANG = 'en'; // @lang: the language of the sample document ('en' | 'es')
const RECIPE = 'one-text-four-citation-styles';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// #region palette: one ink, and a colour for each style's band
const palette = {
  ink: '#1d1b19', muted: '#66605a', rule: '#cfc8bf', paper: '#ffffff',
  apa: '#2f5d8a', chicago: '#8c2f2b', ieee: '#24476b', iso: '#3c6b4f', // the four bands
};
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
// Each document points main-color at its own band, so any default left follows it.
const colorPalette = (band) => Object.entries({ ...palette, 'main-color': palette[band] })
  .map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } }));
// #endregion
const [SERIF, SANS] = ['Source Serif 4', 'Source Sans 3'];
const LEAD = 14; // pt

// #region answer: the style is one setting; everything else stays the same
// Citations are written once, Pandoc's way: [@key], [@a; @b], [-@key] without the author,
// @key [p. 17] inside the sentence. citeproc-js writes them, and the list, in the style named.
registerCitationEngine(createCiteprocEngine({ styles: STYLES, locales: LOCALES }));
const SHOWN = [ // the same text, built once per entry
  { style: 'apa', band: 'apa', name: 'APA 7', system: t({ en: 'author-date', es: 'autor-año' }) },
  { style: 'chicago-author-date', band: 'chicago', name: 'Chicago',
    system: t({ en: 'author-date', es: 'autor-año' }) },
  { style: 'ieee', band: 'ieee', name: 'IEEE', system: t({ en: 'numbered', es: 'numérico' }) },
  { style: t({ en: 'iso690-author-date-en', es: 'iso690-author-date-es' }), band: 'iso',
    name: 'ISO 690', system: t({ en: 'author-date', es: 'autor-año' }) },
];
const citations = (style) => ({
  style, // 'apa' → '(Warde, 1955)'; 'ieee' → '[1]'; the list is sorted and set to match
  link: true,
  // The authors' names stay whole in the citations, the text and the list: the APA build
  // set '(Lup-' | 'ton, 2010)'.
  hyphenateNames: false,
  bibliography: { fontSize: em(0.85), lineHeight: pt(11.2), hangingIndent: mm(6),
    entrySpacing: pt(2), labelWidth: mm(6), doi: 'hide' },
});
// #endregion

// #region band: the style's name, large, in a band of its colour
// The kicker names the build's citation style: a label of the design (#849).
const kicker = (s, i) => `${t({ en: 'Citation style', es: 'Estilo de cita' })}`
  + ` · ${i + 1} / ${SHOWN.length} · ${s.system}`;
const opener = (s, i) => ({
  enabled: true,
  minHeight: mm(41), // from the top margin to under the title, 63 mm from the trim
  slot: { elements: [
    { kind: 'box', id: 'band', style: { backgroundColor: col(s.band) },
      placement: { anchor: { to: 'page', edge: 'top-left' },
        size: { width: 'fill', height: mm(44) } } },
    { kind: 'text', id: 'kicker', content: kicker(s, i), fontFamily: SANS, fontSize: pt(8),
    fontWeight: 600, letterSpacing: pt(1.4), textTransform: 'uppercase', color: col('paper'),
    align: 'left',
    placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(18), y: mm(12) } } },
    { kind: 'text', id: 'name', content: s.name, fontFamily: SERIF, fontSize: pt(54),
      fontWeight: 600, lineHeight: 1, color: col('paper'), align: 'left', overflow: 'clip',
      placement: { anchor: { to: '#kicker', edge: 'below' }, offset: { x: mm(0), y: mm(5) },
        size: { width: mm(119), height: 'auto' } } },
    { kind: 'text', id: 'title', content: '{titleText}', fontFamily: SERIF, fontSize: pt(20),
      fontWeight: 600, lineHeight: 1.15, color: col('ink'), align: 'left', overflow: 'wrap',
      placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(18), y: mm(52) },
        size: { width: mm(119), height: 'auto' } } },
  ] },
});
// #endregion

let at = 0; // the entry of SHOWN being built
const config = () => ({
  locale: t({ en: 'en-us', es: 'es' }),
  colorPalette: colorPalette(SHOWN[at].band),
  citations: citations(SHOWN[at].style),
  page: { sizePreset: 'custom', width: mm(155), height: mm(235), dpi: 150,
    margins: { top: mm(22), bottom: mm(20), left: mm(18), right: mm(18) } },
  layout: { layoutType: 'single' },
  bodyText: {
    fontFamily: SERIF, fontSize: pt(10), lineHeight: pt(LEAD), color: col('ink'),
    boldColor: col('ink'), italicColor: col('ink'), referenceColor: col('ink'),
    textAlign: 'justify', firstLineIndent: mm(4.5), indentAfterHeading: false,
    hyphenation: { enabled: true }, optimalLineBreaking: true,
    avoidWidows: true, avoidOrphans: true, avoidRunts: true,
  },
  headings: { fontFamily: SERIF, color: col('ink'), levels: [
    { level: 1, breakBefore: { enabled: true, parity: 'any' }, // the essay opens a page
      advancedDesign: opener(SHOWN[at], at) },
  ] },
  checks: { contentInConfig: { allow: [kicker(SHOWN[at], at)] } },
  header: { elements: [] },
  footer: { elements: [ // the colophon is an attribute of the essay's H1
    { kind: 'text', id: 'colophon', content: '{attr.colophon}',
    fontFamily: SANS, fontSize: pt(7), color: col('muted'),
    placement: { anchor: { to: 'page', edge: 'bottom-left' }, offset: { x: mm(18), y: mm(-11) } } },
  ] },
});

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ '';

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = {
  'Source Serif 4': ['400', '400i', '600', '600i', '700', '700i'], // 700: the list's title
  'Source Sans 3': ['400', '600'],
};

// ─── 4 · Build & show ───────────────────────────────────────────────────────
// #region build: one text, four documents, shown as two spreads
// The style is set for the whole document, so each style is a build of its own.
const docs = [];
for (at = 0; at < SHOWN.length; at++) {
  // pageIndexOffset makes each page the next one of a book, so the desk pairs them:
  // APA beside Chicago, IEEE beside ISO 690.
  const content = { markdown, continuation: { pageIndexOffset: at + 1 } };
  docs.push(await buildDocumentWithFonts(content, config(), kitFonts(FONTS)));
}
// #endregion
showPages(docs, { title: t({ en: 'One text, four styles', es: 'Un texto, cuatro estilos' }) });

// @kit core fonts viewer
