// ═══ Postext Cookbook · Nº 157 · A school atlas labelled from the Markdown ═══════
// https://postext.dev/en/cookbook/school-atlas-labelled-maps
// Code: MIT · Text: original (CC BY 4.0) · Maps: painted with diffusion models, symbols set in code
// Fonts: Source Sans 3, Source Serif 4, Noto Naskh and Kufi Arabic (OFL) · Needs postext ≥ 1.48.0
//
// Three pages of a school atlas of Varenia, an invented country: a locator map, the relief map
// across a double page and a section through the mountains. The maps are painted without a letter.
// Every name on them is a ::label in content.<lang>.md, standing at an anchor of the resource,
// so the Spanish, English and Arabic editions share the same paintings and the same anchors.
import {
  buildDocument, withLoadedFonts, renderPageToCanvas, registerResourceImage,
} from 'https://esm.sh/postext';

const LANG = 'es'; // @lang: the language of the sample document ('es' | 'en' | 'ar')
const RECIPE = 'school-atlas-labelled-maps';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// #region palette: the page's colours and the key's tints, one object for both
const palette = {
  ink: '#1f2a2e', paper: '#ffffff', muted: '#55646a',
  band: '#1d5f73', // the accent: the head of each sheet, box stripes, list numbers
  sky: '#d4e9f2', // the kicker on the band
  tint: '#eef2ef', // the key's box
  water: '#0b2a47', sea: '#8ec5e9', // the names of water, and the sea of the key
  // The key's tints are the median colours of the painted relief at each height band.
  low: '#aec67f', hill: '#ced285', upland: '#efce80', mount: '#d79c61', peak: '#b5734b',
  relief: '#5a3519', // the names of ranges
  land: '#e1dfbe', country: '#ebcb73', border: '#8a3b52', // the locator map's washes and border
};
// col(id) links a colour to its palette entry; the vector symbols read the same hex from `palette`.
const col = (id) => ({ hex: palette[id], model: 'hex', paletteId: id });
const colorPalette = Object.entries({ ...palette, 'main-color': palette.band }) // the defaults' id
  .map(([id, hex]) => ({ id, name: id, value: { hex, model: 'hex' } }));
// #endregion
const AR = LANG === 'ar';
// Three voices per script: a text face, a display face and the face of the map labels.
const [TEXT, DISPLAY, LABEL] = AR ? ['Noto Naskh Arabic', 'Noto Kufi Arabic', 'Noto Kufi Arabic']
  : ['Source Sans 3', 'Source Serif 4', 'Source Sans 3'];
const PAGE = { w: 210, h: 280, top: 22, bottom: 20, inner: 18, outer: 15 }; // mm, mirrored
const BAND = 44; // mm from the trim to the foot of the band at the head of a sheet

// #region answer: label styles in the config, label fields on the anchors of a resource
// A label takes the style its anchor names: seas and rivers in italic blue, ranges in spaced
// brown capitals, towns on a white halo. Arabic is neither slanted nor letter-spaced, and
// Naskh and Kufi set small, so the Arabic edition gets the same styles upright, unspaced and
// 15 % larger.
const [SLANT, TRACK, SIZE] = AR ? ['normal', 0, 1.15] : ['italic', 1, 1];
const halo = { color: col('paper'), width: pt(1.4) };
const style = (id, size, color, more) => ({ id, fontFamily: LABEL, fontSize: pt(size * SIZE),
  fontWeight: AR ? 500 : 400, color: col(color), ...more });
const water = (id, size, spacing, more) => style(id, size, 'water', { fontStyle: SLANT,
  textTransform: spacing ? 'uppercase' : 'none', letterSpacing: spacing * TRACK, ...more });
const caps = (id, size, color, spacing, more) => style(id, size, color, {
  fontWeight: AR ? 700 : 600, textTransform: 'uppercase', letterSpacing: spacing * TRACK,
  ...more });
