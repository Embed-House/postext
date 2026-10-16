/**
 * A composed book in three editions (#867), for the tests of the checks
 * across languages and for the Sandbox demonstration: the page-8 stand-in
 * of the composed-pages programme (#855, a topic page of a primary-school
 * textbook with three tabbed boxes, the photos beside them) in Spanish,
 * English and Catalan, two chapters, three composed pages.
 *
 * The form is the configuration (one page template, its box styles); the
 * words are the Markdown. What each edition has to show:
 *
 * - every edition: chapter 1 page 1 (fence 0), chapter 2 page 1 (fence 0);
 * - English: the first box of chapter 1 runs a little long, so the
 *   reflow ladder shrinks its text (a percentage on the canvas); the
 *   second page of chapter 1 leaves its third box empty (`slotEmpty`);
 * - Spanish: the second page of chapter 1 names a slot the template does
 *   not have (`slotUnknown`);
 * - Catalan: the first box of chapter 2 holds more than its fixed height
 *   takes even with its text at the smallest scale (`frameOverflow`, a
 *   red mark on the canvas).
 */

import type { PostextConfig, Resource } from 'postext';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

export type FixtureLocale = 'es' | 'en' | 'ca';
export const FIXTURE_LOCALES: readonly FixtureLocale[] = ['es', 'en', 'ca'];

const box = (id: string, fill: string, tabSide: 'top-left' | 'top-right') => ({
  id,
  backgroundEnabled: true,
  background: hex(fill),
  border: { enabled: false },
  borderRadius: mm(1.5),
  padding: { top: mm(3), right: mm(4), bottom: mm(3.5), left: mm(4) },
  label: {
    position: tabSide,
    background: hex('#ffffff'),
    color: hex('#231f20'),
    fontSize: pt(11),
    height: mm(6.4),
    paddingX: mm(2.5),
    offset: mm(6.4),
    inset: mm(0),
  },
  body: { fontSize: pt(10.5), lineHeight: pt(15) },
});

/** The pictures: solid placeholders of the photos' proportions (the
 *  files of `postext`'s page-8 fixture). */
export const FIXTURE_RESOURCES: Resource[] = [
  ['foto-dinero', 150, 100],
  ['foto-gasto', 190, 140],
  ['foto-ahorro', 115, 95],
  ['banda-tema', 230, 288],
].map(([id, width, height]) => ({
  id: id as string,
  typeId: 'foto',
  kind: 'bitmap' as const,
  caption: '',
  createdAt: 0,
  updatedAt: 0,
  bitmap: { fileId: `${id as string}.png`, format: 'png', width: width as number, height: height as number, resolution: 72 },
})) as Resource[];

/** Form only: the template, its boxes, the folio. */
export function fixtureConfig(locale: FixtureLocale): PostextConfig {
  return {
    locale,
    page: { sizePreset: 'custom', width: mm(230), height: mm(288), margins: { top: mm(24), bottom: mm(22), left: mm(22), right: mm(22), mirror: true } } as never,
    bodyText: { fontSize: pt(12), lineHeight: pt(18) } as never,
    headings: {
      balancing: { enabled: false },
      levels: [
        { level: 1, fontSize: pt(22), lineHeight: pt(26), breakBefore: { enabled: false } },
        { level: 2, fontSize: pt(15), lineHeight: pt(20) },
      ],
    } as never,
    resourceTypes: [{ id: 'foto', name: 'Foto', shortLabel: 'Foto', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } }] as never,
    footer: { elements: [{ kind: 'text', id: 'folio', content: '{pageNumber}', fontSize: pt(10), placement: { anchor: { to: 'container', edge: 'bottom-left' } } }] } as never,
    calloutStyles: [
      { id: 'tab-titulo', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: false }, borderRadius: mm(1), padding: { top: mm(1.5), right: mm(4), bottom: mm(1.5), left: mm(4) } } as never,
      box('caja-azul', '#d8ecf9', 'top-left') as never,
      box('caja-verde', '#e6f3b4', 'top-right') as never,
      box('caja-amarilla', '#fdf0c4', 'top-left') as never,
    ],
    pageTemplates: [{
      id: 'tema-cajas',
      header: false,
      decoration: {
        elements: [
          { kind: 'image', id: 'fondo', resourceId: 'banda-tema', decorative: true, placement: { anchor: { to: 'bleed', edge: 'top-left' }, size: { width: 'fill', height: 'fill' } } },
          { kind: 'box', id: 'tarjeta', placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(-6), y: mm(-4) }, size: { width: mm(198), height: mm(250) } }, style: { backgroundColor: hex('#ffffff'), borderRadius: mm(4) } },
          { kind: 'text', id: 'tema', content: '{attr.tema}', fontSize: pt(9), color: hex('#ffffff'), placement: { anchor: { to: 'page', edge: 'top-right' }, offset: { x: mm(-10), y: mm(6) } } },
        ],
      } as never,
      frames: [
        { name: 'titulo', takes: 'h1', style: 'tab-titulo', width: mm(170), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(-4), y: mm(-2) } } },
        { name: 'texto', flow: true, placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { x: mm(4), y: mm(2) } }, width: mm(182) },
        // A box of a fixed height whose text may shrink to 80 %.
        { name: 'dinero', style: 'caja-azul', padding: { right: mm(62) }, height: mm(36), fit: { minScale: 0.8 }, placement: { anchor: { to: '#texto', edge: 'below' }, offset: { y: mm(9) } }, width: mm(186) },
        { name: 'dinero-fotos', layer: 2, width: mm(58), optional: true, placement: { anchor: { to: '#dinero', edge: 'top-right' }, offset: { x: mm(-2), y: mm(2) } } },
        { name: 'gasto', style: 'caja-verde', padding: { left: mm(82) }, minHeight: mm(50), width: mm(186), placement: { anchor: { to: '#dinero', edge: 'below' }, offset: { y: mm(12) } } },
        { name: 'gasto-fotos', layer: 2, width: mm(76), optional: true, placement: { anchor: { to: '#gasto', edge: 'top-left' }, offset: { x: mm(3), y: mm(9) } } },
        { name: 'ahorro', style: 'caja-amarilla', padding: { right: mm(50) }, minHeight: mm(30), width: mm(186), placement: { anchor: { to: '#gasto', edge: 'below' }, offset: { y: mm(12) } } },
      ],
    }] as never,
  };
}

