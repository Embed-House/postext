// ═══ Postext Cookbook · Nº 158 · An illustrated timeline across a double page ═══════
// https://postext.dev/en/cookbook/illustrated-timeline-spread
// Code: MIT · Text: original (CC BY 4.0) · Pictures: generated with diffusion models
// Fonts: Literata, Archivo, Noto Serif JP, Noto Sans JP (SIL OFL 1.1) · Needs postext ≥ 1.49.0
import {
  buildDocument, withLoadedFonts, renderPageToCanvas, registerResourceImage,
} from 'https://esm.sh/postext';
import { renderToPdf, decompressWoff2 } from 'https://esm.sh/postext-pdf';

const LANG = 'es'; // @lang: the language of the sample document ('es' | 'en' | 'ja')
const RECIPE = 'illustrated-timeline-spread';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// #region palette: one ink, an accent for each half of the timeline, a pale ground
const palette = {
  ink: '#22201d', // text
  asia: '#2f4f7a', // indigo: the Asian half of the timeline
  europe: '#a2412a', // terracotta: the European half
  ground: '#f1ebdf', // the cream under the cards
  rule: '#c9bfae', // hairlines and the card borders
  muted: '#6b6359', // running heads and the colophon
  paper: '#ffffff',
};
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
const colorPalette = [
  ...Object.entries(palette).map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } })),
  { id: 'main-color', name: 'europe (defaults)', value: { hex: palette.europe, model: 'hex' } },
];
// #endregion

const JA = LANG === 'ja';
const SERIF = JA ? 'Noto Serif JP' : 'Literata';
const SANS = JA ? 'Noto Sans JP' : 'Archivo';
// A Western textbook page is 210 × 280 mm; a Japanese one is AB判, 210 × 257 mm.
const PAGE = { w: 210, h: JA ? 257 : 280, top: 22, bottom: 20, inner: 16, outer: 15 };
const ROWS = 12;
const ROW_GAP = 3;
const ROW = (PAGE.h - PAGE.top - PAGE.bottom - (ROWS - 1) * ROW_GAP) / ROWS; // one grid row, mm
const BAND = 9; // the timeline band, in grid row 5
const CARD_TOP = 5 * (ROW + ROW_GAP); // grid row 6
// The drawn height of a card; 16 mm of the area stay free for a longer text.
const CARD = PAGE.h - PAGE.top - PAGE.bottom - CARD_TOP - 16;
const at = (to, edge, x = 0, y = 0) => ({ anchor: { to, edge }, offset: { x: mm(x), y: mm(y) } });

// #region cards: one card frame per row, repeated by a grid once for each card of the Markdown
// Each `:::frame{slot="asia"}` of the page is an item of the `asia` grid: the grid lays the
// card frame once per item, three to a row, and names the copies `#asia[1]`, `#asia[2]`…
const card = (name, style) => ({ name, style, minHeight: mm(CARD) }); // auto above that height
const row = (name, col) => ({ name: `${name}-row`, kind: 'grid', columns: 3, columnGap: mm(5),
  grid: { col, row: 6, rows: ROWS - 5 }, repeat: { frames: [name] } });
// #endregion