const labelStyles = [
  water('ocean', 9.5, 0.3), water('sea', 7.5, 0.16), water('river', 6.8, 0, { halo }),
  caps('range', 7, 'relief', 0.32, { halo }), caps('region', 6.5, 'muted', 0.24, { halo,
    leader: { color: col('ink'), width: pt(0.6), endCap: 'dot', capSize: mm(1.2) } }),
  style('legend', 7.6, 'ink', { kind: 'legend', background: col('paper'), padding: mm(2.4),
    border: { color: col('muted'), width: pt(0.4) }, radius: mm(1) }),
  caps('country', 8.5, 'muted', 0.36, { halo }), caps('nation', 12, 'ink', 0.42, { halo }),
  style('capital', 7.6, 'ink', { fontWeight: 700, halo }), style('town', 7, 'ink', { halo }),
  style('peak', 6.5, 'ink', { fontWeight: AR ? 700 : 600, halo }),
  style('island', 6.5, 'ink', { halo }),
  style('point', 8.5, 'band', { fontWeight: 700, halo }), style('tick', 6, 'muted'),
];
// An anchor is a point of the picture in fractions of its width and height, with the side of
// the label that stands there, its turn and its style. km(win) reads a point in km off a map.
const km = (win) => (id, x, y, labelStyle, more) => ({ id, x: (x - win.x0) / (win.x1 - win.x0),
  y: (y - win.y0) / (win.y1 - win.y0), style: labelStyle, ...more });
// #endregion

// #region templates: a sheet and a double sheet, each a band, a text, a map and two boxes
const at = (to, edge, x = 0, y = 0) => ({ anchor: { to, edge }, offset: { x: mm(x), y: mm(y) } });
const kicker = { kind: 'text', id: 'unit', content: '{attr.unit}', fontFamily: LABEL,
  fontSize: pt(AR ? 10 : 8.5), fontWeight: AR ? 500 : 600, letterSpacing: pt(1.3 * TRACK),
  textTransform: 'uppercase', color: col('sky'), align: AR ? 'right' : 'left',
  // Decoration stands on the sheet: the kicker goes to the side the page starts reading from.
  placement: at('container', AR ? 'top-right' : 'top-left', 0, -11) };
const band = { kind: 'box', id: 'band', style: { backgroundColor: col('band') },
  placement: { ...at('bleed', 'top-left'), size: { width: 'fill', height: mm(BAND + 3) } } };
const sheet = {
  id: 'sheet', header: false, decoration: { elements: [band, kicker] },
  frames: [
    { name: 'title', takes: 'h1', placement: at('container', 'top-left', 0, -3) },
    { name: 'text', flow: true, columns: 2, columnGap: mm(7),
      placement: at('container', 'top-left', 0, BAND - PAGE.top + 7) },
    { name: 'map' },
    { name: 'key', style: 'key', width: mm(66) },
    { name: 'tasks', style: 'tasks', placement: at('#key', 'right-of', 6) },
  ],
  // A longer text pushes the map and the key down; the map is set smaller before the text is.
  groups: [{ name: 'column', kind: 'stack', frames: ['text', 'map', 'key'], gap: mm(6) }],
};
const locator = { id: 'locator', extends: 'sheet', frames: [{ name: 'key', remove: true },
  { name: 'tasks', placement: at('#map', 'below', 0, 6) }],
  groups: [{ name: 'column', frames: ['text', 'map'] }] };
// Line A–B: two connectors between two anchors of the map's picture, cased in paper, dotted ends.
const section = (id, color, width, more) => ({ kind: 'connector', id, routing: 'straight',
  from: { to: '#map', anchor: 'a-end' }, to: { to: '#map', anchor: 'b-end' }, color: col(color),
  width: mm(width), ...more });
const sectionLine = [section('section-casing', 'paper', 0.9), section('section-line', 'ink', 0.5,
  { dash: [mm(1), mm(1)], startCap: 'dot', endCap: 'dot', capSize: mm(2) })];
