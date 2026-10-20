/**
 * Modules (#1062): a topic page built from a page shell (a title and a
 * modules group) and three module templates a series of books could share:
 * a box with a tab and a photo beside its text (`caja`), a tree of three
 * frames over a tinted ground (`arbol`), and a 2 × 2 photo grid with its own
 * heading (`fotos`, a grid that repeats a photo and its caption). The words
 * are written for this fixture, in Spanish and English (the Spanish box is
 * longer, so it pushes the modules after it down); the pictures are the
 * solid placeholders of `fixtures/page8`.
 */
import type { PostextConfig, Resource } from '../../../types';
import type { PageTemplate } from '../../../composed/types';
import { PAGE8_RESOURCES, PAGE8_TYPES } from './page8';

export const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

const PICTURES = PAGE8_RESOURCES.filter((r) => r.id.startsWith('foto-')).map((r) => r.id);

export const MODULE_RESOURCES: Resource[] = PAGE8_RESOURCES;

/** The page shell: the title, then the modules one under another. */
export const TOPIC_TEMPLATE: PageTemplate = {
  id: 'tema',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
  ],
  groups: [{ name: 'cuerpo', modules: true, gap: mm(8), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(6) }, size: { width: 'fill', height: 'fill' } } }],
};

/** A box with a tab over its text and a photo beside it. */
export const BOX_MODULE: PageTemplate = {
  id: 'caja',
  role: 'module',
  frames: [
    { name: 'texto', style: 'recuadro', width: { percent: 64 }, placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { y: mm(6.4) } } },
    { name: 'foto', style: 'marco', width: mm(36), placement: { anchor: { to: '#texto', edge: 'right-of' }, offset: { x: mm(5) } } },
  ],
};

/** A tree of three: a root over two branches, on a tinted ground. */
export const TREE_MODULE: PageTemplate = {
  id: 'arbol',
  role: 'module',
  frames: [
    { name: 'raiz', style: 'nodo', width: mm(56), placement: { anchor: { to: 'container', edge: 'top' }, offset: { y: mm(4) } } },
    { name: 'izq', style: 'nodo', width: mm(56), placement: { anchor: { to: '#raiz', edge: 'below' }, offset: { x: mm(-44), y: mm(10) } } },
    { name: 'der', style: 'nodo', width: mm(56), placement: { anchor: { to: '#raiz', edge: 'below' }, offset: { x: mm(44), y: mm(10) } } },
  ],
  decoration: {
    elements: [
      { kind: 'box', id: 'suelo', placement: { anchor: { to: 'container', edge: 'top-left' }, size: { width: { to: 'container', edge: 'right' }, height: { to: 'container', edge: 'bottom' } } }, style: { backgroundColor: hex('#eef6ea'), borderRadius: mm(3) } },
      { kind: 'rule', id: 'tronco', direction: 'vertical', color: hex('#3c6e47'), thickness: pt(1.5), placement: { anchor: { to: '#raiz', edge: 'below' }, offset: { x: mm(28) }, size: { height: mm(5) } } },
      { kind: 'rule', id: 'rama', direction: 'horizontal', color: hex('#3c6e47'), thickness: pt(1.5), placement: { anchor: { to: '#raiz', edge: 'below' }, offset: { x: mm(-16), y: mm(5) }, size: { width: mm(88) } } },
      { kind: 'rule', id: 'hacia-izq', direction: 'vertical', color: hex('#3c6e47'), thickness: pt(1.5), placement: { anchor: { to: '#izq', edge: 'above' }, offset: { x: mm(28) }, size: { height: mm(5) } } },
      { kind: 'rule', id: 'hacia-der', direction: 'vertical', color: hex('#3c6e47'), thickness: pt(1.5), placement: { anchor: { to: '#der', edge: 'above' }, offset: { x: mm(28) }, size: { height: mm(5) } } },
    ],
  } as never,
};

/** A 2 × 2 photo grid under a heading of its own. */
export const PHOTOS_MODULE: PageTemplate = {
  id: 'fotos',
  role: 'module',
  frames: [
    { name: 'cabecera', takes: 'h3', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'foto', style: 'marco', placement: { anchor: { to: '#cabecera', edge: 'below' }, offset: { y: mm(3) } } },
    { name: 'pie', style: 'pastilla', width: 'auto', layer: 2, overlap: 'allow', placement: { anchor: { to: '#foto', edge: 'bottom' }, offset: { y: mm(4) } } },
  ],
  groups: [{ name: 'rejilla', kind: 'grid', columns: 2, columnGap: mm(6), rowGap: mm(8), repeat: { frames: ['foto', 'pie'] }, placement: { anchor: { to: '#cabecera', edge: 'below' }, offset: { y: mm(3) }, size: { width: mm(120), height: 'fill' } } }],
};

