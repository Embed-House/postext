// ═══ Postext Cookbook · Nº 164 · Songbook: melody, words under the notes, chords ═══════
// https://postext.dev/en/cookbook/songbook-melody-words-chords
// Code: MIT · Words and tunes: public domain (see the notes in each edition) · Prose: CC BY 4.0
// Fonts: Spectral, Spectral SC, Fraunces (SIL OFL 1.1); Leland (music) · Needs postext ≥ 1.54.0
import {
  buildDocumentWithFonts, renderPageToCanvas, initMusicEngine,
} from 'https://esm.sh/postext';
import { renderToPdf, decompressWoff2 } from 'https://esm.sh/postext-pdf';

const LANG = 'en'; // @lang: the language of the sample document ('en' | 'es')
const RECIPE = 'songbook-melody-words-chords';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
const palette = { // every colour in the config links to one of these
  ink: '#211e1b', // text and notes: a warm near-black
  madder: '#8a3324', // the one accent: song numbers, the title page, credit lines
  tint: '#f1e7d8', // the subtitle on the madder ground (8.2:1)
  rule: '#cbbca6', // hairlines
  muted: '#675e55', // running heads, notes and the colophon (5.9:1 on the paper)
  paper: '#fbf8f1', // a cream stock
};
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
const colorPalette = [
  ...Object.entries(palette).map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } })),
  // The engine's defaults link to 'main-color': point it at the accent, so nothing prints blue.
  { id: 'main-color', name: 'madder (defaults)', value: { hex: palette.madder, model: 'hex' } },
];
const [TEXT, LABEL, DISPLAY] = ['Spectral', 'Spectral SC', 'Fraunces'];
const LEAD = 14; // pt: the body's leading
const OUTER = 15; // mm: the outer margin, where the running heads and folios align

// #region answer: the score style: a 5 mm staff in Leland, the words in the book's face
// A song is an ```abc fence in the Markdown: the melody, its chords written "G" before the note
// they fall on, and the first verse on a w: line under it. The look is set here, once.
const scoreStyle = {
  staffSize: mm(5.5), // a songbook rastral; the words under it come out at about 8 pt
  musicFont: 'Leland', // lighter noteheads than Bravura, close to Spectral's colour
  textFont: TEXT, // words and chord names in the text face, not the engraver's Times
  spacing: 1, // the engraver's own: five or six bars of 3/4 to a system on this measure
  barNumbers: 'none', // a table of singers counts verses, not bars
  systemGap: mm(4.5), // room for the chord names between one system's words and the next
  marginTop: pt(4),
  marginBottom: pt(LEAD),
  color: col('ink'),
  minSystemsAtBreak: 2, // never a lone system at a page foot or head
};
// Two habits of Verovio's ABC reader shape the w: lines. Every sung note takes the next
// syllable in order: the `_` and `*` holds are read as nothing, so the second note of a
// slurred pair (B/G/ under "-ing") gets a no-break space, which prints nothing. A tied note
// takes none. `~` joins two syllables on one note: "de~a-trás".
// #endregion

// #region verse: the other verses, two stanzas side by side under the score
// :::columns{count=2} holds one :::verse block per stanza; each line of the stanza is a
// line of Markdown, the turned lines indented two spaces (one em). A hymn in long lines
// (Amazing Grace) drops the columns: its stanzas stand one under another, centred.
const verse = { id: 'verse', fontSize: pt(9.4), lineHeight: pt(13), hyphenation: false,
  marginBottom: pt(13 / 2) };
const chorus = { id: 'chorus', fontSize: pt(9.4), lineHeight: pt(13), italic: true,
  hyphenation: false, marginBottom: pt(LEAD / 2) };
const colophon = { id: 'colophon', fontFamily: LABEL, fontSize: pt(7.8), lineHeight: pt(11),
  color: col('muted'), textAlign: 'left', firstLineIndent: pt(0), marginTop: pt(LEAD * 2) };
// #endregion

// #region song-head: a song opens under its number, its title and its credit line
// # Amazing Grace {credit="Words John Newton, 1779 · Tune New Britain, American, 1835"}
// The songs run on, three lines apart: a short song shares its page with the next one.
const at = (to, edge, x = 0, y = 0) => ({ anchor: { to, edge }, offset: { x: mm(x), y: mm(y) } });
const text = (id, content, font, size, color, placement, extra = {}) => ({ kind: 'text', id,
  content, fontFamily: font, fontSize: pt(size), color: col(color), align: 'left', placement,
  ...extra });
const songHead = { enabled: true, minHeight: mm(21), slot: { elements: [
  text('number', '{number}', DISPLAY, 26, 'madder', at('container', 'top-left', 0, 1),
    { fontWeight: 600, lineHeight: 1 }),
  text('title', '{titleText}', DISPLAY, 21, 'ink', { ...at('container', 'top-left', 12, 2),
    size: { width: mm(100) } }, { fontWeight: 600, lineHeight: 1.05 }),
  text('credit', '{attr.credit}', LABEL, 8.4, 'madder', { ...at('#title', 'below', 0, 2.2),
    size: { width: mm(100) } }, { fontWeight: 600, letterSpacing: pt(0.6) }),
] } };
const songs = { level: 1, numberingTemplate: '{1}', advancedDesign: songHead,
  marginTop: pt(LEAD * 3), marginBottom: pt(0), breakBefore: { enabled: false } };
// #endregion