// The double sheet: one band and one map across both pages, the boxes under the map.
const spread = {
  id: 'spread', spread: true, header: false,
  decoration: { elements: [band, kicker, ...sectionLine] },
  frames: [
    { name: 'title', takes: 'h1', width: mm(177), placement: at('container', 'top-left', 0, -3) },
    { name: 'map', crossGutter: true, // the one frame that runs across the spine
      placement: at('container', 'top-left', 0, BAND - PAGE.top + 5) },
    { name: 'text', flow: true, columns: 2, columnGap: mm(7), width: mm(177) },
    { name: 'key', style: 'key', width: mm(72), placement: at('#map', 'below', 213, 6) },
    { name: 'tasks', style: 'tasks', placement: at('#key', 'right-of', 6) },
  ],
  groups: [{ name: 'column', kind: 'stack', frames: ['map', 'text'], gap: mm(6) }],
};
// #endregion

// Boxes: the key on a pale blue tint, the tasks behind a stripe in the band's blue.
const boxText = { fontFamily: TEXT, fontSize: pt(AR ? 10.5 : 8.6), lineHeight: pt(AR ? 17 : 12),
  color: col('ink'), boldColor: col('ink'), italicColor: col('ink'), firstLineIndent: pt(0),
  textAlign: 'start' }; // ragged in every script: a box's short lines are never stretched
const boxTitle = { fontFamily: LABEL, fontSize: pt(AR ? 9.5 : 8), fontWeight: 700,
  letterSpacing: pt(1.2 * TRACK), textTransform: 'uppercase', color: col('band') };
const calloutStyles = [
  { id: 'key', backgroundEnabled: true, background: col('tint'), border: { enabled: false },
    padding: { top: mm(3), right: mm(3.5), bottom: mm(3), left: mm(3.5) },
    titleStyle: boxTitle, body: boxText },
  { id: 'tasks', backgroundEnabled: false, border: { enabled: false },
    stripe: { enabled: true, side: 'top', width: pt(2.5), color: col('band') },
    padding: { top: mm(2.5), right: mm(0), bottom: mm(0), left: mm(0) },
    titleStyle: boxTitle, body: boxText },
];

// The folio and the atlas's name at the foot, on the outer side. An Arabic book is bound on the
// right, so its rectos (odd pages) stand left of the spine and their outer edge is the left.
const foot = (parity) => {
  const left = (parity === 'even') !== AR;
  const text = (id, content, x, extra) => ({ kind: 'text', id: `${id}-${parity}`, content, parity,
    fontFamily: LABEL, fontSize: pt(AR ? 9 : 8), fontWeight: AR ? 500 : 400, color: col('muted'),
    align: left ? 'left' : 'right', ...extra,
    placement: at('page', left ? 'bottom-left' : 'bottom-right', left ? x : -x, -11) });
  return [text('folio', '{pageNumber}', PAGE.outer, { fontWeight: 700, color: col('band') }),
    text('title', '{title}', PAGE.outer + 8)];
};
const footer = { elements: [...foot('even'), ...foot('odd')] };