// #region answer: one sheet for two pages, a band across the spine, two rows of cards
const pageTemplates = [{
  id: 'timeline',
  spread: true, // two facing pages laid as one sheet; it opens on a verso
  gutter: mm(10), // the band round the spine that frames keep off
  grid: { columns: 2, rows: ROWS, columnGap: mm(2 * PAGE.inner), rowGap: mm(ROW_GAP) },
  frames: [
    { name: 'title', takes: 'h1' },
    { name: 'lead', flow: true, fit: { minScale: 0.8 } },
    { name: 'box', style: 'box', grid: { col: 2, row: 1, rows: 4 }, height: 'fill',
      padding: { right: mm(66) }, fit: { minScale: 0.85 } },
    { name: 'box-picture', layer: 2, width: mm(56), placement: at('#box', 'top-right', -5, 10) },
    { name: 'band-1', style: 'band-asia', grid: { col: 1, row: 5 }, height: mm(BAND) },
    { name: 'band-2', style: 'band-europe', crossGutter: true, width: 'fill', height: mm(BAND),
      padding: { left: mm(2 * PAGE.inner + 4) }, // the colour crosses the fold, the words do not
      placement: at('#band-1', 'right-of') },
    card('asia', 'card-asia'), card('europe', 'card-europe'),
    { name: 'colophon', style: 'colophon', optional: true, width: mm(170),
      placement: at('page', 'bottom-right', -PAGE.outer, -7) },
  ],
  groups: [
    { name: 'opening', kind: 'stack', grid: { col: 1, row: 1, rows: 4 }, gap: mm(4),
      frames: ['title', 'lead'] },
    // A row of cards under each band, as many as the Markdown has: a longer text makes its
    // row taller, and the other cards of the row stretch to the same height.
    row('asia', 1), row('europe', 2),
  ],
  decoration: { elements: [ground(), ticks('band-1', 'asia'), ticks('band-2', 'europe')] },
}];
// #endregion

// #region ticks: one connector per band, a drop with a ring down to every card of its row
// `routing: 'tree'` with `trunk: 0` draws no bar of its own: each drop hangs from the band's
// foot straight down to the middle of a card's top, and `#asia[*]` names every card laid.
function ticks(band, cards) {
  return { kind: 'connector', id: `${cards}-ticks`, routing: 'tree', trunk: 0,
    from: { to: `#${band}`, side: 'bottom', gap: mm(2.4) }, to: { to: `#${cards}[*]`, side: 'top' },
    color: col(cards), width: pt(1), startCap: 'ring', capSize: mm(3.6) };
}
// #endregion

// The cream ground under the cards: from the foot of the band down to the bleed.
function ground() {
  return { kind: 'box', id: 'ground', decorative: true,
    placement: { ...at('bleed', 'bottom-left'), size: { width: 'fill',
      height: { to: '#band-1', edge: 'bottom' } } },
    style: { backgroundColor: col('ground') } };
}

const tab = (ink) => ({ position: 'top-left', background: col(ink), color: col('paper'),
  fontFamily: SANS, fontSize: pt(10), fontWeight: 700, height: mm(6), paddingX: mm(2.6),
  offset: mm(3.5), inset: mm(0), rule: { enabled: false } });
const cardStyle = (id, ink) => ({ id, backgroundEnabled: true, background: col('paper'),
  border: { enabled: true, color: col('rule'), width: pt(0.5) }, borderRadius: mm(1.5),
  stripe: { enabled: true, side: 'top', width: pt(2.5), color: col(ink) },
  padding: { top: mm(8), right: mm(3.5), bottom: mm(3.5), left: mm(3.5) },
  label: tab(ink),
  body: { fontFamily: SERIF, fontSize: pt(JA ? 8.6 : 9.4), lineHeight: pt(JA ? 15 : 12.8),
    color: col('ink'), boldColor: col(ink), italicColor: col('ink'),
    textAlign: JA ? 'justify' : 'left', hyphenation: !JA, firstLineIndent: pt(0),
    boldFontWeight: 700 } });
const bandStyle = (id, ink) => ({ id, backgroundEnabled: true, background: col(ink),
  border: { enabled: false }, padding: { top: mm(1.6), right: mm(4), bottom: mm(1), left: mm(4) },
  body: { fontFamily: SANS, fontSize: pt(9.5), lineHeight: pt(12), fontWeight: 700,
    color: col('paper'), firstLineIndent: pt(0) } });

const head = (id, content, parity, edge, x) => ({ kind: 'text', id, content, parity,
  fontFamily: SANS, fontSize: pt(8), fontWeight: 600, letterSpacing: pt(JA ? 0 : 0.8),
  color: col('muted'), placement: at('page', edge, x, 11) });
const folio = (id, parity, edge, x) => ({ kind: 'text', id, content: '{pageNumber}', parity,
  fontFamily: SANS, fontSize: pt(9), fontWeight: 700, color: col('ink'),
  placement: at('page', edge, x, -10) });