const FENCE = (tema: string) => `::::page{template="tema-cajas" tema="${tema}"}`;

interface Words {
  tema: string;
  title: string;
  intro: string;
  dineroLabel: string;
  dinero: string;
  gastoLabel: string;
  gasto: string;
  ahorroLabel: string;
  ahorro: string;
}

function page(w: Words, opts: { photos?: boolean; skipAhorro?: boolean; extraSlot?: string } = {}): string {
  const out = [
    FENCE(w.tema),
    `# ${w.title}`,
    '',
    w.intro,
    '',
    `:::frame{slot="dinero" label="${w.dineroLabel}"}`,
    w.dinero,
    ':::',
    '',
  ];
  if (opts.photos) out.push('::resource{id="foto-dinero" slot="dinero-fotos"}', '');
  out.push(`:::frame{slot="gasto" label="${w.gastoLabel}"}`, w.gasto, ':::', '');
  if (opts.photos) out.push('::resource{id="foto-gasto" slot="gasto-fotos"}', '');
  if (!opts.skipAhorro) out.push(`:::frame{slot="ahorro" label="${w.ahorroLabel}"}`, w.ahorro, ':::', '');
  if (opts.extraSlot) out.push(opts.extraSlot, '');
  out.push('::::', '');
  return out.join('\n');
}

