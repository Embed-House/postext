// ═══ Postext Cookbook · Nº 175 · A Turkish classical edition: notes, Arabic quotations, roman prelims ═══
// https://postext.dev/en/cookbook/turkish-classical-edition
// Code: MIT · Text: Postext Cookbook (original); the Qurʾān and ḥadīth quoted in Arabic (PD) · Pictures: none
// Fonts: Libertinus Serif, Amiri (SIL OFL 1.1) · Needs postext ≥ 1.60.0
import { buildDocument, withLoadedFonts, renderPageToCanvas } from 'https://esm.sh/postext';
import { renderToPdf, decompressWoff2 } from 'https://esm.sh/postext-pdf';

const LANG = 'tr'; // @lang: the language of the sample document ('tr')
const RECIPE = 'turkish-classical-edition';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// A Turkish scholarly book: black serif on a warm paper, one dark red for the headings.
const palette = {
  ink: '#1d1b18', // text and notes
  accent: '#7d2a20', // headings, the title
  rule: '#8a7b66', // the rule over the notes, the rule under the running heads
  muted: '#5f584e', // running heads, the imprint
  paper: '#fbf8f1', // the page
};
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
const colorPalette = [
  ...Object.entries(palette).map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } })),
  { id: 'main-color', name: 'accent (defaults)', value: { hex: palette.accent, model: 'hex' } },
];
const SERIF = 'Libertinus Serif'; // text, notes, headings, running heads
const NASKH = 'Amiri'; // the Arabic: inline runs through bodyText.scriptFonts, blocks through 'ayet'
const [W, H] = [135, 210]; // mm: 13.5 × 21 cm
const [TOP, BOTTOM, INNER, OUTER] = [20, 22, 18, 16]; // mm; `left` is the inner margin
const MEASURE = W - INNER - OUTER; // 101 mm
const [SIZE, LEAD] = [10.5, 14]; // pt
const BLEED = 3; // mm, with crop marks: page.cutLines

// #region answer: Turkish text, Arabic quotations in their own face, notes that run on
// locale 'tr' turns on the Turkish hyphenation patterns and keeps f and i apart in fikir,
// fıkıh and fiil (bodyText.turkishLigatures, 'break' by default in Turkish).
// numerals 'latn': page numbers, notes and contents in 1 2 3, also around Arabic quotations.
// An Arabic word inside a Turkish sentence, :rtl[﴿…﴾]{lang=ar}, is measured and printed in
// Amiri (bodyText.scriptFonts.arab); a whole verse is a block in the 'ayet' style:
//   :::paragraphs{dir=rtl lang=ar style="ayet"}
const scriptFonts = { arab: NASKH };
const ayet = { id: 'ayet', fontFamily: NASKH, fontSize: pt(13), lineHeight: pt(LEAD * 1.5),
  textAlign: 'center', firstLineIndent: pt(0), marginTop: pt(LEAD / 2), marginBottom: pt(LEAD / 2),
  color: col('ink') };
// The bibliography: plain entries with a hanging indent, no citation processor.
const kaynak = { id: 'kaynak', textAlign: 'left', firstLineIndent: pt(0), hangingIndent: mm(6),
  spaceBetween: pt(4), fontSize: pt(9.5), lineHeight: pt(12.5) };
// A note longer than the space left on its page goes on at the foot of the next one.
const footnotes = {
  split: true, splitMinLines: 2,
  fontSize: pt(8.5), lineHeight: pt(11), color: col('ink'), textAlign: 'justify',
  spaceAbove: pt(10), spaceBelowRule: pt(4),
  separator: { width: 0.3, lineWidth: pt(0.5), color: col('rule') },
};
// #endregion

// #region folios: roman folios for the prelims, arabic from the first chapter
// The page counter starts in lower-case roman. Before the first chapter two directives in
// the Markdown count again from 1 on the next recto (gotcha: numbering-next-page):
//   :::pagebreak{parity="odd"}
//   :::numbering{format="decimal" startAt=1}
const pageNumbering = { format: 'lower-roman', startAt: 1 };
// #endregion

