/**
 * Writes public/docs-examples/our-world-before.postext, the book the guide
 * "Moving a book to composed pages" follows: a small invented textbook made
 * the way books were before composed pages, each page a hidden heading style
 * whose running head places the page's picture, boxes and text.
 *
 *   pnpm dlx --allow-build=esbuild tsx scripts/docs/migration-sample.mjs
 *
 * The words, the colours and the pictures (soft gradients written here) are
 * invented for the guide; nothing in the file comes from a real book.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBundle } from 'postext';

const mm = (value) => ({ value, unit: 'mm' });
const pt = (value) => ({ value, unit: 'pt' });
const hex = (h) => ({ hex: h, model: 'hex' });
const at = (x, y, width, height) => ({
  anchor: { to: 'page', edge: 'top-left' },
  offset: { x: mm(x), y: mm(y) },
  ...(width !== undefined || height !== undefined ? { size: { ...(width !== undefined ? { width: mm(width) } : {}), ...(height !== undefined ? { height: mm(height) } : {}) } } : {}),
});

const BODY = 'Nunito';
const STAMP = 'Fredoka';

const text = (id, content, x, y, width, look = {}) => ({
  kind: 'text', id, content, inlineMarks: true,
  fontFamily: BODY, fontSize: pt(11), fontWeight: 400, italic: false, color: hex('#1d2f3f'),
  align: 'left', verticalAlign: 'top', lineHeight: 1.5, overflow: 'wrap',
  placement: at(x, y, width), ...look,
});
const picture = (id, resourceId) => ({ kind: 'image', id, resourceId, decorative: true, placement: at(0, 0, 230, 288) });
const box = (id, colour, x, y, w, h) => ({ kind: 'box', id, placement: at(x, y, w, h), style: { backgroundColor: hex(colour), borderRadius: mm(3) } });

const LINE = (11 * 1.5 * 25.4) / 72;

/** One topic page: kicker and title in the same places on every page, three
 *  blocks of text one under another, a coloured band behind the first words. */
function topicPage(n, title, kicker, body, mark, extra = []) {
  // The yellow band stands under the first bold word: `mark` is [characters before it, characters in it].
  const CHAR = 1.75;
  return [
    picture('page', `art-${n}`),
    box(`card-${n}`, '#ffffff', 15, 25, 200, 240),
    text(`kicker-${n}`, kicker, 160, 6, 55, { fontFamily: STAMP, fontSize: pt(16), color: hex('#ffffff'), align: 'right' }),
    text(`title-${n}`, title, 14, 12, 146, { fontFamily: STAMP, fontSize: pt(30), align: 'center', lineHeight: 1.2, textTransform: 'uppercase', color: hex('#ffffff') }),
    box(`hl-${n}`, '#fee702', 20 + mark[0] * CHAR, 30.4, (mark[1] + 0.6) * CHAR, 4.8),
    ...body.map((t, i) => text(`body-${n}-${i}`, t, 20, 30 + i * (LINE * 2), 180)),
    ...extra,
  ];
}

const pageStyle = (id, elements, extra = {}) => ({ id, name: id.replace('--', ' '), numbered: false, hidden: true, header: { elements }, footer: { elements: [] }, ...extra });

const P1 = topicPage('p1', 'Rivers and seas', 'THE WATER ON EARTH', [
  'Water covers most of the planet. **Rivers** carry it from the hills\ndown to the sea, where it joins the oceans.',
  'Along the way it shapes valleys, feeds fields\nand gives towns the water they drink.',
  'Some rivers dry up in summer; others never stop.',
], [33, 6]);
const P2 = topicPage('p2', 'The weather', 'THE WATER ON EARTH', [
  'The **weather** is what the air is like today:\nwarm or cold, wet or dry, still or windy.',
  'We measure it with a thermometer, a rain gauge\nand a weather vane on the school roof.',
  'Over many years the weather of a place makes its climate.',
], [4, 7], [text('label-p2', 'Rain gauge', 150, 150, 30, { fontSize: pt(9) })]);
const P3 = topicPage('p3', 'Maps and plans', 'FINDING OUR WAY', [
  'A **map** shows a large place from above,\nsmaller than it is.',
  'A plan shows a small place, such as a classroom.',
  'Both have a key that explains their signs.',
], [2, 3]);

const config = {
  page: { sizePreset: 'custom', width: mm(230), height: mm(288), margins: { top: mm(28), bottom: mm(22), left: mm(25), right: mm(20), mirror: true } },
  bodyText: { fontFamily: BODY, fontSize: pt(12), lineHeight: pt(18), color: hex('#1d2f3f') },
  headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: true, parity: 'any' } }] },
  resourceTypes: [{ id: 'picture', name: 'Picture', shortLabel: '', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } }],
  chipStyles: [{ id: 'key', backgroundEnabled: true, background: hex('#fee702'), bold: true }],
  headingStyles: [
    pageStyle('topic--p1', P1),
    pageStyle('topic--p2', P2),
    pageStyle('topic--p3', P3),
  ],
};

const markdown = `---
title: "Our World"
---

# Rivers and seas {style="topic--p1" id="t-rivers"}

# The weather {style="topic--p2" id="t-weather"}

# Maps and plans {style="topic--p3" id="t-maps"}
`;

// A soft vertical gradient, as a PNG, for each page's picture.
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function gradientPng(width, height, top, bottom) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) for (let k = 0; k < 3; k++) row[1 + x * 3 + k] = Math.round(top[k] + (bottom[k] - top[k]) * t);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const art = { p1: [[27, 106, 160], [118, 176, 214]], p2: [[51, 111, 39], [150, 196, 120]], p3: [[154, 82, 9], [232, 178, 96]] };
const files = {};
const resources = Object.entries(art).map(([n, [top, bottom]]) => {
  files[`art-${n}.png`] = gradientPng(230, 288, top, bottom);
  return { id: `art-${n}`, typeId: 'picture', kind: 'bitmap', caption: '', altText: '', createdAt: 0, updatedAt: 0, bitmap: { fileId: `art-${n}.png`, format: 'png', width: 230, height: 288, resolution: 25.4 } };
});

const { bytes, warnings } = await createBundle({
  id: 'our-world-before',
  name: 'Our World, before composed pages',
  description: 'A three-page textbook made the old way: every page is a hidden heading style whose running head places its text, boxes and picture.',
  locale: 'en',
  chapters: [{ title: 'Our World', markdown }],
  config,
  resources,
  files,
  mtime: Date.UTC(2026, 9, 17),
});
for (const w of warnings) console.warn(w);
const out = fileURLToPath(new URL('../../public/docs-examples/our-world-before.postext', import.meta.url));
writeFileSync(out, bytes);
console.log(out, bytes.length, 'bytes');
