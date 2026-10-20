/**
 * A political map with its key and its scale bar (#1058): the country, its
 * capital, the towns and the border named in a legend label (rows of an
 * inline symbol and its meaning, on a plate with an outline), the
 * capital's name beside a ⊙ glyph, and the numbers of the scale bar set as
 * labels at anchors along the bar, which stays artwork. English, Spanish
 * and Arabic editions share the picture and its anchors; the words are
 * written for this fixture and the country is invented. The picture is a
 * flat placeholder of the map's proportions (`fixtures/page8/foto-dinero.png`).
 */
import type { PostextConfig, Resource } from '../../../types';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

export type LegendMapLocale = 'en' | 'es' | 'ar';

const TEXT: Record<LegendMapLocale, { title: string; intro: string; alt: string; country: string; capital: string; key: { country: string; capital: string; town: string; border: string }; km: string }> = {
  en: {
    title: 'Lirandia on the map',
    intro: 'Lirandia lies on the south coast of the continent. Its capital, Corvel, stands on a river a little way from the sea.',
    alt: 'Painted map of a coast with a gold country in the south.',
    country: 'LIRANDIA',
    capital: 'Corvel',
    key: { country: 'Lirandia', capital: 'Capital', town: 'Town', border: 'International border' },
    km: '100 km',
  },
  es: {
    title: 'Lirandia en el mapa',
    intro: 'Lirandia está en la costa sur del continente. Su capital, Corvel, se alza junto a un río, a poca distancia del mar.',
    alt: 'Mapa pintado de una costa con un país dorado en el sur.',
    country: 'LIRANDIA',
    capital: 'Corvel',
    key: { country: 'Lirandia', capital: 'Capital', town: 'Ciudad', border: 'Frontera internacional' },
    km: '100 km',
  },
  ar: {
    title: 'ليرانديا على الخريطة',
    intro: 'تقع ليرانديا على الساحل الجنوبي للقارة، وعاصمتها كورفيل على نهر قريب من البحر.',
    alt: 'خريطة مرسومة لساحل يظهر فيه بلد ذهبي في الجنوب.',
    country: 'ليرانديا',
    capital: 'كورفيل',
    key: { country: 'ليرانديا', capital: 'العاصمة', town: 'مدينة', border: 'حدود دولية' },
    km: '100 كم',
  },
};

/** The chapter's Markdown: the key is one label over several lines, each
 *  row opening with its symbol. A right-to-left edition stands its key at
 *  the anchor whose box grows to the right of it. */
export function legendMapMarkdown(locale: LegendMapLocale): string {
  const t = TEXT[locale];
  return [
    `# ${t.title}`,
    '',
    t.intro,
    '',
    ':::figure{resource="lirandia"}',
    `::alt[${t.alt}]`,
    `:::label{at="${locale === 'ar' ? 'key-rtl' : 'key'}"}`,
    `:icon[${t.key.country}]{glyph="■" font="Noto Sans Math" color="country"} ${t.key.country}`,
    `:icon[${t.key.capital}]{glyph="⊙" font="Noto Sans Math"} ${t.key.capital}`,
    `:icon[${t.key.town}]{resource="town-mark" size="0.55"} ${t.key.town}`,
    `:icon[${t.key.border}]{line="dashed" color="border"} ${t.key.border}`,
    ':::',
    `::label[${t.country}]{at="country"}`,
    `::label[:icon[${t.key.capital}]{glyph="⊙" font="Noto Sans Math"} ${t.capital}]{at="capital"}`,
    '::label[0]{at="scale-0"}',
    '::label[50]{at="scale-50"}',
    `::label[${t.km}]{at="scale-100"}`,
    ':::',
    '',
  ].join('\n');
}

export const LEGEND_MAP_RESOURCES: Resource[] = [
  {
    id: 'lirandia',
    typeId: 'figure',
    kind: 'bitmap',
    caption: '',
    createdAt: 0,
    updatedAt: 0,
    bitmap: { fileId: 'page8/foto-dinero.png', format: 'png', width: 150, height: 100 },
    anchors: [
      // The key over the open sea, top left: its box grows right of the
      // point in either direction of writing.
      { id: 'key', x: 0.03, y: 0.04, align: 'start', verticalAlign: 'top', style: 'key' },
      { id: 'key-rtl', x: 0.03, y: 0.04, align: 'end', verticalAlign: 'top', style: 'key' },
      { id: 'country', x: 0.5, y: 0.8, style: 'country' },
      { id: 'capital', x: 0.535, y: 0.85, align: 'start', style: 'town' },
      // The numbers under the ticks of the painted scale bar.
      { id: 'scale-0', x: 0.72, y: 0.955, style: 'scale' },
      { id: 'scale-50', x: 0.81, y: 0.955, style: 'scale' },
      { id: 'scale-100', x: 0.9, y: 0.955, style: 'scale' },
    ],
  },
  {
    id: 'town-mark',
    typeId: 'figure',
    kind: 'svg',
    createdAt: 0,
    updatedAt: 0,
    svg: { fileId: 'town-mark.svg', width: 10, height: 10 },
  },
] as Resource[];

export function legendMapConfig(locale: LegendMapLocale): PostextConfig {
  const face = locale === 'ar' ? 'Noto Kufi Arabic' : 'Source Sans 3';
  return {
    locale,
    page: { width: mm(210), height: mm(170), margins: { top: mm(15), bottom: mm(15), left: mm(15), right: mm(15) } } as never,
    bodyText: { fontFamily: face, fontSize: pt(10.5) } as never,
    headings: { fontFamily: face } as never,
    captionStyle: { fontFamily: face } as never,
    colorPalette: [
      { id: 'country', name: 'country', value: hex('#d9a92f') },
      { id: 'border', name: 'border', value: hex('#8a3b52') },
    ],
    labelStyles: [
      {
        id: 'key', kind: 'legend', fontFamily: face, fontSize: pt(8), color: hex('#1f2a2e'),
        background: hex('#ffffff'), border: { color: hex('#55646a'), width: pt(0.6) }, radius: pt(3), padding: pt(5),
      },
      { id: 'country', fontFamily: face, fontSize: pt(11), fontWeight: 700, letterSpacing: locale === 'ar' ? 0 : 0.2, color: hex('#5a3519') },
      { id: 'town', fontFamily: face, fontSize: pt(8), color: hex('#1f2a2e'), halo: { color: hex('#ffffff'), width: pt(1.2) } },
      { id: 'scale', fontFamily: face, fontSize: pt(7), color: hex('#1f2a2e'), halo: { color: hex('#ffffff'), width: pt(1) } },
    ],
  };
}

export function legendMapFixture(locale: LegendMapLocale): { markdown: string; config: PostextConfig; resources: Resource[] } {
  return { markdown: legendMapMarkdown(locale), config: legendMapConfig(locale), resources: LEGEND_MAP_RESOURCES };
}