// #region furniture: the book's title on versos, the chapter's in capitals on rectos
const at = (edge, x, y, to = 'container') => ({ anchor: { to, edge },
  offset: { x: mm(x), y: mm(y) } });
const text = (id, content, font, size, placement, extra = {}) => ({ kind: 'text', id, content,
  fontFamily: font, fontSize: pt(size), color: col('ink'), align: 'center', overflow: 'wrap',
  placement, ...extra });
const rule = (id, y, width, edge = 'top', to = 'container', x = 0) => ({ kind: 'rule', id,
  direction: 'horizontal', thickness: pt(0.5), color: col('rule'),
  placement: { ...at(edge, x, y, to), size: { width: width === 'fill' ? 'fill' : mm(width) } } });
const design = (elements, minHeight) => ({ enabled: true, slot: { elements },
  ...(minHeight !== undefined && { minHeight: mm(minHeight) }) });
const HEAD_Y = 12; // mm from the trim
const blockX = (parity) => (parity === 'even' ? OUTER : INNER); // the text block's left edge
const heads = (parity, content, extra = {}) => [
  text(`${parity}-head`, content, SERIF, 8,
    { ...at('top-left', blockX(parity), HEAD_Y, 'page'), size: { width: mm(MEASURE) } },
    { color: col('muted'), parity, pages: 'body', letterSpacing: pt(0.6), ...extra }),
  text(`${parity}-folio`, '{pageNumber}', SERIF, 9, parity === 'even'
    ? at('top-left', OUTER, HEAD_Y, 'page') : at('top-right', -OUTER, HEAD_Y, 'page'),
  { parity, pages: 'body', align: parity === 'even' ? 'left' : 'right' }),
  { ...rule(`${parity}-rule`, HEAD_Y + 5, MEASURE, 'top-left', 'page', blockX(parity)),
    parity, pages: 'body' },
];
const header = { elements: [
  ...heads('even', '{title}', { italic: true }),
  ...heads('odd', '{chapterTitle}', { textTransform: 'uppercase' }), // İLİM VE ÂLİM, dotted İ
] };
const dropFolio = (pages) => text(`folio-${pages}`, '{pageNumber}', SERIF, 9,
  at('bottom', 0, -11, 'page'), { pages });
const footer = { elements: [dropFolio('opener')] };
// #endregion

// #region openers: chapters open on a recto, their title as written (no numbering)
const opener = design([
  text('title', '{titleText}', SERIF, 17, at('top', 0, 18), { fontWeight: 700,
    color: col('accent'), lineHeight: 1.3 }),
  rule('rule', 36, 18),
], 46);
const titleOnly = design([text('title', '{titleText}', SERIF, 14, at('top', 0, 10),
  { fontWeight: 700, color: col('accent') })], 24);
const front = { id: 'front', numbered: false, toc: false,
  breakBefore: { enabled: true, parity: 'odd' }, header: { elements: [] },
  footer: { elements: [dropFolio('all')] }, advancedDesign: titleOnly };
const back = { id: 'back', numbered: false, toc: true,
  breakBefore: { enabled: true, parity: 'odd' }, advancedDesign: titleOnly };
// #endregion

// #region title: the title page and the imprint on its back
const onPage = (y) => at('top', 0, y, 'page');
const blind = { numbered: false, toc: false, span: 'page', runningChapter: false,
  header: { elements: [] }, footer: { elements: [] } }; // i and ii count, but do not print
const titlePage = { id: 'title', ...blind, breakBefore: { enabled: true, parity: 'any' },
  advancedDesign: design([
    text('series', '{attr.series}', SERIF, 9, onPage(36), { color: col('muted'),
      letterSpacing: pt(1.2), textTransform: 'uppercase' }),
    text('title', '{title}', SERIF, 26, { ...onPage(56), size: { width: mm(MEASURE) } },
      { fontWeight: 700, color: col('accent'), lineHeight: 1.2 }),
    text('subtitle', '{subtitle}', SERIF, 13, onPage(84), { italic: true }),
    rule('rule', 98, 20, 'top', 'page'),
    text('author', '{author}', SERIF, 12, onPage(106)),
    text('publisher', '{attr.publisher}', SERIF, 10, onPage(180), { color: col('muted') }),
  ], 0) };
