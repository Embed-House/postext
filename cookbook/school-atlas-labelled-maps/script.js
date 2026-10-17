// ═══ Postext Cookbook · Nº 157 · A school atlas labelled from the Markdown ═══════
// https://postext.dev/en/cookbook/school-atlas-labelled-maps
// Code: MIT · Text: original (CC BY 4.0) · Maps: drawn in code from seed 2026 (CC BY 4.0)
// Fonts: Source Sans 3, Source Serif 4, Noto Naskh and Kufi Arabic (OFL) · Needs postext ≥ 1.38.0
//
// Three pages of a school atlas of Varenia, an invented country: a locator map, the relief map
// across a double page and a section through the mountains. The maps are drawn without a letter.
// Every name on them is a ::label in content.<lang>.md, standing at an anchor of the resource,
// so the Spanish, English and Arabic editions share the same drawings and the same anchors.
import {
  buildDocument, withLoadedFonts, renderPageToCanvas, registerResourceImage,
} from 'https://esm.sh/postext';

const LANG = 'es'; // @lang: the language of the sample document ('es' | 'en' | 'ar')
const RECIPE = 'school-atlas-labelled-maps';

// ─── 1 · Design ─────────────────────────────────────────────────────────────
// #region palette: the page's colours and the maps' tints, one object for both
const palette = {
  ink: '#1f2a2e', paper: '#ffffff', muted: '#55646a', rule: '#c9d2d6',
  band: '#1d5f73', // the accent: the head of each sheet, box stripes, list numbers
  sky: '#d4e9f2', // the kicker on the band
  tint: '#eef2ef', // the key's box
  water: '#22597f', river: '#2c6e9b', sea: '#d4e9f2', deep: '#a9cfe0', // names and lines of water
  low: '#b5d39b', hill: '#dfe3a2', upland: '#ecd08f', mount: '#d4a46c', peak: '#a8754d',
  relief: '#6e4527', // the names of ranges and the line of the section
  land: '#ebe6da', country: '#f2c46b', border: '#8a3b52', // the locator map
};
// col(id) links a colour to its palette entry; the drawings read the same hex from `palette`.
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
  caps('range', 7, 'relief', 0.32, { halo }), caps('region', 6.5, 'muted', 0.24),
  caps('country', 8.5, 'muted', 0.36), caps('nation', 12, 'ink', 0.42),
  style('capital', 7.6, 'ink', { fontWeight: 700, halo }), style('town', 7, 'ink', { halo }),
  style('peak', 6.5, 'ink', { fontWeight: AR ? 700 : 600, halo }), style('island', 6.5, 'ink'),
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
// The double sheet: one band and one map across both pages, the boxes under the map.
const spread = {
  id: 'spread', spread: true, header: false, decoration: { elements: [band, kicker] },
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
  locale: t({ es: 'es', en: 'en-gb', ar: 'ar' }), // written out: Arabic sets the page right to left
  colorPalette, labelStyles, calloutStyles, footer,
  header: { elements: [] },
  pageTemplates: [sheet, spread],
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


// #region art: one seeded height field, drawn as the locator map, the relief map and a profile
// Varenia is invented: a coast, two ranges and three rivers laid out in km (x east, y south),
// warped by value noise, cut into height bands by marching squares. The drawings carry no
// letters: every name, number and the N of the arrow is a ::label of the Markdown, standing at
// an anchor of ANCHORS. No markers, filters or masks.
const SEED = 2026; // the seed every coast and height is drawn from
const MAP = { locator: [177, 118], relief: [390, 160], section: [177, 100] }; // drawings, in mm
const WIN = { // the km each map shows: x east, y south
  relief: { x0: 0, x1: 400, y0: 0, y1: 400 * MAP.relief[1] / MAP.relief[0] },
  locator: { x0: -330, x1: 770, y0: -520, y1: -520 + 1100 * MAP.locator[1] / MAP.locator[0] },
};
const TOWNS = [['almaren', 259, 127, 'capital'], ['calvera', 53, 66], ['tessa', 108, 142],
  ['sora', 296, 132], ['brena', 346, 92]];
const PEAKS = [['albar', 170, 63], ['gris', 325, 55]];
const PROFILE = [[92, 32], [166, 134]]; // A and B, the ends of the section
const PROFILE_TOP = 2600; // m at the head of the section
const SCALE = { x: 8, y: 157 }, NORTH = { x: 22, y: 140 }; // the scale bar and the arrow
function mulberry32(seed) { // a seeded PRNG: never Math.random() in a recipe
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const LATTICE = Array.from({ length: 64 * 64 }, () => rand() * 2 - 1);
const ease = (u) => u * u * (3 - 2 * u);
function noise(x, y) { // value noise in −1…1 on a 64 × 64 lattice that wraps
  const [i, j] = [Math.floor(x), Math.floor(y)], [u, v] = [ease(x - i), ease(y - j)];
  const at = (a, b) => LATTICE[((b & 63) << 6) | (a & 63)];
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
  const foot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
  return top + (foot - top) * v;
}
const fbm = (x, y) => [1, 2, 4, 8].reduce((s, f) => s + noise(f * x, f * y) / (2 * f), 0);
// Polylines in km. A range is a crest line and its height; a river runs from source to mouth.
const RANGES = [
  { crest: [[62, 132], [96, 108], [128, 88], [158, 70], [184, 56]], height: 2150, width: 15 },
  { crest: [[318, 30], [326, 62], [322, 96], [312, 124]], height: 1050, width: 13 },
];
const RIVERS = {
  sela: [[156, 78], [138, 70], [118, 66], [97, 68], [78, 62], [60, 64], [40, 62]],
  duna: [[126, 112], [120, 126], [112, 138], [106, 150], [101, 168]],
  merel: [[306, 44], [296, 62], [281, 80], [266, 96], [256, 110], [258, 124], [268, 138],
    [282, 150], [292, 168]],
};
const LAKE = { x: 254, y: 111, rx: 7.5, ry: 4.8 };
const BORDERS = [ // Varenia and Ostelia; Varenia and Brunavia; Ostelia and Brunavia
  [[30, 12], [80, 6], [128, 10], [172, 18], [214, 12], [256, 24], [298, 22], [338, 34],
    [376, 44]],
  [[376, 44], [372, 76], [380, 104], [368, 132], [374, 156], [370, 190]],
  [[376, 44], [392, -40], [384, -170], [420, -330], [404, -520]],
];
function segDist(x, y, pts) { // the distance from (x, y) to a polyline, km
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [[ax, ay], [bx, by]] = [pts[i - 1], pts[i]], [dx, dy] = [bx - ax, by - ay];
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(ax + u * dx - x, ay + u * dy - y));
  }
  return best;
}
function landness(x, y) { // km inland from the coast; negative out at sea
  // Far from Varenia (the window of the relief map) the coast takes larger turns.
  const far = Math.min(1, Math.hypot(Math.max(0, -x, x - 400), Math.max(0, -y, y - 175)) / 160);
  const west = x - (50 + 26 * fbm(y / 46, 3.1) + 9 * fbm(y / 11, 8.2)
    + far * (240 * fbm(y / 520, 7.7) - 0.45 * Math.max(0, -y - 80)));
  const south = 146 + 16 * fbm(x / 52, 1.3) + 6 * fbm(x / 13, 2.6)
    + far * (200 * fbm(x / 480, 4.4) + 0.8 * Math.max(0, x - 430)) - y;
  const gulf = Math.hypot((x - 312) / 1.3, y - 166) - 38 - 6 * fbm(x / 12, y / 12);
  const [lu, lv] = [(x - 200) * 0.94 + (y + 240) * 0.34, (y + 240) * 0.94 - (x - 200) * 0.34];
  const lira = Math.hypot(lu / 2.6, lv) - 92 - 30 * fbm(x / 70, y / 70); // an inland sea, north
  const cape = 1 - Math.hypot((x - 90) / 22, (y - 148) / 17) + 0.3 * fbm(x / 8, y / 8);
  const nema = 8 - Math.hypot(x - 22, (y - 110) * 1.4) + 3 * fbm(x / 6, y / 6);
  return Math.max(Math.min(west, Math.max(south, cape * 12), gulf, lira), nema);
}
function elevation(x, y) { // metres; below 0 is sea, NaN is the lake
  const wx = x + 6 * fbm(x / 24, y / 24 + 5), wy = y + 6 * fbm(x / 24 + 9, y / 24);
  const coast = landness(wx, wy);
  if (coast < 0) return Math.max(-900, coast * 28);
  if (((x - LAKE.x) / LAKE.rx) ** 2 + ((y - LAKE.y) / LAKE.ry) ** 2 < 1) return NaN;
  let e = 20 + Math.min(coast, 45) * 4 + 430 * Math.exp(-(((x - 236) / 58) ** 2
    + ((y - 88) / 34) ** 2));
  for (const { crest, height, width } of RANGES) {
    const ridge = Math.exp(-((segDist(wx, wy, crest) / width) ** 2));
    e += height * ridge * (0.75 + 0.5 * fbm(x / 9, y / 9));
  }
  for (const river of Object.values(RIVERS)) {
    e -= 420 * Math.exp(-((segDist(x, y, river) / 6) ** 2));
  }
  e += 170 * fbm(x / 7, y / 7);
  return Math.max(e, 2 + coast * 0.6);
}
const EDGES = { 1: ['B', 'L'], 2: ['R', 'B'], 3: ['R', 'L'], 4: ['T', 'R'], 6: ['T', 'B'],
  7: ['T', 'L'], 8: ['L', 'T'], 9: ['B', 'T'], 11: ['R', 'T'], 12: ['L', 'R'], 13: ['B', 'R'],
  14: ['L', 'B'], 5: ['T', 'L', 'B', 'R', 'T', 'R', 'B', 'L'], // saddles: joined, then apart
  10: ['R', 'T', 'L', 'B', 'L', 'T', 'R', 'B'] };