const config = {
  canvasViewer: { pageGap: 0 }, // the Canvas joins the two pages of a spread
  locale: t({ es: 'es', en: 'en-gb', ja: 'ja' }),
  resourceTypes: [{ id: 'picture', name: t({ es: 'Ilustración', en: 'Illustration',
    ja: 'イラスト' }), shortLabel: '', numberingTemplate: '', resetOn: 'never',
  counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } }],
  colorPalette,
  page: {
    sizePreset: 'custom', width: mm(PAGE.w), height: mm(PAGE.h), dpi: 150,
    margins: { top: mm(PAGE.top), bottom: mm(PAGE.bottom), left: mm(PAGE.inner),
      right: mm(PAGE.outer), mirror: true },
  },
  layout: { layoutType: 'single' },
  bodyText: {
    fontFamily: SERIF, fontSize: pt(JA ? 10.5 : 12.4), lineHeight: pt(JA ? 18.5 : 17),
    paragraphSpacing: !JA,
    color: col('ink'), boldColor: col('ink'), italicColor: col('ink'),
    referenceColor: col('ink'), textAlign: JA ? 'justify' : 'left',
    firstLineIndent: JA ? em(1) : pt(0), // Japanese paragraphs open with a one-character indent
    hyphenation: { enabled: !JA },
  },
  headings: {
    fontFamily: SANS, color: col('ink'), fontWeight: 800,
    levels: [{ level: 1, fontSize: pt(JA ? 44 : 58), lineHeight: pt(JA ? 54 : 60),
      color: col('asia'), marginTop: pt(0), marginBottom: pt(0),
      breakBefore: { enabled: false } }],
  },
  orderedLists: { numberFormat: 'arabic', color: col('europe'), fontWeight: 700 },
  calloutStyles: [
    { id: 'box', backgroundEnabled: true, background: col('paper'),
      border: { enabled: true, color: col('rule'), width: pt(0.5) },
      borderRadius: mm(1.5), padding: { top: mm(9), right: mm(5), bottom: mm(4), left: mm(5) },
      label: tab('europe'),
      body: { fontFamily: SERIF, fontSize: pt(JA ? 9.5 : 10.4), lineHeight: pt(JA ? 16.5 : 14.2),
        color: col('ink'), boldColor: col('ink'), italicColor: col('ink'), textAlign: 'left',
        firstLineIndent: pt(0), paragraphSpacing: true },
      lists: { color: col('europe'), gap: mm(1.5), itemSpacing: mm(1.2) } },
    cardStyle('card-asia', 'asia'), cardStyle('card-europe', 'europe'),
    bandStyle('band-asia', 'asia'), bandStyle('band-europe', 'europe'),
    { id: 'colophon', backgroundEnabled: false, border: { enabled: false },
      padding: { top: mm(0), right: mm(0), bottom: mm(0), left: mm(0) },
      body: { fontFamily: SANS, fontSize: pt(6.5), lineHeight: pt(8), color: col('muted'),
        firstLineIndent: pt(0) } },
  ],
  header: { elements: [
    head('subject', '{attr.subject}', 'even', 'top-left', PAGE.outer),
    head('unit', '{attr.unit}', 'odd', 'top-right', -PAGE.outer),
  ] },
  footer: { elements: [
    folio('verso-folio', 'even', 'bottom-left', PAGE.outer),
    folio('recto-folio', 'odd', 'bottom-right', -PAGE.outer),
  ] },
  pageTemplates,
};
// The spread opens on a verso: page 1 of this excerpt is book page 48.
const continuation = { pageIndexOffset: 1, pageNumbering: { startAt: 48 } };

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ ''; // content.<lang>.md, inlined by the Cookbook