const config = {
  canvasViewer: { pageGap: 0 }, // the Canvas joins the two pages of a spread
  locale: t({ es: 'es', en: 'en-gb', ar: 'ar' }), // written out: Arabic sets the page right to left
  colorPalette, labelStyles, calloutStyles, footer,
  header: { elements: [] },
  pageTemplates: [sheet, locator, spread],
  // The maps are a type of their own with no caption: their titles are the pages' headings.
  resourceTypes: [{ id: 'map', name: t({ es: 'Mapa', en: 'Map', ar: 'خريطة' }), shortLabel: '',
    numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '',
    defaultPlacement: { position: 'here' } }],
  page: { sizePreset: 'custom', width: mm(PAGE.w), height: mm(PAGE.h), dpi: 150,
    margins: { top: mm(PAGE.top), bottom: mm(PAGE.bottom), left: mm(PAGE.inner),
      right: mm(PAGE.outer), mirror: true } },
  layout: { layoutType: 'single' },
  bodyText: AR
    ? { fontFamily: TEXT, fontSize: pt(12), lineHeight: pt(20), color: col('ink'),
      boldColor: col('ink'), italicColor: col('ink'), referenceColor: col('ink'),
      textAlign: 'justify', firstLineIndent: em(1), hyphenation: { enabled: false } }
    : { fontFamily: TEXT, fontSize: pt(10), lineHeight: pt(14), color: col('ink'),
      boldColor: col('ink'), italicColor: col('ink'), referenceColor: col('ink'),
      textAlign: 'left', firstLineIndent: mm(0), paragraphSpacing: true,
      hyphenation: { enabled: true }, optimalLineBreaking: true, avoidWidows: true,
      avoidOrphans: true, avoidRunts: true },
  headings: { fontFamily: DISPLAY, fontWeight: 700, color: col('paper'), levels: [
    { level: 1, fontSize: pt(AR ? 24 : 26), lineHeight: pt(AR ? 34 : 30),
      marginTop: pt(0), marginBottom: pt(0), breakBefore: { enabled: false } },
  ] },
  orderedLists: { numberFormat: 'arabic', color: col('band'), fontWeight: 700,
    marginTop: pt(0), marginBottom: pt(0) },
  paragraphStyles: [{ id: 'colophon', fontFamily: TEXT, fontSize: pt(AR ? 8.5 : 7.5),
    lineHeight: pt(AR ? 14 : 10), color: col('muted'), textAlign: 'start',
    firstLineIndent: pt(0) }],
};

// ─── 2 · Content ────────────────────────────────────────────────────────────
const markdown = /* @content */ ''; // content.<lang>.md: every word of the pages, maps included


// #region art: three paintings (JPEGs in assets/) under the vector furniture of a map
// Varenia is invented: its coast, ranges, rivers and lake are painted, without a letter, in the
// manner of a printed school atlas, and the two other plates are painted from the relief plate
// so their coasts agree. What a map must keep exact stays vector over the painting: borders,
// the line of section, towns, peaks, the scale and the north arrow. Every name, number and the
// N of the arrow is a ::label of the Markdown, standing at an anchor of ANCHORS. Positions are
// kilometres (x east, y south) of the country the painting shows, read off its grid.
const MAP = { locator: [177, 118], relief: [390, 160], section: [177, 100] }; // plates, in mm
const WIN = { // the km each map shows: x east, y south
  relief: { x0: 0, x1: 400, y0: 0, y1: 400 * MAP.relief[1] / MAP.relief[0] },
  locator: { x0: -330, x1: 770, y0: -520, y1: -520 + 1100 * MAP.locator[1] / MAP.locator[0] },
};
const TOWNS = [['almaren', 259, 127, 'capital'], ['calvera', 53, 66], ['tessa', 108, 142],
  ['sora', 296, 132], ['brena', 346, 92]];
const PEAKS = [['albar', 181, 54], ['gris', 325, 55]];
const PROFILE = [[92, 32], [166, 134]]; // A and B, the ends of the section
const PROFILE_TOP = 2600; // m at the head of the section
const SCALE = { x: 8, y: 157 }, NORTH = { x: 22, y: 140 }; // the scale bar and the arrow
// Borders in km, cut where they reach the painted coast: Varenia with Ostelia and with
// Brunavia on the relief map, and those two with the border of Ostelia and Brunavia.
const BORDERS = {
  relief: [[[59, 9], [80, 6], [128, 10], [172, 18], [214, 12], [256, 24], [298, 22], [376, 44]],
    [[376, 44], [372, 76], [380, 104], [368, 132], [371, 144]]],
  locator: [[[59, 9], [80, 6], [128, 10], [172, 18], [214, 12], [256, 24], [298, 22], [376, 44]],
    [[376, 44], [372, 76], [380, 104], [368, 132], [371, 144]],
    [[376, 44], [392, -40], [386, -132]], [[396, -222], [420, -330], [404, -520]]],
};
const r1 = (n) => Math.round(n * 10) / 10;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" `
  + `width="${w * 10}" height="${h * 10}">${body}</svg>`;
