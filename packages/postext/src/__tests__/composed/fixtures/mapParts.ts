/**
 * The parts of a map (#1057): a painted map in a frame, its title, its key
 * and its scale set on it as labels, and three notes beside it, each joined
 * by a connector with a dot at its end to the anchor of the part it names
 * (`title`, `legend`, `scale`). Two names on the map stand away from their
 * points with a leader (a mountain range, a lake). English, Spanish and
 * Arabic editions share the picture and its anchors; the words are written
 * for this fixture, the country is invented. The form is the template and
 * the label styles; every word is in the Markdown.
 */
import type { PostextConfig, Resource } from '../../../types';
import type { PageTemplate } from '../../../composed/types';

export const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

export type MapPartsLocale = 'en' | 'es' | 'ar';

interface MapPartsText {
  heading: string;
  notes: [string, string, string];
  alt: string;
  title: string;
  key: { country: string; river: string; peak: string };
  km: string;
  peaks: string;
  lake: string;
  caption: string;
}

export const MAP_PARTS_TEXT: Record<MapPartsLocale, MapPartsText> = {
  en: {
    heading: 'The parts of a map',
    notes: [
      'The **title** says which place the map shows.',
      'The **key** tells what each colour and sign means.',
      'The **scale** shows how far apart two places really are.',
    ],
    alt: 'Painted map of a coast, with the country of Varenia in gold in the south.',
    title: 'VARENIA',
    key: { country: 'Varenia', river: 'River', peak: 'Mountains' },
    km: '0 — 50 km',
    peaks: 'Grey Peaks',
    lake: 'Lake Orla',
    caption: 'Varenia and the lands around it.',
  },
  es: {
    heading: 'Las partes de un mapa',
    notes: [
      'El **título** dice qué lugar muestra el mapa, para que sepamos de un vistazo de qué parte del mundo nos habla.',
      'La **leyenda** explica qué quiere decir cada color y cada signo que aparece dibujado sobre el mapa.',
      'La **escala** nos ayuda a saber a qué distancia están de verdad dos lugares del mapa.',
    ],
    alt: 'Mapa pintado de una costa, con el país de Varenia en dorado al sur.',
    title: 'VARENIA',
    key: { country: 'Varenia', river: 'Río', peak: 'Montañas' },
    km: '0 — 50 km',
    peaks: 'Picos Grises',
    lake: 'Lago Orla',
    caption: 'Varenia y las tierras que la rodean.',
  },
  ar: {
    heading: 'أجزاء الخريطة',
    notes: [
      '**العنوان** يخبرنا بالمكان الذي تعرضه الخريطة.',
      '**المفتاح** يشرح معنى كل لون وكل علامة.',
      '**مقياس الرسم** يبيّن المسافة الحقيقية بين مكانين.',
    ],
    alt: 'خريطة مرسومة لساحل يظهر فيه بلد فارينيا بالذهبي في الجنوب.',
    title: 'فارينيا',
    key: { country: 'فارينيا', river: 'نهر', peak: 'جبال' },
    km: '0 — 50 كم',
    peaks: 'القمم الرمادية',
    lake: 'بحيرة أورلا',
    caption: 'فارينيا والأراضي المحيطة بها.',
  },
};

const note = (slot: string, text: string): string => `:::frame{slot="${slot}"}\n${text}\n:::\n`;

/** The figure: the map and its labels. */
function mapFigure(locale: MapPartsLocale, slot: string): string {
  const t = MAP_PARTS_TEXT[locale];
  // A right-to-left edition sets the parts at the anchors whose boxes grow
  // to the right of the same points (its labels' start is their right).
  const at = (id: string): string => (locale === 'ar' ? `${id}-rtl` : id);
  return [
    `:::figure{resource="varenia" slot="${slot}"}`,
    `::alt[${t.alt}]`,
    `::label[${t.title}]{at="${at('title')}"}`,
    `:::label{at="${at('legend')}"}`,
    `:icon[${t.key.country}]{glyph="■" font="Noto Sans Math" color="#e0b23a"} ${t.key.country}`,
    `:icon[${t.key.river}]{line="solid" color="#5b8fc7"} ${t.key.river}`,
    `:icon[${t.key.peak}]{glyph="▲" font="Noto Sans Math" color="#8a6a4a"} ${t.key.peak}`,
    ':::',
    `::label[:icon[]{line="solid"} ${t.km}]{at="${at('scale')}"}`,
    `::label[${t.peaks}]{at="peaks"}`,
    `::label[${t.lake}]{at="lake"}`,
    ':::',
  ].join('\n');
}

