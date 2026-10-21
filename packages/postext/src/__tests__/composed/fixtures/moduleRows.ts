/**
 * Modules side by side (#1088): a page shell whose modules stack holds a
 * row of two boxes (`aviso`) over a 2 × 2 grid of photo cards (`tarjeta`),
 * both groups inside the stack, so the Markdown writes modules alone. The
 * words are written for this fixture, in Spanish and English (the Spanish
 * first box is longer, so its row grows and the cards move down); the
 * pictures are the solid placeholders of `fixtures/page8`.
 */
import type { PostextConfig } from '../../../types';
import type { PageTemplate } from '../../../composed/types';
import { MODULE_CONFIG, mm } from './modules';
import { PAGE8_RESOURCES } from './page8';

const PICTURES = PAGE8_RESOURCES.filter((r) => r.id.startsWith('foto-')).map((r) => r.id);

/** The page shell: a title, then the modules; boxes go two to a row and
 *  cards two to a row, each where its first module comes. */
export const ROWS_TEMPLATE: PageTemplate = {
  id: 'doble',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
  ],
  groups: [
    { name: 'cuerpo', modules: true, gap: mm(8), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(6) }, size: { width: 'fill', height: 'fill' } } },
    { name: 'par', modules: true, kind: 'row', within: 'cuerpo', templates: ['aviso'], gap: mm(6) },
    { name: 'tarjetas', modules: true, kind: 'grid', within: 'cuerpo', templates: ['tarjeta'], columns: 2, columnGap: mm(6), rowGap: mm(6), rowAlign: 'start' },
  ],
};

/** A box with a tab over its text. */
export const NOTICE_MODULE: PageTemplate = {
  id: 'aviso',
  role: 'module',
  frames: [
    { name: 'texto', style: 'recuadro', placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { y: mm(6.4) } } },
  ],
};

/** A photo card with a caption pill hanging under it. */
export const CARD_MODULE: PageTemplate = {
  id: 'tarjeta',
  role: 'module',
  frames: [
    { name: 'foto', style: 'marco', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'pie', style: 'pastilla', width: 'auto', layer: 2, overlap: 'allow', placement: { anchor: { to: '#foto', edge: 'bottom' }, offset: { y: mm(4) } } },
  ],
};

export const ROWS_CONFIG: PostextConfig = {
  ...MODULE_CONFIG,
  pageTemplates: [ROWS_TEMPLATE, NOTICE_MODULE, CARD_MODULE],
};

export const ROWS_WORDS = {
  es: {
    title: 'La orilla',
    tabs: ['Observa', 'Piensa'],
    boxes: [
      'Junto al agua crecen juncos, cañas y sauces, que dan sombra y refugio a los animales pequeños. Muchas aves construyen allí sus nidos durante la primavera, cuando el río baja tranquilo y el suelo de la orilla está blando y húmedo.',
      '¿Por qué crees que hay más plantas en la orilla que lejos del río?',
    ],
    captions: ['El junco', 'El sauce', 'La rana', 'El martín pescador'],
  },
  en: {
    title: 'The bank',
    tabs: ['Look', 'Think'],
    boxes: [
      'Reeds and willows grow by the water and give shade to small animals.',
      'Why do you think more plants grow on the bank than far from the river?',
    ],
    captions: ['The reed', 'The willow', 'The frog', 'The kingfisher'],
  },
};

export type RowsLocale = keyof typeof ROWS_WORDS;

/** A box module's block. */
export const noticeModule = (lang: RowsLocale, k: number): string =>
  `:::module{template="aviso"}\n:::frame{slot="texto" label="${ROWS_WORDS[lang].tabs[k]}"}\n${ROWS_WORDS[lang].boxes[k]}\n:::\n:::\n`;

/** A card module's block. */
export const cardModule = (lang: RowsLocale, k: number): string =>
  `:::module{template="tarjeta"}\n::resource{id="${PICTURES[k % PICTURES.length]}" slot="foto"}\n\n:::frame{slot="pie"}\n${ROWS_WORDS[lang].captions[k]}\n:::\n:::\n`;

/** The page: a title, two boxes, four cards: modules alone. */
export const rowsPage = (lang: RowsLocale, modules: readonly string[] = [noticeModule(lang, 0), noticeModule(lang, 1), ...[0, 1, 2, 3].map((k) => cardModule(lang, k))]): string =>
  `::::page{template="doble"}\n# ${ROWS_WORDS[lang].title}\n\n${modules.join('\n')}::::\n`;