const line = (d, id, width, more = '') => `<path d="${d}" fill="none" stroke="${palette[id]}" `
  + `stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${more}/>`;
// A painting as a data URL: an SVG drawn as an image cannot fetch anything itself.
async function dataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Painting not found (${res.status}): ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:image/jpeg;base64,${btoa(bin)}`;
}
const picture = (art, w, h, x = 0) => `<image href="${art}" x="${x}" width="${w}" height="${h}" `
  + `preserveAspectRatio="none"/>`;
// A line over a painting is cased in paper so it reads on green, ochre and blue alike.
const cased = (d, id, width, dash) => line(d, 'paper', width + 0.9, ' stroke-opacity="0.55"')
  + line(d, id, width, ` stroke-dasharray="${dash}"`);
const mapPath = (s, pts) => `M${pts.map(([x, y]) => `${s.X(x)} ${s.Y(y)}`).join('L')}`;
// The window win = { x0, x1, y0, y1 } in km laid out w mm wide: X and Y turn km into mm.
const frame = (win, w) => {
  const k = w / (win.x1 - win.x0);
  return { k, X: (x) => r1((x - win.x0) * k), Y: (y) => r1((y - win.y0) * k) };
};
const plate = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" `
  + `fill="${palette.paper}" fill-opacity="0.72"/>`;
function reliefMap([w, h], art) { // the spread: the painted relief, borders, towns, a scale
  const s = frame(WIN.relief, w);
  let out = picture(art, w, h);
  for (const run of BORDERS.relief) out += cased(mapPath(s, run), 'border', 0.7, '2.4 1.2');
  // The line of section A–B is not drawn here: two connectors of the template join its ends.
  const dot = (x, y, r, more = '') => `<circle cx="${s.X(x)}" cy="${s.Y(y)}" r="${r}" `
    + `fill="${palette.ink}"${more}/>`;
  const ring = ` stroke="${palette.paper}" stroke-width="0.5"`;
  for (const [, x, y, kind] of TOWNS) {
    out += kind === 'capital'
      ? `<rect x="${s.X(x) - 1.4}" y="${s.Y(y) - 1.4}" width="2.8" height="2.8" `
        + `fill="${palette.ink}"${ring}/>`
      : dot(x, y, 1.2, ring);
  }
  for (const [, x, y] of PEAKS) {
    const [px, py] = [s.X(x), s.Y(y)];
    out += `<path d="M${px - 1.5} ${py + 1.1}L${px} ${py - 1.5}L${px + 1.5} ${py + 1.1}Z" `
      + `fill="${palette.ink}"${ring}/>`;
  }
  // A scale of 50 km in the south-west sea, and the north arrow above it, each on a pale plate.
  const [sx, sy] = [s.X(SCALE.x), s.Y(SCALE.y)], step = 25 * s.k;
  out += plate(sx - 4, sy - 2.5, 2 * step + 8, 11.5);
  out += `<rect x="${sx}" y="${sy}" width="${step}" height="1.4" fill="${palette.ink}"/>`
    + `<rect x="${sx + step}" y="${sy}" width="${step}" height="1.4" fill="${palette.paper}" `
    + `stroke="${palette.ink}" stroke-width="0.3"/>`;
  const [ax, ay] = [s.X(NORTH.x), s.Y(NORTH.y)];
  out += plate(ax - 5, ay - 17, 10, 21)
    + `<path d="M${ax} ${ay - 7}L${ax + 2.6} ${ay + 1}L${ax} ${ay - 1}L${ax - 2.6} ${ay + 1}Z" `
    + `fill="${palette.ink}"/>`;
  return svg(w, h, out + `<rect x="0.15" y="0.15" width="${w - 0.3}" height="${h - 0.3}" `
    + `fill="none" stroke="${palette.ink}" stroke-width="0.3"/>`); // the neat line
}
function locatorMap([w, h], art) { // Varenia among its neighbours, its borders and its capital
  const s = frame(WIN.locator, w);
  let out = picture(art, w, h);
  for (const run of BORDERS.locator) out += cased(mapPath(s, run), 'border', 0.5, '1.6 0.8');
  const [, x, y] = TOWNS[0];
  out += `<rect x="${s.X(x) - 1.2}" y="${s.Y(y) - 1.2}" width="2.4" height="2.4" `
    + `fill="${palette.ink}" stroke="${palette.paper}" stroke-width="0.4"/>`;
  return svg(w, h, out + `<rect x="0.15" y="0.15" width="${w - 0.3}" height="${h - 0.3}" `
    + `fill="none" stroke="${palette.ink}" stroke-width="0.3"/>`);
}
// The section A–B: the painted ground cut along the line, a rule each 500 m, the two axes.
// The painting fills the plot (14 mm in, 93 mm down); its heights are read off the rules.
function profile([w, h], art) {
  const [x0, y0, y1] = [14, 3, h - 7];
  const Y = (m) => r1(y1 - m * (y1 - y0) / PROFILE_TOP);
  let out = picture(art, w - x0, y1, x0);
  for (let m = 500; m < PROFILE_TOP; m += 500) {
    out += line(`M${x0} ${Y(m)}H${w}`, 'paper', 0.3, ' stroke-opacity="0.7"')
      + line(`M${x0 - 1.4} ${Y(m)}H${x0}`, 'ink', 0.4);
  }
  return svg(w, h, out + line(`M${x0} ${y1}H${w}`, 'ink', 0.5) + line(`M${x0} ${y0 - 3}V${y1}`,
    'ink', 0.4));
}
// #endregion

