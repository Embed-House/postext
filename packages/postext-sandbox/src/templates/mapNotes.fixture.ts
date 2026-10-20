import type { PageTemplate, PostextConfig, Resource } from 'postext';

// A "parts of a map" page as an author starts it in the Sandbox (#1064): a
// map in a frame with its title, key and scale as labels, three notes
// beside it, two names on the map. No pointer, no leader, no key style yet:
// the tests add them with the Sandbox's own edits (the anchor editor, the
// frame's pointers, the label style editor) and check the laid page. The
// words and the country are invented.

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

export const MAP_NOTES_MARKDOWN = [
  '::::page{template="parts"}',
  '# The parts of a map',
  '',
  ':::figure{resource="island" slot="map"}',
  '::label[ISLE OF ARDEN]{at="title"}',
  ':::label{at="legend"}',
  ':icon[]{glyph="■" color="#e0b23a"} Fields',
  ':icon[]{line="solid" color="#5b8fc7"} River',
  ':::',
  '::label[0 — 10 km]{at="scale"}',
  '::label[Black Hills]{at="hills"}',
  '::label[Still Water]{at="pond"}',
  ':::',
  '',
  ':::frame{slot="n1"}',
  'The **title** names the place.',
  ':::',
  ':::frame{slot="n2"}',
  'The **key** says what each sign means.',
  ':::',
  ':::frame{slot="n3"}',
  'The **scale** shows real distances.',
  ':::',
  '::::',
  '',
].join('\n');

export const MAP_NOTES_RESOURCES: Resource[] = [
  {
    id: 'island',
    typeId: 'figure',
    kind: 'bitmap',
    createdAt: 0,
    updatedAt: 0,
    bitmap: { fileId: 'island.png', format: 'png', width: 1200, height: 800, resolution: 300 },
    anchors: [
      { id: 'title', x: 0.04, y: 0.06, align: 'start', verticalAlign: 'top', style: 'title' },
      { id: 'legend', x: 0.04, y: 0.5, align: 'start', verticalAlign: 'middle' },
      { id: 'scale', x: 0.04, y: 0.94, align: 'start', verticalAlign: 'bottom' },
      { id: 'hills', x: 0.45, y: 0.75, style: 'name' },
      { id: 'pond', x: 0.55, y: 0.85, style: 'name' },
    ],
  } as Resource,
];

export const MAP_NOTES_TEMPLATE: PageTemplate = {
  id: 'parts',
  header: false,
  frames: [
    { name: 'heading', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'map', width: mm(110), height: mm(76), placement: { anchor: { to: 'container', edge: 'top-right' }, offset: { y: mm(18) } } },
    { name: 'n1', width: mm(44), placement: { anchor: { to: '#heading', edge: 'below' }, offset: { y: mm(8) } } },
    { name: 'n2', width: mm(44) },
    { name: 'n3', width: mm(44) },
  ],
  groups: [{ name: 'notes', kind: 'stack', frames: ['n1', 'n2', 'n3'], gap: mm(9) }],
};

export const MAP_NOTES_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(200), height: mm(140), margins: { top: mm(12), bottom: mm(12), left: mm(14), right: mm(14) } } as never,
  bodyText: { fontSize: pt(10), lineHeight: pt(13) } as never,
  labelStyles: [
    { id: 'title', fontSize: pt(13), fontWeight: 700, color: hex('#1d3a4a') },
    { id: 'name', fontSize: pt(8), fontStyle: 'italic', color: hex('#3b2a1a') },
  ],
  pageTemplates: [MAP_NOTES_TEMPLATE],
};