const WORDS: Record<FixtureLocale, { p1: Words; p2: Words; p3: Words; notes: string; ch2Intro: string }> = {
  es: {
    p1: {
      tema: 'Retos del planeta', title: 'El dinero y la vida de cada día',
      intro: 'Cada familia necesita alimentos, ropa y una casa. Los consigue en tiendas y mercados.',
      dineroLabel: 'Para qué sirve el dinero',
      dinero: 'El dinero nos deja cambiar nuestro trabajo por las cosas que necesitamos.',
      gastoLabel: 'En qué lo gastamos', gasto: 'Lo que una familia paga para vivir es su gasto: el alquiler, la luz, la comida.',
      ahorroLabel: 'Ahorrar', ahorro: 'Si gastamos menos de lo que ganamos, podemos ahorrar.',
    },
    p2: {
      tema: 'Retos del planeta', title: 'El presupuesto',
      intro: 'Un presupuesto ayuda a decidir cada mes cuánto gastar y cuánto guardar.',
      dineroLabel: 'Ingresos', dinero: 'Lo que entra en casa cada mes.',
      gastoLabel: 'Gastos', gasto: 'Lo que sale de casa cada mes.',
      ahorroLabel: 'Lo que queda', ahorro: 'Lo que guardamos para más adelante.',
    },
    p3: {
      tema: 'Retos del planeta', title: 'Comprar con cabeza',
      intro: 'Antes de comprar, pensamos si lo necesitamos de verdad.',
      dineroLabel: 'Comparar precios', dinero: 'El mismo producto puede costar distinto en cada tienda.',
      gastoLabel: 'Las ofertas', gasto: 'Una oferta solo es buena si necesitamos lo que compramos.',
      ahorroLabel: 'Reutilizar', ahorro: 'Arreglar y reutilizar también es ahorrar.',
    },
    notes: ':::frame{slot="notas"}\nUna nota para el maestro.\n:::',
    ch2Intro: '# Consumir con cabeza\n\nEste capítulo trata de cómo compramos.\n',
  },
  en: {
    p1: {
      tema: 'Planet challenges', title: 'Money and everyday life',
      intro: 'Every family needs food, clothes and a home. They get them in shops and markets.',
      dineroLabel: 'What money is for',
      dinero: 'Money lets us swap our work for the things we need, because everybody accepts what it is worth, in every shop and every market of the town, today and tomorrow. Not long ago almost everything was paid in coins and notes, in cash; today we also pay with cards, with a phone or with a bank transfer. Each time we pay, the money goes from one person to another and keeps moving round the town, so we look after it.',
      gastoLabel: 'What we spend it on', gasto: 'What a family pays to live is its spending: the rent, the electricity, the food.',
      ahorroLabel: 'Saving', ahorro: 'When we spend less than we earn, we can save.',
    },
    p2: {
      tema: 'Planet challenges', title: 'The budget',
      intro: 'A budget helps us decide each month how much to spend and how much to keep.',
      dineroLabel: 'Income', dinero: 'What comes into the home each month.',
      gastoLabel: 'Spending', gasto: 'What goes out of the home each month.',
      ahorroLabel: 'What is left', ahorro: 'What we keep for later.',
    },
    p3: {
      tema: 'Planet challenges', title: 'Shopping with sense',
      intro: 'Before we buy, we think about whether we really need it.',
      dineroLabel: 'Comparing prices', dinero: 'The same product may cost more in one shop than in another.',
      gastoLabel: 'Special offers', gasto: 'An offer is only good if we need what we buy.',
      ahorroLabel: 'Reusing', ahorro: 'Mending and reusing are saving too.',
    },
    notes: '',
    ch2Intro: '# Spending with sense\n\nThis chapter is about how we shop.\n',
  },
  ca: {
    p1: {
      tema: 'Reptes del planeta', title: 'Els diners i la vida de cada dia',
      intro: 'Cada família necessita aliments, roba i una casa. Els aconsegueix a les botigues i als mercats.',
      dineroLabel: 'Per a què serveixen els diners',
      dinero: 'Els diners ens deixen canviar la nostra feina per les coses que necessitem.',
      gastoLabel: 'En què els gastem', gasto: 'El que una família paga per viure és la seva despesa: el lloguer, la llum, el menjar.',
      ahorroLabel: 'Estalviar', ahorro: 'Si gastem menys del que guanyem, podem estalviar.',
    },
    p2: {
      tema: 'Reptes del planeta', title: 'El pressupost',
      intro: 'Un pressupost ajuda a decidir cada mes quant gastar i quant guardar.',
      dineroLabel: 'Ingressos', dinero: 'El que entra a casa cada mes.',
      gastoLabel: 'Despeses', gasto: 'El que surt de casa cada mes.',
      ahorroLabel: 'El que queda', ahorro: 'El que guardem per a més endavant.',
    },
    p3: {
      tema: 'Reptes del planeta', title: 'Comprar amb seny',
      intro: 'Abans de comprar, pensem si de debò ho necessitem.',
      dineroLabel: 'Comparar preus',
      dinero: 'El mateix producte pot costar diferent a cada botiga, i per això val la pena mirar-ne el preu en dues o tres abans de decidir. Les etiquetes diuen el preu de la unitat i també el del quilo o el litre, que és el que de debò ens deixa comparar. Un paquet gran no sempre surt més barat que dos de petits, i una marca coneguda no sempre és millor que la de la botiga. Quan tornem a casa, podem apuntar què hem comprat i quant ens ha costat, i així el mes vinent sabrem on ens convé anar a comprar cada cosa sense gastar més del compte. També podem fer una llista abans de sortir, i comprar només el que hi hem apuntat: així no ens enduem coses que després no farem servir. Si anem al mercat a final del matí, de vegades trobem la fruita i la verdura més barates, perquè les parades volen acabar el que els queda. I sempre convé guardar el tiquet, per si cal tornar alguna cosa que no funciona o que no ens va bé.',
      gastoLabel: 'Les ofertes', gasto: 'Una oferta només és bona si necessitem el que comprem.',
      ahorroLabel: 'Reutilitzar', ahorro: 'Arreglar i reutilitzar també és estalviar.',
    },
    notes: '',
    ch2Intro: '# Consumir amb seny\n\nAquest capítol tracta de com comprem.\n',
  },
};

/** The book in one edition: its chapters' Markdown, its configuration and
 *  resources. */
export function threeEditionsBook(locale: FixtureLocale): { chapters: { title: string; markdown: string }[]; config: PostextConfig; resources: Resource[] } {
  const w = WORDS[locale];
  const ch1 = [
    page(w.p1, { photos: true }),
    page(w.p2, { skipAhorro: locale === 'en', ...(w.notes ? { extraSlot: w.notes } : {}) }),
  ].join('\n');
  const ch2 = [w.ch2Intro, page(w.p3)].join('\n');
  return {
    chapters: [
      { title: w.p1.title, markdown: ch1 },
      { title: w.ch2Intro.split('\n')[0]!.slice(2), markdown: ch2 },
    ],
    config: fixtureConfig(locale),
    resources: FIXTURE_RESOURCES,
  };
}