// #region anchors: the points of each map where a name stands, the same in every edition
const above = { verticalAlign: 'bottom' }, below = { verticalAlign: 'top' };
const r = km(WIN.relief), l = km(WIN.locator);
const ANCHORS = {
  relief: [
    r('ocean', 172, 157, 'ocean'), r('lira', 20, 52, 'sea', { rotate: -84 }),
    r('gulf', 318, 154, 'sea', { width: 0.07 }), r('nema', 22, 100, 'island', above),
    r('albar-range', 98, 108, 'range', { rotate: -33 }),
    r('gris-range', 308, 96, 'range', { rotate: -86 }),
    r('plateau', 236, 78, 'region'), r('plain', 70, 98, 'region', { width: 0.08 }),
    r('sela', 108, 62, 'river', { rotate: -4 }), r('duna', 121, 136, 'river', { rotate: -62 }),
    r('merel', 281, 92, 'river', { rotate: -47 }), r('ormo', 254, 104, 'river', above),
    // Calvera's name goes below its dot: the River Sela runs in just above it.
    ...TOWNS.map(([id, x, y]) => (id === 'calvera' ? r(id, x, y + 2.6, 'town', below)
      : r(id, x, y - 2.6, id === 'almaren' ? 'capital' : 'town', above))),
    ...PEAKS.map(([id, x, y]) => r(`${id}-peak`, x, y + 2.4, 'peak', below)),
    r('ostelia', 300, 9, 'country'), r('brunavia', 390, 112, 'country', { rotate: -90 }),
    r('varenia', 250, 46, 'nation'),
    r('a', PROFILE[0][0], PROFILE[0][1] - 2, 'point', above),
    r('b', PROFILE[1][0], PROFILE[1][1] + 2, 'point', below),
    r('scale-0', SCALE.x, SCALE.y + 3, 'tick', below),
    r('scale-25', SCALE.x + 25, SCALE.y + 3, 'tick', below),
    r('scale-50', SCALE.x + 50, SCALE.y + 3, 'tick', below),
    r('north', NORTH.x, NORTH.y - 8, 'point', above),
    r('a-end', ...PROFILE[0]), r('b-end', ...PROFILE[1]),
  ],
  locator: [
    l('varenia', 205, 80, 'nation'), l('ostelia', 150, -100, 'country'),
    l('brunavia', 560, -120, 'country'), l('lira', 210, -250, 'sea', { rotate: 20 }),
    l('ocean', -180, -40, 'ocean', { width: 0.2 }), l('almaren', 259, 127 + 22, 'capital', below),
    { id: 'key', x: 0.115, y: 0.965, style: 'legend', verticalAlign: 'bottom' },
  ],
  // The section: fractions of the drawing, whose plot starts 14 mm in and runs 3 to 51 mm down.
  section: (() => {
    const [w, h] = MAP.section, x = (u) => (14 + u * (w - 14)) / w;
    const y = (m) => (h - 7 - m * (h - 10) / PROFILE_TOP) / h;
    return [
      { id: 'a', x: x(0), y: (h - 5.5) / h, style: 'point', ...below },
      { id: 'b', x: x(0.98), y: (h - 5.5) / h, style: 'point', ...below },
      ...[500, 1000, 1500, 2000].map((m) => ({ id: `m${m}`, x: 7 / w, y: y(m), style: 'tick' })),
      { id: 'sela', x: x(0.3), y: y(40), style: 'region', labelAt: { x: x(0.3), y: y(850) } },
      { id: 'crest', x: x(0.47), y: y(2260), style: 'range', ...above },
      { id: 'plain', x: x(0.82), y: y(160), style: 'region', labelAt: { x: x(0.82), y: y(850) } },
    ];
  })(),
};
// #endregion