// #region front: the title page on a madder field, then the note to the singers
const display = (id, content, font, size, color, y, extra = {}) => text(id, content, font, size,
  color, { ...at('page', 'top', 0, y), size: { width: mm(118) } }, { align: 'center', ...extra });
const titlePage = { id: 'title-page', numbered: false, toc: false, span: 'page',
  header: { elements: [] }, footer: { elements: [] },
  advancedDesign: { enabled: true, slot: { elements: [
    { kind: 'box', id: 'field', style: { backgroundColor: col('madder') },
      placement: { ...at('bleed', 'top-left'), size: { width: 'fill', height: mm(132) } } },
    display('kicker', '{author}', LABEL, 10, 'tint', 40, { letterSpacing: pt(2),
      fontWeight: 600 }),
    display('title', '{titleText}', DISPLAY, 46, 'paper', 54, { fontWeight: 600,
      lineHeight: 1 }),
    display('subtitle', '{subtitle}', TEXT, 13, 'tint', 104, { italic: true }),
    display('press', '{attr.press}', LABEL, 9, 'muted', 182, { letterSpacing: pt(1.6),
      fontWeight: 600 }),
  ] } } };
// The note to the singers and the notes at the back are plain headings with no number;
// the front one has no running head and stays out of the contents.
const plain = { numbered: false, advancedDesign: { enabled: false }, fontFamily: DISPLAY,
  fontWeight: 600, fontSize: pt(21), lineHeight: pt(LEAD * 2), marginBottom: pt(LEAD / 2),
  breakBefore: { enabled: true, parity: 'any' } }; // gotcha: style-inherits-break
const front = { ...plain, id: 'front', toc: false, header: { elements: [] } };
const back = { ...plain, id: 'back' };
// #endregion

// #region contents: song number, title, a dotted leader and the page
const toc = {
  levels: [{ level: 1, fontFamily: TEXT, fontSize: pt(10.5), numberFontFamily: DISPLAY,
    numberFontWeight: 600, numberColor: col('madder'), numberWidth: mm(6), numberGap: mm(2) }],
  pageNumber: { fontFamily: LABEL, fontSize: pt(9.5), color: col('muted'), width: mm(6) },
  leader: { char: '. ', gap: mm(2) },
};
// #endregion

// #region heads: the book on the verso, the song on the recto, folios outside
const head = (id, content, parity, edge, x, style = {}) => ({
  kind: 'text', id, content, parity, pages: 'all', // a song's first page carries them too
  fontFamily: LABEL, fontSize: pt(8.4), fontWeight: 600, letterSpacing: pt(0.9),
  color: col('muted'), ...style,
  placement: { anchor: { to: 'page', edge }, offset: { x: mm(x), y: mm(12.5) } },
});
const folio = { fontFamily: TEXT, fontWeight: 600, letterSpacing: pt(0), color: col('madder') };
const header = { elements: [
  head('verso-folio', '{pageNumber}', 'even', 'top-left', OUTER, folio),
  head('verso-title', '{title}', 'even', 'top-left', OUTER + 8),
  head('recto-song', '{chapterTitle}', 'odd', 'top-right', -(OUTER + 8)),
  head('recto-folio', '{pageNumber}', 'odd', 'top-right', -OUTER, folio),
] };
// #endregion

const config = {
  locale: t({ en: 'en-us', es: 'es' }), // each edition's hyphenation patterns
  colorPalette,
  page: { // A5, the size of a parish songbook; mirror: left is the inner margin
    sizePreset: 'custom', width: mm(148), height: mm(210), dpi: 150,
    backgroundColor: col('paper'),
    margins: { top: mm(22), bottom: mm(20), left: mm(19), right: mm(OUTER), mirror: true },
  },
  layout: { layoutType: 'single' },
  bodyText: {
    fontFamily: TEXT, fontSize: pt(10.3), lineHeight: pt(LEAD), color: col('ink'),
    boldColor: col('madder'), italicColor: col('ink'), referenceColor: col('ink'),
    textAlign: 'justify', firstLineIndent: mm(4), indentAfterHeading: false,
    hyphenation: { enabled: true }, optimalLineBreaking: true,
    avoidWidows: true, avoidOrphans: true, avoidRunts: true,
  },
  headings: {
    fontFamily: DISPLAY, fontWeight: 600, color: col('ink'),
    levels: [songs, { level: 2, fontFamily: LABEL, fontSize: pt(9.5), lineHeight: pt(LEAD),
      letterSpacing: pt(1.4), color: col('madder'), marginTop: pt(LEAD), marginBottom: pt(4) }],
  },
  headingStyles: [titlePage, front, back],
  toc,
  scoreStyle,
  paragraphStyles: [verse, chorus, colophon],
  header,
  footer: { elements: [] },
};

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ ''; // content.<lang>.md, inlined by the Cookbook

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = {
  Spectral: ['400', '400i', '600', '700', '700i'], // 700: stanza numbers, the Chorus label
  'Spectral SC': ['400', '600'],
  Fraunces: ['600'],
};

// ─── 4 · Build & show ───────────────────────────────────────────────────────
await initMusicEngine(); // Verovio, from esm.sh: until it runs, a score is a grey box
const doc = await buildDocumentWithFonts({ markdown }, config, kitFonts(FONTS));
showPages(doc, { title: t({ en: 'Songs for the Long Table', es: 'Cancionero de la merienda' }) });
offerPdf(() => renderToPdf(doc, { fontProvider: fontsourceProvider }), `${RECIPE}.pdf`);

// @kit core fonts viewer pdf · the Cookbook inlines cookbook/_kit/*.js here