export const MODULE_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(210), height: mm(280), margins: { top: mm(18), bottom: mm(18), left: mm(16), right: mm(16), mirror: true } } as never,
  bodyText: { fontSize: pt(11), lineHeight: pt(15) } as never,
  headings: {
    balancing: { enabled: false },
    levels: [
      { level: 1, fontSize: pt(20), lineHeight: pt(24), breakBefore: { enabled: false } },
      { level: 3, fontSize: pt(13), lineHeight: pt(16) },
    ],
  } as never,
  resourceTypes: PAGE8_TYPES,
  calloutStyles: [
    {
      id: 'recuadro', backgroundEnabled: true, background: hex('#d8ecf9'), border: { enabled: false }, borderRadius: mm(1.5),
      padding: { top: mm(3), right: mm(4), bottom: mm(3.5), left: mm(4) },
      label: { position: 'top-left', background: hex('#0885bf'), color: hex('#ffffff'), fontSize: pt(10), height: mm(6.4), paddingX: mm(2.5), offset: mm(6.4), inset: mm(0), rule: { enabled: false, color: hex('#0885bf') } },
      body: { fontSize: pt(10.5), lineHeight: pt(15), firstLineIndent: mm(0) },
    } as never,
    { id: 'marco', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: true, color: hex('#2a6f97'), width: pt(1.5) }, borderRadius: mm(2), padding: { top: mm(2), right: mm(2), bottom: mm(2), left: mm(2) } } as never,
    { id: 'pastilla', backgroundEnabled: true, background: hex('#f4a259'), border: { enabled: false }, borderRadius: mm(4), padding: { top: mm(1), right: mm(3), bottom: mm(1), left: mm(3) }, body: { fontSize: pt(9), lineHeight: pt(11), firstLineIndent: mm(0) } } as never,
    { id: 'nodo', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: true, color: hex('#3c6e47'), width: pt(1) }, borderRadius: mm(3), padding: { top: mm(2), right: mm(3), bottom: mm(2), left: mm(3) }, body: { fontSize: pt(10), lineHeight: pt(13), firstLineIndent: mm(0), textAlign: 'center' } } as never,
  ],
  pageTemplates: [TOPIC_TEMPLATE, BOX_MODULE, TREE_MODULE, PHOTOS_MODULE],
};

/** The words of the topic page in each language. */
export const TOPIC_WORDS = {
  es: {
    title: 'El río',
    tab: '¿Sabías que…?',
    box: [
      'Un río nace en las montañas, donde la lluvia y la nieve se juntan en arroyos que bajan por las laderas.',
      'Por el camino recibe el agua de otros ríos más pequeños, que llamamos afluentes, y su cauce se hace cada vez más ancho y más lento hasta que llega al mar o a un lago.',
      'En sus orillas viven muchas plantas y animales que dependen de su agua limpia, y por eso conviene cuidarlo y no tirar nada a su corriente.',
    ],
    tree: ['El río', 'El agua que lleva', 'La vida en sus orillas'],
    photos: 'Animales del río',
    captions: ['La garza', 'La nutria', 'El sapo', 'La libélula'],
  },
  en: {
    title: 'The river',
    tab: 'Did you know?',
    box: [
      'A river begins in the mountains, where rain and snow gather into streams.',
      'On its way it takes in smaller rivers and grows wider until it reaches the sea.',
    ],
    tree: ['The river', 'The water it carries', 'Life on its banks'],
    photos: 'Animals of the river',
    captions: ['The heron', 'The otter', 'The toad', 'The dragonfly'],
  },
};

export type TopicLocale = keyof typeof TOPIC_WORDS;

/** The box module's block. */
export const boxModule = (lang: TopicLocale, attrs = ''): string => {
  const w = TOPIC_WORDS[lang];
  return `:::module{template="caja"${attrs}}\n:::frame{slot="texto" label="${w.tab}"}\n${w.box.join('\n\n')}\n:::\n::resource{id="${PICTURES[0]}" slot="foto"}\n:::\n`;
};

/** The tree module's block. */
export const treeModule = (lang: TopicLocale, attrs = ''): string => {
  const [root, left, right] = TOPIC_WORDS[lang].tree;
  return `:::module{template="arbol"${attrs}}\n:::frame{slot="raiz"}\n${root}\n:::\n:::frame{slot="izq"}\n${left}\n:::\n:::frame{slot="der"}\n${right}\n:::\n:::\n`;
};

/** The photo grid module's block: its heading, then one card per photo. */
export const photosModule = (lang: TopicLocale, attrs = ''): string => {
  const w = TOPIC_WORDS[lang];
  const cards = w.captions.map((c, k) => `:::frame{slot="foto"}\n::resource{id="${PICTURES[k % PICTURES.length]}"}\n\n:::frame{slot="pie"}\n${c}\n:::\n:::\n`).join('\n');
  return `:::module{template="fotos"${attrs}}\n### ${w.photos}\n\n${cards}:::\n`;
};

/** The topic page: a title and the three modules. */
export const topicPage = (lang: TopicLocale, modules: readonly string[] = [boxModule(lang), treeModule(lang), photosModule(lang)]): string =>
  `::::page{template="tema"}\n# ${TOPIC_WORDS[lang].title}\n\n${modules.join('\n')}::::\n`;