// #region resources: three paintings under vector furniture and their anchors; no words
// A resource has no alt text, caption or note here: each edition's `:::figure` says its own.
const PAINTINGS = { // each plate's painting, a file in assets/, named by its width in pixels
  locator: asset('locator-1776.jpg'), relief: asset('relief-1984.jpg'),
  section: asset('section-1760.jpg') };
const drawings = { locator: locatorMap, relief: reliefMap, section: profile };
const resources = Object.entries(MAP).map(([id, [w, h]]) => ({ id, typeId: 'map', kind: 'svg',
  createdAt: 0, updatedAt: 0, svg: { fileId: `${id}.svg`, width: w * 10, height: h * 10 },
  anchors: ANCHORS[id] }));
for (const [id, draw] of Object.entries(drawings)) {
  await loadSvg(`${id}.svg`, draw(MAP[id], await dataUrl(PAINTINGS[id])));
}
// #endregion

// #region art-key: the key's colour sample, a square each row of the legend tints (:icon{color})
resources.push({ id: 'key-mark', typeId: 'map', kind: 'svg', createdAt: 0, updatedAt: 0,
  svg: { fileId: 'key-mark.svg', width: 40, height: 40 } });
await loadSvg('key-mark.svg', svg(4, 4, `<rect width="4" height="4" fill="${palette.ink}"/>`));
// #endregion

// ─── 3 · Fonts ──────────────────────────────────────────────────────────────
const FONTS = { // every face the pages use, loaded before the build
  'Source Sans 3': ['400', '400i', '600', '700'], // text, boxes and map labels
  'Source Serif 4': ['700'], // the sheets' titles
  'Noto Naskh Arabic': ['400', '700'], // the Arabic text and boxes
  'Noto Kufi Arabic': ['500', '700'], // the Arabic titles and map labels
};

// ─── 4 · Build & show ───────────────────────────────────────────────────────
await loadFonts(FONTS, markdown);
await loadArabicFonts(FONTS, markdown + JSON.stringify(resources));
const doc = await withLoadedFonts(() => buildDocument({ markdown, resources }, config),
  { ...kitFonts(FONTS), text: markdown });
showBook(doc, { title: t({ es: 'Atlas escolar de Varenia', en: 'A school atlas of Varenia',
  ar: 'أطلس فارينيا المدرسي' }) });

// @kit core fonts viewer images arabic book · the Cookbook inlines cookbook/_kit/*.js here