/** The page of `locale`: the heading, the map and the three notes.
 *  `lead` goes before the figure in the map's frame (a paragraph long
 *  enough makes the ladder scale the picture). */
export function mapPartsPage(locale: MapPartsLocale, options: { template?: string; spread?: boolean; lead?: string } = {}): string {
  const t = MAP_PARTS_TEXT[locale];
  return [
    `::::page{template="${options.template ?? 'partes'}"${options.spread ? ' spread' : ''}}`,
    `# ${t.heading}`,
    '',
    ...(options.lead ? [note('mapa', options.lead)] : []),
    mapFigure(locale, 'mapa'),
    '',
    note('n1', t.notes[0]),
    note('n2', t.notes[1]),
    note('n3', t.notes[2]),
    '::::',
    '',
    t.caption,
    '',
  ].join('\n');
}

/** The map, 1776 × 1184 px (the painted locator map of the school-atlas
 *  recipe in the evidence; any picture of that shape in the tests). */
export const MAP_PARTS_RESOURCES: Resource[] = [
  {
    id: 'varenia',
    typeId: 'mapa',
    kind: 'bitmap',
    caption: '',
    createdAt: 0,
    updatedAt: 0,
    bitmap: { fileId: 'locator-1776.jpg', format: 'jpeg', width: 1776, height: 1184 },
    anchors: [
      // The parts of the map, over the open sea on its left: each label's
      // box grows right of its point, where the connector's dot lands.
      { id: 'title', x: 0.035, y: 0.05, align: 'start', verticalAlign: 'top', style: 'title' },
      { id: 'legend', x: 0.035, y: 0.5, align: 'start', verticalAlign: 'middle', style: 'key' },
      { id: 'scale', x: 0.035, y: 0.95, align: 'start', verticalAlign: 'bottom', style: 'scale' },
      { id: 'title-rtl', x: 0.035, y: 0.05, align: 'end', verticalAlign: 'top', style: 'title' },
      { id: 'legend-rtl', x: 0.035, y: 0.5, align: 'end', verticalAlign: 'middle', style: 'key' },
      { id: 'scale-rtl', x: 0.035, y: 0.95, align: 'end', verticalAlign: 'bottom', style: 'scale' },
      // Names set away from what they name, with a leader to it.
      { id: 'peaks', x: 0.42, y: 0.8, labelAt: { x: 0.62, y: 0.6 }, style: 'name', leader: true },
      { id: 'lake', x: 0.531, y: 0.865, labelAt: { x: 0.76, y: 0.93 }, style: 'name', leader: { routing: 'elbow', endCap: 'dot' } },
    ],
  },
] as Resource[];

/** The template: the heading on top, the map on the right, the notes in a
 *  column on its left, stacked; a connector from each note to its part. */
export const MAP_PARTS_TEMPLATE: PageTemplate = {
  id: 'partes',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    // Under the decoration (layer -1): the connectors run onto the map.
    { name: 'mapa', layer: -1, width: mm(118), height: mm(96), fit: { scaleImages: true, imageMinScale: 0.5 }, placement: { anchor: { to: 'container', edge: 'top-right' }, offset: { y: mm(18) } } },
    { name: 'n1', style: 'nota', width: mm(44), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(8) } } },
    { name: 'n2', style: 'nota', width: mm(44) },
    { name: 'n3', style: 'nota', width: mm(44) },
  ],
  groups: [{ name: 'notas', kind: 'stack', frames: ['n1', 'n2', 'n3'], gap: mm(9) }],
  decoration: {
    elements: [
      { kind: 'connector', id: 'a-titulo', routing: 'elbow', from: { to: '#n1', side: 'end' }, to: { to: '#mapa', anchor: 'title', gap: mm(1.2) }, endCap: 'dot', width: pt(0.9), capSize: mm(1.8), color: hex('#2e4a5c') },
      { kind: 'connector', id: 'a-leyenda', routing: 'elbow', from: { to: '#n2', side: 'end' }, to: { to: '#mapa', anchor: 'legend', gap: mm(1.2) }, endCap: 'dot', width: pt(0.9), capSize: mm(1.8), color: hex('#2e4a5c') },
      { kind: 'connector', id: 'a-escala', routing: 'elbow', from: { to: '#n3', side: 'end' }, to: { to: '#mapa', anchor: 'scale', gap: mm(1.2) }, endCap: 'dot', width: pt(0.9), capSize: mm(1.8), color: hex('#2e4a5c') },
    ],
  },
};