// #region art: seven pictures at the size they print, with what each shows
const ART = {
  v105: t({ es: 'Un funcionario de la corte Han mira cómo un artesano saca de la tina un molde '
      + 'de bambú lleno de pasta, junto a corteza, trapos y redes viejas.',
    en: 'A Han court official watches a craftsman lift a bamboo mould full of pulp from a vat, '
      + 'beside bark, rags and old nets.',
    ja: '漢の役人が見守るなか、職人が竹のすき枠を漉き舟から引き上げる。そばに樹皮、ぼろ布、古い網。' }),
  v610: t({ es: 'Un monje enseña a dos cortesanos japoneses a sostener el molde sobre una tina, '
      + 'con ramas de kozo en una estera.',
    en: 'A monk shows two Japanese courtiers how to hold the mould over a tub, with kozo '
      + 'branches on a mat.',
    ja: '僧が二人の宮廷人に、桶の上ですき枠を持つ手つきを見せる。むしろの上に楮の枝。' }),
  v751: t({ es: 'Papeleros de Samarcanda junto a un canal; las hojas se secan al sol contra un '
      + 'muro de adobe.',
    en: 'Samarkand papermakers by a canal; the sheets dry in the sun against a mud-brick wall.',
    ja: '水路のそばで働くサマルカンドの紙すき職人。日干しれんがの壁に紙が張られて乾いている。' }),
  v1150: t({ es: 'Un taller de Xàtiva bajo el castillo: un operario golpea trapos en una pila '
      + 'de piedra y las hojas cuelgan de cuerdas.',
    en: 'A workshop in Xàtiva below the castle: a worker pounds rags in a stone trough and the '
      + 'sheets hang on ropes.',
    ja: '城の下のシャティバの工房。職人が石の槽でぼろ布をたたき、紙が綱につるされている。' }),
  v1282: t({ es: 'Un molino de Fabriano con su rueda hidráulica y sus mazos; un papelero mira '
      + 'una filigrana al trasluz.',
    en: 'A Fabriano mill with its water wheel and hammers; a papermaker holds a watermark up '
      + 'to the light.',
    ja: '水車と木づちのあるファブリアーノの製紙場。職人が紙を光にかざして透かしを見ている。' }),
  v1844: t({ es: 'Un artesano aprieta un tronco de abeto contra una muela que gira; debajo se '
      + 'amontonan las fibras.',
    en: 'A craftsman presses a spruce log against a turning grindstone; the fibres pile up '
      + 'below.',
    ja: '職人がトウヒの丸太を回る砥石に押し当て、その下に木の繊維が積もっていく。' }),
  forma: t({ es: 'Dos manos sacan de la tina el molde con una capa fina de fibras.',
    en: 'Two hands lift the mould from the vat with a thin layer of fibres on it.',
    ja: '両手ですき枠を引き上げる。網の上に繊維の薄い層ができている。' }),
};
const SIZE = { forma: [800, 800, 363] }; // pixels and ppi: 56 mm wide; the cards' are 46 mm
const resources = await Promise.all(Object.entries(ART).map(async ([id, altText]) => {
  const px = SIZE[id] ?? [1000, 667, 550];
  const fileId = `${id}-${px[0]}.jpg`;
  await loadImage(fileId, asset(fileId));
  return { id, typeId: 'picture', kind: 'bitmap', caption: '', altText, createdAt: 0,
    updatedAt: 0,
    bitmap: { fileId, format: 'jpeg', width: px[0], height: px[1], resolution: px[2] } };
}));
// #endregion

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = {
  Literata: ['400', '400i', '700'], Archivo: ['400', '600', '700', '800'], // es, en
  'Noto Serif JP': ['400', '700'], 'Noto Sans JP': ['400', '600', '700', '800'], // ja
};

// ─── 4 · Build & show ───────────────────────────────────────────────────────
await loadFonts(FONTS, markdown); // the latin files of every face
await loadCjkFonts({ [SERIF]: FONTS[SERIF], [SANS]: FONTS[SANS] }, markdown); // ja only
const doc = await withLoadedFonts(
  () => buildDocument({ markdown, resources, continuation }, config),
  { ...kitFonts(FONTS), text: markdown });
showPages(doc, { title: t({ es: 'Una cronología ilustrada a doble página',
  en: 'An illustrated timeline across a double page', ja: '見開きの絵入り年表' }) });
offerPdf(() => renderToPdf(doc, { fontProvider: cjkPdfProvider, resourceBytes: imageBytes }),
  `${RECIPE}.pdf`);

// @kit core fonts viewer pdf images cjk