function contours(grid, nx, ny, level) { // marching squares: closed loops above `level`
  const v = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? grid[j * nx + i] : -1e9);
  const at = new Map(), next = new Map();
  const edge = (i, j, side) => { // T, B, L or R of cell (i, j), as a key shared by neighbours
    const [a, b, horizontal] = { T: [i, j, 1], B: [i, j + 1, 1], L: [i, j, 0],
      R: [i + 1, j, 0] }[side];
    const key = `${horizontal ? 'h' : 'v'}${a},${b}`;
    if (!at.has(key)) {
      const [p, q] = horizontal ? [v(a, b), v(a + 1, b)] : [v(a, b), v(a, b + 1)];
      const u = Math.max(0, Math.min(1, (level - p) / (q - p)));
      at.set(key, horizontal ? [a + u, b] : [a, b + u]);
    }
    return key;
  };
  for (let j = -1; j < ny; j++) {
    for (let i = -1; i < nx; i++) {
      const corners = [v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)];
      const index = corners.reduce((n, c) => n * 2 + (c > level), 0);
      let sides = EDGES[index];
      if (!sides) continue;
      const high = corners.reduce((a, b) => a + b) / 4 > level; // a saddle: which way it joins
      if (sides.length > 4) sides = high ? sides.slice(0, 4) : sides.slice(4);
      for (let k = 0; k < sides.length; k += 2) {
        next.set(edge(i, j, sides[k]), edge(i, j, sides[k + 1]));
      }
    }
  }
  const loops = [];
  for (const start of [...next.keys()]) {
    const loop = [];
    for (let k = start; next.has(k);) {
      loop.push(at.get(k));
      const n = next.get(k);
      next.delete(k);
      k = n;
    }
    if (loop.length > 4) loops.push(loop);
  }
  return loops;
}
const chaikin = (loop) => loop.flatMap((p, i) => {
  const q = loop[(i + 1) % loop.length];
  return [[0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]],
    [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]];
});
const r1 = (n) => Math.round(n * 10) / 10;
// The window win = { x0, x1, y0, y1 } in km, drawn w × h units; field(x, y) gives the value.
function raster(win, w, h, field, cell = 1) {
  const [nx, ny] = [Math.ceil(w / cell) + 1, Math.ceil(h / cell) + 1];
  const grid = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      grid[j * nx + i] = field(win.x0 + i * (win.x1 - win.x0) / (nx - 1),
        win.y0 + j * (win.y1 - win.y0) / (ny - 1));
    }
  }
  const k = w / (win.x1 - win.x0); // units per km
  const X = (x) => r1((x - win.x0) * k), Y = (y) => r1((y - win.y0) * k);
  const above = (level, g = grid) => contours(g, nx, ny, level).map((loop) => {
    const p = chaikin(chaikin(loop));
    return `M${p.map(([i, j]) => `${r1(i * w / (nx - 1))} ${r1(j * h / (ny - 1))}`).join('L')}Z`;
  }).join('');
  const masked = (keep) => grid.map((value, n) => (keep(win.x0 + (n % nx) * (win.x1 - win.x0)
    / (nx - 1), win.y0 + Math.floor(n / nx) * (win.y1 - win.y0) / (ny - 1)) ? value : -1e9));
  return { X, Y, k, w, h, above, masked, grid, nx, ny };
}
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" `
  + `width="${w * 10}" height="${h * 10}">${body}</svg>`;