/** The same parts over a spread: the notes on the left page, the map on
 *  the right one, the connectors across the spine. */
export const MAP_PARTS_SPREAD_TEMPLATE: PageTemplate = {
  ...MAP_PARTS_TEMPLATE,
  id: 'partesPliego',
  spread: true,
  gutter: mm(16),
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'mapa', layer: -1, width: mm(160), height: mm(120), fit: { scaleImages: true, imageMinScale: 0.5 }, placement: { anchor: { to: 'container', edge: 'top-right' }, offset: { y: mm(30) } } },
    { name: 'n1', style: 'nota', width: mm(70), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(20) } } },
    { name: 'n2', style: 'nota', width: mm(70) },
    { name: 'n3', style: 'nota', width: mm(70) },
  ],
};

export function mapPartsConfig(locale: MapPartsLocale): PostextConfig {
  const face = locale === 'ar' ? 'Noto Kufi Arabic' : 'Source Sans 3';
  return {
    locale,
    ...(locale === 'ar' ? { direction: 'rtl' } : {}),
    page: { sizePreset: 'custom', width: mm(200), height: mm(150), margins: { top: mm(12), bottom: mm(12), left: mm(14), right: mm(14) } } as never,
    bodyText: { fontFamily: face, fontSize: pt(10.5), lineHeight: pt(14) } as never,
    headings: { fontFamily: face, balancing: { enabled: false }, levels: [{ level: 1, fontSize: pt(20), lineHeight: pt(24), breakBefore: { enabled: false } }] } as never,
    captionStyle: { fontFamily: face } as never,
    resourceTypes: [{ id: 'mapa', name: 'Map', shortLabel: 'Map', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } }] as never,
    calloutStyles: [
      {
        id: 'nota', backgroundEnabled: true, background: hex('#eef4f7'), border: { enabled: true, color: hex('#2e4a5c'), width: pt(0.9) }, borderRadius: mm(2),
        padding: { top: mm(2.5), right: mm(3), bottom: mm(2.5), left: mm(3) }, body: { fontSize: pt(10), lineHeight: pt(13), firstLineIndent: mm(0) },
      } as never,
    ],
    labelStyles: [
      { id: 'title', fontFamily: face, fontSize: pt(13), fontWeight: 700, letterSpacing: locale === 'ar' ? 0 : 0.12, color: hex('#1d3a4a'), halo: { color: hex('#ffffff'), width: pt(1.2) } },
      {
        id: 'key', kind: 'legend', fontFamily: face, fontSize: pt(7.5), color: hex('#1f2a2e'),
        background: hex('#ffffff'), border: { color: hex('#55646a'), width: pt(0.6) }, radius: pt(3), padding: pt(4),
      },
      { id: 'scale', fontFamily: face, fontSize: pt(7.5), color: hex('#1f2a2e'), halo: { color: hex('#ffffff'), width: pt(1) } },
      {
        id: 'name', fontFamily: face, fontSize: pt(8), fontStyle: 'italic', color: hex('#3b2a1a'), halo: { color: hex('#fff8e6'), width: pt(1.2) },
        leader: { color: hex('#3b2a1a'), width: pt(0.6), capSize: pt(2.4) },
      },
    ],
    pageTemplates: [MAP_PARTS_TEMPLATE, MAP_PARTS_SPREAD_TEMPLATE],
  };
}

export function mapPartsFixture(locale: MapPartsLocale, options: Parameters<typeof mapPartsPage>[1] = {}): { markdown: string; config: PostextConfig; resources: Resource[] } {
  return { markdown: mapPartsPage(locale, options), config: mapPartsConfig(locale), resources: MAP_PARTS_RESOURCES };
}