const imprintPage = { id: 'imprint', ...blind, breakBefore: { enabled: true, parity: 'any' },
  advancedDesign: design([
    text('publisher', '{attr.publisher}', SERIF, 9, onPage(150), { fontWeight: 700 }),
    text('edition', '{attr.edition}', SERIF, 8.5, onPage(158)),
    text('isbn', '{attr.isbn}', SERIF, 8.5, onPage(164)),
    text('printer', '{attr.printer}', SERIF, 8, { ...onPage(172), size: { width: mm(MEASURE) } },
      { color: col('muted'), lineHeight: 1.4 }),
  ], 0) };
// #endregion

// #region contents: what :::toc prints
const contents = {
  levels: [{ level: 1, fontSize: pt(10.5), lineHeight: pt(LEAD) },
    { level: 2, fontSize: pt(9.5), lineHeight: pt(12.5) }],
  pageNumber: { fontFamily: SERIF, fontSize: pt(9.5), color: col('accent'), width: mm(8) },
  leader: { char: '. ', gap: mm(2.5) },
};
// #endregion

// #region print: PDF/X-1a on FOGRA39, 3 mm bleed and crop marks
const print = { standard: 'pdfx1a', outputProfile: 'fogra39' };
const cutLines = { enabled: true, bleed: mm(BLEED) };
const PROFILES = 'https://postext.dev/icc/';
// #endregion

const config = () => ({
  locale: 'tr',
  numerals: 'latn',
  colorPalette,
  page: { width: mm(W), height: mm(H), dpi: 150, backgroundColor: col('paper'), pageNumbering,
    cutLines,
    margins: { top: mm(TOP), bottom: mm(BOTTOM), left: mm(INNER), right: mm(OUTER), mirror: true } },
  layout: { layoutType: 'single' },
  bodyText: { fontFamily: SERIF, fontSize: pt(SIZE), lineHeight: pt(LEAD), color: col('ink'),
    boldColor: col('ink'), italicColor: col('ink'), referenceColor: col('ink'),
    textAlign: 'justify', firstLineIndent: mm(5), indentAfterHeading: false,
    hyphenation: { enabled: true }, scriptFonts,
    optimalLineBreaking: true, avoidWidows: true, avoidOrphans: true },
  headings: { fontFamily: SERIF, fontWeight: 700, color: col('accent'),
    levels: [
      { level: 1, fontSize: pt(17), breakBefore: { enabled: true, parity: 'odd' },
        advancedDesign: opener },
      { level: 2, fontSize: pt(11.5), marginTop: pt(LEAD), marginBottom: pt(LEAD / 2) },
    ] },
  headingStyles: [titlePage, imprintPage, front, back],
  paragraphStyles: [ayet, kaynak],
  toc: contents,
  footnotes, header, footer, print,
});

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ ''; // content.<lang>.md, inlined by the Cookbook

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = { // every face the pages use, loaded before the build
  'Libertinus Serif': ['400', '400i', '700', '700i'], // SERIF: text, notes, headings, heads
  Amiri: ['400', '700'], // NASKH: the Arabic quotations
};

// ─── 4 · Build & show ───────────────────────────────────────────────────────
await loadFonts(FONTS, markdown);
// The arabic file of Amiri, which loadFonts leaves out (gotcha: arabic-fonts-subset).
await loadArabicFonts(FONTS, markdown);
const doc = await withLoadedFonts(() => buildDocument({ markdown }, config()),
  { ...kitFonts(FONTS), text: markdown });
showBook(doc, { title: 'İlim Geleneği Üzerine' });
offerPdf(() => renderToPdf(doc, { fontProvider: arabicPdfProvider, profileBaseUrl: PROFILES }),
  `${RECIPE}.pdf`);

// @kit core fonts viewer pdf arabic book · the Cookbook inlines cookbook/_kit/*.js here