const fill = (d, id, more = '') => (d ? `<path d="${d}" fill="${palette[id]}" `
  + `fill-rule="evenodd"${more}/>` : '');
const line = (d, id, width, more = '') => `<path d="${d}" fill="none" stroke="${palette[id]}" `
  + `stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${more}/>`;
const open = (pts) => [pts[0], ...pts.slice(1).flatMap((q, i) => { // Chaikin on an open line
  const p = pts[i];
  return [[0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]],
    [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]];
}).slice(1, -1), pts[pts.length - 1]];
const smooth = (pts) => open(open(pts)); // an open line, rounded
const path = (s, pts) => `M${pts.map(([x, y]) => `${s.X(x)} ${s.Y(y)}`).join('L')}`;
const landRuns = (pts) => { // the stretches of a line that run over land
  const runs = [[]];
  for (const p of dense(pts, 3)) {
    if (landness(...p) > 0) runs[runs.length - 1].push(p);
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  return runs.filter((run) => run.length > 1);
};
const onLand = (pts) => { // a river line cut where it reaches the sea
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    if (i && landness(...pts[i]) < 0.6) break;
  }
  return out;
};
const dense = (pts, step = 1.5) => pts.slice(1).flatMap(([bx, by], i) => {
  const [ax, ay] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
  return Array.from({ length: n }, (_, k) => [ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
}).concat([pts[pts.length - 1]]);
const lakePath = (s) => { const [cx, cy, rx, ry] = [s.X(LAKE.x), s.Y(LAKE.y), LAKE.rx * s.k,
  LAKE.ry * s.k]; return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 `
  + `${-2 * rx} 0Z`; };
const BANDS = [[0, 'low'], [200, 'hill'], [500, 'upland'], [1000, 'mount'], [1800, 'peak']];
function reliefMap([w, h]) { // the spread: hypsometric tints, rivers, borders, towns, a scale
  const height = (x, y) => { const e = elevation(x, y); return Number.isNaN(e) ? 30 : e; };
  const s = raster(WIN.relief, w, h, height, 0.9);
  let out = `<rect width="${w}" height="${h}" fill="${palette.deep}"/>`
    + fill(s.above(-160), 'sea');
  for (const [level, id] of BANDS) out += fill(s.above(level), id);
  // Hill shading lit from the north-west: the slopes that face away darken, the others lighten.
  const { nx, ny } = s;
  const shade = s.grid.map((e, n) => {
    const [i, j] = [n % nx, Math.floor(n / nx)];
    if (e <= 0 || i === 0 || j === 0 || i === nx - 1 || j === ny - 1) return 0;
    const dx = s.grid[n + 1] - s.grid[n - 1], dy = s.grid[n + nx] - s.grid[n - nx];
    return (dx + dy) / 900; // grows with the slope down to the south-east
  });
  out += fill(s.above(0.35, shade), 'ink', ' fill-opacity="0.13"')
    + fill(s.above(0.9, shade), 'ink', ' fill-opacity="0.1"')
    + fill(s.above(0.35, shade.map((v) => -v)), 'paper', ' fill-opacity="0.22"');
  out += fill(lakePath(s), 'sea') + line(lakePath(s), 'river', 0.5);
  for (const river of Object.values(RIVERS)) {
    out += line(path(s, smooth(onLand(dense(river)))), 'river', 0.9);
  }
  for (const run of BORDERS.slice(0, 2).flatMap(landRuns)) {
    out += line(path(s, run), 'border', 0.7, ' stroke-dasharray="2.4 1.2"');
  }
  out += line(path(s, PROFILE), 'ink', 0.5, ' stroke-dasharray="1 1"');
  const dot = (x, y, r, more = '') => `<circle cx="${s.X(x)}" cy="${s.Y(y)}" r="${r}" `
    + `fill="${palette.ink}"${more}/>`;
  const ring = ` stroke="${palette.paper}" stroke-width="0.5"`;
  for (const [x, y] of PROFILE) out += dot(x, y, 1);
  for (const [, x, y, kind] of TOWNS) {
    out += kind === 'capital'
      ? `<rect x="${s.X(x) - 1.4}" y="${s.Y(y) - 1.4}" width="2.8" height="2.8" `
        + `fill="${palette.ink}"${ring}/>`
      : dot(x, y, 1.2, ring);
  }
  for (const [, x, y] of PEAKS) {
    const [px, py] = [s.X(x), s.Y(y)];
    out += `<path d="M${px - 1.5} ${py + 1.1}L${px} ${py - 1.5}L${px + 1.5} ${py + 1.1}Z" `
      + `fill="${palette.ink}"/>`;
  }
  // A scale of 50 km in the south-west sea, and the north arrow above it.
  const [sx, sy] = [s.X(SCALE.x), s.Y(SCALE.y)], step = 25 * s.k;
  out += `<rect x="${sx}" y="${sy}" width="${step}" height="1.4" fill="${palette.ink}"/>`
    + `<rect x="${sx + step}" y="${sy}" width="${step}" height="1.4" fill="${palette.paper}" `
    + `stroke="${palette.ink}" stroke-width="0.3"/>`;
  const [ax, ay] = [s.X(NORTH.x), s.Y(NORTH.y)];
  out += `<path d="M${ax} ${ay - 7}L${ax + 2.6} ${ay + 1}L${ax} ${ay - 1}L${ax - 2.6} ${ay + 1}Z" `
    + `fill="${palette.ink}"/>`;
  return svg(w, h, out + `<rect x="0.15" y="0.15" width="${w - 0.3}" height="${h - 0.3}" `
    + `fill="none" stroke="${palette.ink}" stroke-width="0.3"/>`); // the neat line
}
function locatorMap([w, h]) { // Varenia among its neighbours, flat tints
  const s = raster(WIN.locator, w, h, landness, 1);
  const north = (x) => interp(BORDERS[0], x);
  const east = (y) => interp(BORDERS[1].map(([a, b]) => [b, a]), y);
  const inVarenia = (x, y) => y > north(x) && x < east(y) && x > -200;
  let out = `<rect width="${w}" height="${h}" fill="${palette.sea}"/>`
    + fill(s.above(0), 'land') + fill(s.above(0, s.masked(inVarenia)), 'country');
  for (const run of BORDERS.flatMap(landRuns)) {
    out += line(path(s, run), 'border', 0.5, ' stroke-dasharray="1.6 0.8"');
  }
  out += line(s.above(0), 'river', 0.3);
  const [, x, y] = TOWNS[0];
  out += `<rect x="${s.X(x) - 1.2}" y="${s.Y(y) - 1.2}" width="2.4" height="2.4" `
    + `fill="${palette.ink}"/>`;
  return svg(w, h, out);
}
function interp(pts, x) { // a polyline read as y(x); outside it, its end values
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [[ax, ay], [bx, by]] = [pts[i - 1], pts[i]];
    if (x <= bx) return ay + (by - ay) * (x - ax) / (bx - ax);
  }
  return pts[pts.length - 1][1];
}
function profile([w, h]) { // the section A–B: heights ×16, tinted by band, a rule each 500 m
  const n = 300, [[ax, ay], [bx, by]] = PROFILE, top = PROFILE_TOP, [x0, y0, y1] = [14, 3, h - 7];
  const Y = (m) => r1(y1 - m * (y1 - y0) / top);
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const e = elevation(ax + (bx - ax) * i / n, ay + (by - ay) * i / n);
    return [r1(x0 + i * (w - x0) / n), Y(Math.max(0, Number.isNaN(e) ? 0 : e))];
  });
  const ground = `M${x0} ${y1}L${pts.map(([x, y]) => `${x} ${y}`).join('L')}L${w} ${y1}Z`;
  let out = `<defs><clipPath id="ground"><path d="${ground}"/></clipPath></defs>`;
  for (let m = 500; m < top; m += 500) out += line(`M${x0} ${Y(m)}H${w}`, 'rule', 0.3);
  out += '<g clip-path="url(#ground)">';
  BANDS.forEach(([level, id], i) => {
    const next = BANDS[i + 1]?.[0] ?? top;
    out += `<rect x="${x0}" y="${Y(next)}" width="${w - x0}" height="${r1(Y(level) - Y(next))}" `
      + `fill="${palette[id]}"/>`;
  });
  const crest = line(`M${pts.map(([x, y]) => `${x} ${y}`).join('L')}`, 'relief', 0.6);
  return svg(w, h, `${out}</g>${crest}${line(`M${x0} ${y1}H${w}`, 'ink', 0.5)}`
    + line(`M${x0} ${y0}V${y1}`, 'ink', 0.4));
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
    ...TOWNS.map(([id, x, y]) => r(id, x, y - 2.6, id === 'almaren' ? 'capital' : 'town', above)),
    ...PEAKS.map(([id, x, y]) => r(`${id}-peak`, x, y + 2.4, 'peak', below)),
    r('ostelia', 300, 9, 'country'), r('brunavia', 390, 112, 'country', { rotate: -90 }),
    r('varenia', 250, 46, 'nation'),
    r('a', PROFILE[0][0], PROFILE[0][1] - 2, 'point', above),
    r('b', PROFILE[1][0], PROFILE[1][1] + 2, 'point', below),
    r('scale-0', SCALE.x, SCALE.y + 3, 'tick', below),
    r('scale-25', SCALE.x + 25, SCALE.y + 3, 'tick', below),
    r('scale-50', SCALE.x + 50, SCALE.y + 3, 'tick', below),
    r('north', NORTH.x, NORTH.y - 8, 'point', above),
  ],
  locator: [
    l('varenia', 205, 80, 'nation'), l('ostelia', 150, -100, 'country'),
    l('brunavia', 560, -120, 'country'), l('lira', 210, -250, 'sea', { rotate: 20 }),
    l('ocean', -180, -40, 'ocean', { width: 0.2 }), l('almaren', 259, 127 + 22, 'capital', below),
  ],
  // The section: fractions of the drawing, whose plot starts 14 mm in and runs 3 to 51 mm down.
  section: (() => {
    const [w, h] = MAP.section, x = (u) => (14 + u * (w - 14)) / w;
    const y = (m) => (h - 7 - m * (h - 10) / PROFILE_TOP) / h;
    return [
      { id: 'a', x: x(0), y: (h - 5.5) / h, style: 'point', ...below },
      { id: 'b', x: x(0.98), y: (h - 5.5) / h, style: 'point', ...below },
      ...[500, 1000, 1500, 2000].map((m) => ({ id: `m${m}`, x: 7 / w, y: y(m), style: 'tick' })),
      { id: 'sela', x: x(0.3), y: y(700), style: 'region' },
      { id: 'crest', x: x(0.47), y: y(2260), style: 'range', ...above },
      { id: 'plain', x: x(0.82), y: y(650), style: 'region' },
    ];
  })(),
};
// #endregion

// #region resources: three drawings, their anchors and their alternative text
const ALT = t({
  es: {
    locator: 'Mapa de situación: Varenia, en amarillo, entre Ostelia, Brunavia, el mar de Lira '
      + 'y el océano Brumoso.',
    relief: 'Mapa físico de Varenia en tintas de altitud, con la sierra Albar, los montes '
      + 'Grises, los ríos Sela, Duna y Merel y el corte A–B.',
    section: 'Perfil topográfico de A a B: el valle del Sela, la sierra Albar y la llanura '
      + 'costera.',
  },
  en: {
    locator: 'Locator map: Varenia, in yellow, between Ostelia, Brunavia, the Lira Sea and the '
      + 'Misty Ocean.',
    relief: 'Relief map of Varenia in height tints, with the Albar Range, the Grey Hills, the '
      + 'rivers Sela, Duna and Merel and the line of section A–B.',
    section: 'Section from A to B: the Sela valley, the Albar Range and the coastal plain.',
  },
  ar: {
    locator: 'خريطة الموقع: فارينيا باللون الأصفر بين أوستيليا وبرونافيا '
      + 'وبحر ليرا والمحيط الضبابي.',
    relief: 'خريطة طبيعية لفارينيا بألوان الارتفاع، فيها سلسلة ألبار '
      + 'والتلال الرمادية وأنهار سيلا ودونا وميريل وخط المقطع أ–ب.',
    section: 'مقطع تضاريسي من أ إلى ب: وادي سيلا وسلسلة ألبار '
      + 'والسهل الساحلي.',
  },
});
const resources = Object.entries(MAP).map(([id, [w, h]]) => ({ id, typeId: 'map', kind: 'svg',
  createdAt: 0, updatedAt: 0, svg: { fileId: `${id}.svg`, width: w * 10, height: h * 10 },
  altText: ALT[id], anchors: ANCHORS[id] }));
const drawings = { locator: locatorMap, relief: reliefMap, section: profile };
for (const [id, draw] of Object.entries(drawings)) await loadSvg(`${id}.svg`, draw(MAP[id]));
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
