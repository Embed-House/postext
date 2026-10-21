/**
 * Modules nested more than one level and rows that share their room
 * (#1095): a page shell whose modules stack holds a row (`banda`) of a
 * notice box beside a column (`columna`, a stack inside the row) of photo
 * cards, and, under it, a row of notice boxes whose widths are negotiated
 * by `grow` and `shrink`. A note frame of the page hangs under the row it
 * names (`#banda`). The words are written for this fixture, in Spanish and
 * English; the pictures are the solid placeholders of `fixtures/page8`.
 */
import type { PostextConfig } from '../../../types';
import type { PageTemplate } from '../../../composed/types';
import { MODULE_CONFIG, mm } from './modules';
import { CARD_MODULE, NOTICE_MODULE, ROWS_WORDS, cardModule, noticeModule, type RowsLocale } from './moduleRows';

/** The page shell: a title, the modules, and a note under the row. */
export const NESTED_TEMPLATE: PageTemplate = {
  id: 'anidada',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'nota', style: 'pastilla', width: 'auto', optional: true, placement: { anchor: { to: '#banda', edge: 'below' }, offset: { y: mm(3) } } },
  ],
  groups: [
    { name: 'cuerpo', modules: true, gap: mm(14), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(6) }, size: { width: 'fill', height: 'fill' } } },
    // A row whose second cell is a column of cards: two levels inside the
    // page's stack.
    { name: 'banda', modules: true, kind: 'row', within: 'cuerpo', templates: ['aviso'], gap: mm(6) },
    { name: 'columna', modules: true, within: 'banda', templates: ['tarjeta'], gap: mm(4) },
    // A row of boxes that share the room by grow and shrink.
    { name: 'reparto', modules: true, kind: 'row', within: 'cuerpo', templates: ['ancho', 'estrecho'], gap: mm(5) },
  ],
};

/** A notice box 60 mm wide that takes twice its share of what is left. */
export const WIDE_MODULE: PageTemplate = { ...NOTICE_MODULE, id: 'ancho', width: mm(60), grow: 2 };
/** A notice box 30 mm wide that takes one share. */
export const NARROW_MODULE: PageTemplate = { ...NOTICE_MODULE, id: 'estrecho', width: mm(30), grow: 1 };

export const NESTED_CONFIG: PostextConfig = {
  ...MODULE_CONFIG,
  pageTemplates: [NESTED_TEMPLATE, NOTICE_MODULE, CARD_MODULE, WIDE_MODULE, NARROW_MODULE],
};

/** A notice box of another template, with the box words of `k`. */
export const boxOf = (template: string, lang: RowsLocale, k: number): string =>
  noticeModule(lang, k).replace('template="aviso"', `template="${template}"`);

/** The page: a box beside two cards stacked, a note under them, then a
 *  wide and a narrow box sharing a row. */
export const nestedPage = (lang: RowsLocale): string =>
  `::::page{template="anidada"}\n# ${ROWS_WORDS[lang].title}\n\n`
  + [noticeModule(lang, 0), cardModule(lang, 0), cardModule(lang, 1), boxOf('ancho', lang, 1), boxOf('estrecho', lang, 0)].join('\n')
  + `\n:::frame{slot="nota"}\n${lang === 'es' ? 'Fotos de la orilla' : 'Photos of the bank'}\n:::\n::::\n`;
