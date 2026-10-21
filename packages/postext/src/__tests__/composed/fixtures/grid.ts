/**
 * Grids of repeated frames (#1061): a page of photo cards, each a photo
 * frame with a caption pill hanging from its foot, declared once in the
 * template as a grid that repeats the set `foto` + `pie`; and a page of
 * cards made of a caption panel over a photo. The words are written for
 * this fixture (Spanish and English, a different count of cards per
 * language); the pictures are the solid placeholders of `fixtures/page8`.
 */
import type { PostextConfig, Resource } from '../../../types.js';
import type { PageTemplate } from '../../../composed/types.js';
import { PAGE8_RESOURCES, PAGE8_TYPES } from './page8.js';

export const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

/** The pictures: the four placeholders of page 8, in turn. */
const PICTURES = PAGE8_RESOURCES.filter((r) => r.id.startsWith('foto-')).map((r) => r.id);

export const GRID_RESOURCES: Resource[] = PAGE8_RESOURCES;

/** A photo card: the picture in the card's frame, its caption in the pill. */
export const photoItem = (k: number, caption: string, frameAttrs = ''): string =>
  `:::frame{slot="foto"${frameAttrs}}\n::resource{id="${PICTURES[k % PICTURES.length]}"}\n\n:::frame{slot="pie"}\n${caption}\n:::\n:::\n`;

/** A page of photo cards with a title. */
export const photoPage = (title: string, captions: readonly string[], template = 'fotos'): string =>
  `::::page{template="${template}"}\n# ${title}\n\n${captions.map((c, k) => photoItem(k, c)).join('\n')}::::\n`;

/** A panel card: a caption panel over a photo. */
export const panelItem = (k: number, text: string): string =>
  `:::frame{slot="panel"}\n${text}\n\n::resource{id="${PICTURES[k % PICTURES.length]}" slot="imagen"}\n:::\n`;

export const panelPage = (title: string, texts: readonly string[]): string =>
  `::::page{template="paneles"}\n# ${title}\n\n${texts.map((t, k) => panelItem(k, t)).join('\n')}::::\n`;

export const CAPTIONS = {
  es: ['La garza', 'El martín pescador', 'La nutria', 'El sapo', 'La libélula', 'El barbo', 'La rana verde', 'El mirlo acuático', 'La culebra de agua'],
  en: ['The heron', 'The kingfisher', 'The otter', 'The toad', 'The dragonfly', 'The barbel', 'The green frog', 'The dipper', 'The water snake'],
};

/** The photo-card template: a title, then the grid. */
export const PHOTO_TEMPLATE: PageTemplate = {
  id: 'fotos',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'foto', style: 'marco', placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(6) } } },
    { name: 'pie', style: 'pastilla', width: 'auto', layer: 2, placement: { anchor: { to: '#foto', edge: 'bottom' }, offset: { y: mm(4) } } },
  ],
  groups: [{ name: 'fotos', kind: 'grid', columns: 3, columnGap: mm(6), rowGap: mm(10), repeat: { frames: ['foto', 'pie'] } }],
};

/** The panel-card template: a caption panel with its photo under it. */
export const PANEL_TEMPLATE: PageTemplate = {
  id: 'paneles',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'panel', style: 'panel', minHeight: mm(20), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(6) } } },
    { name: 'imagen', style: 'marco', placement: { anchor: { to: '#panel', edge: 'below' }, offset: { y: mm(2) } } },
  ],
  groups: [{ name: 'paneles', kind: 'grid', columns: 3, columnGap: mm(5), rowGap: mm(8), rowAlign: 'start', repeat: { frames: ['panel', 'imagen'] } }],
};

export const GRID_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(210), height: mm(280), margins: { top: mm(18), bottom: mm(18), left: mm(16), right: mm(16), mirror: true } } as never,
  bodyText: { fontSize: pt(11), lineHeight: pt(15) } as never,
  headings: { balancing: { enabled: false }, levels: [{ level: 1, fontSize: pt(20), lineHeight: pt(24), breakBefore: { enabled: false } }] } as never,
  resourceTypes: PAGE8_TYPES,
  calloutStyles: [
    { id: 'marco', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: true, color: hex('#2a6f97'), width: pt(1.5) }, borderRadius: mm(2), padding: { top: mm(2), right: mm(2), bottom: mm(2), left: mm(2) } } as never,
    { id: 'pastilla', backgroundEnabled: true, background: hex('#f4a259'), border: { enabled: false }, borderRadius: mm(4), padding: { top: mm(1), right: mm(3), bottom: mm(1), left: mm(3) }, body: { fontSize: pt(9), lineHeight: pt(11), firstLineIndent: mm(0) } } as never,
    { id: 'panel', backgroundEnabled: true, background: hex('#e9f5db'), border: { enabled: false }, borderRadius: mm(2), padding: { top: mm(2), right: mm(3), bottom: mm(2), left: mm(3) }, body: { fontSize: pt(10), lineHeight: pt(13), firstLineIndent: mm(0) } } as never,
  ],
  pageTemplates: [PHOTO_TEMPLATE, PANEL_TEMPLATE],
};
