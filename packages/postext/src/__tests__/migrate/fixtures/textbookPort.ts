/**
 * A synthetic book shaped like the 1.33 textbook ports (#874): every page a
 * hidden heading style whose running head draws the page — the page's
 * picture, coloured boxes, highlight boxes under key words — and holds its
 * text as absolutely placed text elements, one per line block, in the same
 * places from page to page. The words are written for this fixture.
 */
import type { DesignElement, HeadingStyleConfig, PostextConfig } from '../../../types.js';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const at = (x: number, y: number, width?: number, height?: number) => ({
  anchor: { to: 'page' as const, edge: 'top-left' as const },
  offset: { x: mm(x), y: mm(y) },
  ...(width !== undefined || height !== undefined ? { size: { ...(width !== undefined ? { width: mm(width) } : {}), ...(height !== undefined ? { height: mm(height) } : {}) } } : {}),
});

const text = (id: string, content: string, x: number, y: number, width: number, look: Partial<Record<string, unknown>> = {}): DesignElement => ({
  kind: 'text',
  id,
  content,
  inlineMarks: true,
  fontFamily: 'Fixture Sans',
  fontSize: pt(11),
  fontWeight: 400,
  italic: false,
  color: hex('#231f20'),
  align: 'left',
  verticalAlign: 'top',
  lineHeight: 1.5,
  overflow: 'wrap',
  placement: at(x, y, width),
  ...look,
} as DesignElement);

const picture = (id: string, resourceId: string): DesignElement => ({ kind: 'image', id, resourceId, decorative: true, placement: at(0, 0, 230, 288) } as DesignElement);
const box = (id: string, colour: string, x: number, y: number, w: number, h: number): DesignElement => ({ kind: 'box', id, placement: at(x, y, w, h), style: { backgroundColor: hex(colour) } } as DesignElement);

/** One topic page: the shared title and kicker in the same places, a body
 *  of three line blocks under one another, a highlighted key word. */
function topicPage(n: string, title: string, kicker: string, body: string[], extra: DesignElement[] = []): DesignElement[] {
  const lh = (11 * 1.5 * 25.4) / 72; // 5.82 mm
  return [
    picture('page', `art-${n}`),
    box(`card-${n}`, '#ffffff', 15, 25, 200, 240),
    text(`kicker-${n}`, kicker, 160, 6, 55, { fontFamily: 'Fixture Stamp', fontSize: pt(18) }),
    text(`title-${n}`, title, 14, 12, 146, { fontFamily: 'Fixture Stamp', fontSize: pt(32), align: 'center', lineHeight: 1.2, textTransform: 'uppercase' }),
    // Highlight under the first line's bold words.
    box(`hl-${n}`, '#fee702', 40, 30.2, 30, 4.9),
    ...body.map((t, i) => text(`body-${n}-${i}`, t, 20, 30 + i * (lh * 2), 180)),
    ...extra,
  ];
}

const pageStyle = (id: string, elements: DesignElement[], extra: Partial<HeadingStyleConfig> = {}): HeadingStyleConfig =>
  ({ id, name: id.replace('--', ' '), numbered: false, hidden: true, header: { elements }, footer: { elements: [] }, ...extra }) as HeadingStyleConfig;

const P1 = topicPage('p1', 'Rivers and seas', 'THE WATER ON EARTH', [
  'Water covers most of the planet. **Rivers** carry it from the hills\ndown to the sea, where it joins the oceans.',
  'Along the way it shapes valleys, feeds fields\nand gives towns the water they drink.',
  'Some rivers dry up in summer; others never stop.',
]);
const P2 = topicPage('p2', 'The weather', 'THE WATER ON EARTH', [
  'The **weather** is what the air is like today:\nwarm or cold, wet or dry, still or windy.',
  'We measure it with a thermometer, a rain gauge\nand a weather vane on the school roof.',
  'Over many years the weather of a place makes its climate.',
], [text('label-p2', 'Rain gauge', 150, 150, 30, { fontSize: pt(9) })]);
/** A page whose running head mixes a placeholder with words (left). */
const P3 = topicPage('p3', 'Maps and plans', 'FINDING OUR WAY', [
  'A **map** shows a large place from above,\nsmaller than it is.',
  'A plan shows a small place, such as a classroom.',
  'Both have a key that explains their signs.',
], [text('folio-p3', 'Atlas page {pageNumber}', 20, 270, 60)]);

/** A spread over two pages: the time line's verso and recto elements. */
const SPREAD: DesignElement[] = [
  box('band-even', '#3cbc96', 0, 0, 230, 20),
  { ...text('left-head', 'Long ago people lived in caves and hunted for food.', 20, 40, 90), parity: 'even' } as DesignElement,
  { ...text('right-head', 'Later they built towns and wrote down their laws.', 20, 40, 90), parity: 'odd' } as DesignElement,
  { ...text('right-note', 'Writing changed how people kept their history.', 20, 80, 90), parity: 'odd' } as DesignElement,
];

export const PORT_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(230), height: mm(288), margins: { top: mm(28), bottom: mm(22), left: mm(25), right: mm(20), mirror: true } } as never,
  bodyText: { fontFamily: 'Fixture Serif', fontSize: pt(12), lineHeight: pt(18), color: hex('#231f20') } as never,
  headings: { balancing: { enabled: false }, levels: [{ level: 1, breakBefore: { enabled: true, parity: 'any' } }] } as never,
  chipStyles: [{ id: 'key', backgroundEnabled: true, background: hex('#fee702'), bold: true } as never],
  headingStyles: [
    pageStyle('topic--p1', P1),
    pageStyle('next--p1', P1, { breakBefore: { enabled: false, parity: 'any' } }),
    pageStyle('topic--p2', P2),
    pageStyle('topic--p3', P3),
    pageStyle('cont--p3', P3, { toc: false }),
    pageStyle('spread', SPREAD, { hidden: false, breakBefore: { enabled: true, parity: 'even' } }),
    pageStyle('cont--spread', SPREAD, { toc: false, breakBefore: { enabled: false, parity: 'any' } }),
    // Holds a sentence but no heading uses it.
    pageStyle('topic--p9', [text('orphan', 'This sentence is on no page of the book at all.', 20, 40, 120)]),
  ],
};

export const PORT_CHAPTERS = [
  {
    id: 'ch1',
    markdown: `---
title: "Our World"
---

# Rivers and seas {style="topic--p1" id="t-rivers"}

# Where rivers start {style="next--p1" id="t-springs"}

# The weather {style="topic--p2" id="t-weather"}
`,
  },
  {
    id: 'ch2',
    markdown: `# Maps and plans {style="topic--p3" id="t-maps"}

:::pagebreak

###### · {style="cont--p3"}

# Long ago {style="spread" id="t-long-ago"}

Some running text that the spread's first page sets in its flow.

:::pagebreak

###### Long ago (continued) {style="cont--spread"}
`,
  },
];
