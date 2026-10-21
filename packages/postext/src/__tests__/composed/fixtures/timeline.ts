/**
 * A stand-in for a double-page timeline of a primary-school social-science
 * textbook (#861): a tabbed title and running text on the left page, a box
 * on the right one, two era bands (the second across the spine), six eras
 * with a tabbed card each, a picture strip across both pages and six notes
 * under it. The words are written for this fixture (Spanish and English, on
 * how people have measured time); the form is one spread template in the
 * configuration, the content all in the Markdown. The strip is a flat
 * placeholder (`fixtures/timeline/tira-tiempo.png`).
 */
import type { PostextConfig, Resource, ResourceType } from '../../../types.js';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

interface Era {
  tab: string;
  when: string;
  what: string;
  note: string;
}

interface TimelineText {
  tema: string;
  title: string;
  intro: string[];
  boxLabel: string;
  box: string;
  bands: [string, string];
  eras: Era[];
}

const TEXT: Record<'es' | 'en', TimelineText> = {
  es: {
    tema: 'Sociedades en el tiempo',
    title: 'Cómo medimos el tiempo',
    intro: [
      'Para saber cuándo comer, trabajar o descansar, las personas siempre han necesitado medir el tiempo. Primero miraron el cielo: el sol, la luna y las estrellas. Después inventaron :chip[instrumentos]{style="clave"} cada vez más exactos.',
      'Esta historia se divide en dos partes: antes y después de los :chip[relojes de máquina,]{style="clave"} que funcionan solos, sin sol ni agua.',
      'Una :chip[línea del tiempo]{style="clave"} ordena los inventos del más antiguo al más moderno.',
    ],
    boxLabel: 'El día y el año',
    box: 'Un **día** es lo que tarda la Tierra en dar una vuelta sobre sí misma, y lo dividimos en 24 **horas**. Un **año** es lo que tarda en dar una vuelta completa alrededor del Sol: unos 365 días.',
    bands: ['Sin relojes de máquina', 'Con relojes de máquina'],
    eras: [
      { tab: 'Sombras', when: 'Hace 5000 años', what: 'El reloj de sol marca la hora con una sombra.', note: 'En Egipto se clavaba un palo en el suelo y se miraba hacia dónde caía su sombra. Con el cielo nublado no servía.' },
      { tab: 'Agua', when: 'Hace 3500 años', what: 'La clepsidra mide el tiempo con agua que gotea.', note: 'Un recipiente se vaciaba poco a poco por un agujero. Las marcas de dentro decían cuánto tiempo había pasado, también de noche.' },
      { tab: 'Fuego y arena', when: 'Siglo IX', what: 'Velas con rayas y relojes de arena.', note: 'Una vela con marcas se gastaba hora a hora. En los barcos se usaba el reloj de arena, que no se altera con las olas.' },
      { tab: 'Engranajes', when: 'Año 1300', what: 'Los primeros relojes mecánicos, en las torres.', note: 'Unas pesas movían ruedas dentadas, y las campanas de la torre daban la hora a todo el pueblo.' },
      { tab: 'Péndulo', when: 'Año 1656', what: 'El péndulo hace los relojes mucho más exactos.', note: 'Christiaan Huygens usó un peso que se balancea siempre al mismo ritmo. El reloj ya solo fallaba unos segundos al día.' },
      { tab: 'Átomos', when: 'Año 1955', what: 'El reloj atómico cuenta las vibraciones de un átomo.', note: 'Hoy los satélites y los teléfonos se ponen en hora con relojes atómicos, que tardarían millones de años en perder un segundo.' },
    ],
  },
  en: {
    tema: 'Societies through time',
    title: 'How we measure time',
    intro: [
      'To know when to eat, work or rest, people have always needed to measure time. First they watched the sky: the sun, the moon and the stars. Then they invented :chip[instruments]{style="clave"} that grew more and more precise.',
      'This story falls into two parts: before and after :chip[machine clocks,]{style="clave"} which run on their own, with no sun or water.',
      'A :chip[timeline]{style="clave"} puts the inventions in order, from the oldest to the newest.',
    ],
    boxLabel: 'Days and years',
    box: 'A **day** is the time the Earth takes to turn once on itself, and we divide it into 24 **hours**. A **year** is the time it takes to go once all the way round the Sun: about 365 days.',
    bands: ['Before machine clocks', 'With machine clocks'],
    eras: [
      { tab: 'Shadows', when: '5,000 years ago', what: 'The sundial tells the hour with a shadow.', note: 'In Egypt people pushed a stick into the ground and watched where its shadow fell. On a cloudy day it was no use.' },
      { tab: 'Water', when: '3,500 years ago', what: 'The water clock measures time with dripping water.', note: 'A pot emptied little by little through a hole. Marks inside it showed how much time had passed, at night too.' },
      { tab: 'Fire and sand', when: '9th century', what: 'Striped candles and hourglasses.', note: 'A candle with marks burned down hour by hour. On ships sailors used the hourglass, which the waves do not upset.' },
      { tab: 'Gears', when: 'The year 1300', what: 'The first mechanical clocks, in towers.', note: 'Weights turned toothed wheels, and the tower bells rang the hour for the whole town.' },
      { tab: 'Pendulum', when: 'The year 1656', what: 'The pendulum makes clocks far more precise.', note: 'Christiaan Huygens used a weight that always swings at the same pace. Clocks now went wrong by only a few seconds a day.' },
      { tab: 'Atoms', when: 'The year 1955', what: 'The atomic clock counts the vibrations of an atom.', note: 'Today satellites and phones set their time by atomic clocks, which would take millions of years to lose a second.' },
    ],
  },
};

/** The page's Markdown: every word of the spread, each piece sent to its
 *  frame by slot. */
export function timelineMarkdown(locale: 'es' | 'en'): string {
  const t = TEXT[locale];
  const out = [
    `::::page{template="linea-tiempo" spread tema="${t.tema}"}`,
    `# ${t.title}`,
    '',
    ...t.intro.flatMap((p) => [p, '']),
    `:::frame{slot="recuadro" label="${t.boxLabel}"}`,
    t.box,
    ':::',
    '',
    `:::frame{slot="banda-1"}`,
    t.bands[0],
    ':::',
    '',
    `:::frame{slot="banda-2"}`,
    t.bands[1],
    ':::',
    '',
  ];
  t.eras.forEach((e, i) => {
    out.push(`:::frame{slot="era-${i + 1}" label="${e.tab}"}`, `**${e.when}**`, '', e.what, ':::', '');
  });
  out.push('::resource{id="tira-tiempo" slot="tira"}', '');
  t.eras.forEach((e, i) => {
    out.push(`:::frame{slot="nota-${i + 1}"}`, e.note, ':::', '');
  });
  out.push('::::', '');
  return out.join('\n');
}

export const TIMELINE_TYPES: ResourceType[] = [
  { id: 'foto', name: 'Foto', shortLabel: 'Foto', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } },
];

/** The strip across both pages: a flat placeholder of its proportions. */
export const TIMELINE_RESOURCES: Resource[] = [{
  id: 'tira-tiempo',
  typeId: 'foto',
  kind: 'bitmap',
  caption: '',
  createdAt: 0,
  updatedAt: 0,
  bitmap: { fileId: 'tira-tiempo.png', format: 'png', width: 1640, height: 220, resolution: 72 },
}] as Resource[];

const tabbed = (id: string, fill: string, tab: string) => ({
  id,
  backgroundEnabled: true,
  background: hex(fill),
  border: { enabled: false },
  borderRadius: mm(1.5),
  padding: { top: mm(2.5), right: mm(3), bottom: mm(2.5), left: mm(3) },
  label: { position: 'top-left', background: hex(tab), color: hex('#231f20'), fontSize: pt(10), height: mm(6), paddingX: mm(2.5), offset: mm(6), inset: mm(0), rule: { enabled: false, color: hex(tab) } },
  body: { fontSize: pt(10), lineHeight: pt(13.5), firstLineIndent: mm(0) },
});

/** The gap between the era columns (mm): wider than the spine band the
 *  cards keep off (`gutter`), so no card meets it. */
const COLUMN_GAP = 12;

/** The spread template and its styles: form only, no words but the
 *  folio. */
export const TIMELINE_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(230), height: mm(288), margins: { top: mm(24), bottom: mm(22), left: mm(20), right: mm(20), mirror: true } } as never,
  bodyText: { fontSize: pt(11.5), lineHeight: pt(16.5), firstLineIndent: mm(0) } as never,
  headings: {
    balancing: { enabled: false },
    levels: [{ level: 1, fontSize: pt(22), lineHeight: pt(26), breakBefore: { enabled: false } }],
  } as never,
  chipStyles: [{ id: 'clave', background: hex('#ffe066'), fontWeight: 700 } as never],
  resourceTypes: TIMELINE_TYPES,
  footer: { elements: [{ kind: 'text', id: 'folio', content: '{pageNumber}', fontSize: pt(9), color: hex('#ffffff'), placement: { anchor: { to: 'outer', edge: 'bottom' }, offset: { y: mm(10) } } }] } as never,
  calloutStyles: [
    { id: 'tab-titulo', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: false }, borderRadius: mm(2), padding: { top: mm(1.5), right: mm(5), bottom: mm(1.5), left: mm(5) } } as never,
    { id: 'recuadro', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: true, color: hex('#e98a3c'), width: mm(0.5) }, borderRadius: mm(2), padding: { top: mm(3), right: mm(4), bottom: mm(3), left: mm(4) }, label: { position: 'top-left', background: hex('#e98a3c'), color: hex('#ffffff'), fontSize: pt(10), height: mm(6), paddingX: mm(3), offset: mm(6), inset: mm(0) }, body: { fontSize: pt(10.5), lineHeight: pt(14.5), firstLineIndent: mm(0) } } as never,
    { id: 'banda', backgroundEnabled: true, background: hex('#f2a65a'), border: { enabled: false }, borderRadius: mm(1), padding: { top: mm(1.2), right: mm(3), bottom: mm(1.2), left: mm(3) }, body: { fontSize: pt(10), lineHeight: pt(12), fontWeight: 700, textAlign: 'center' } } as never,
    tabbed('era', '#e3f1c6', '#f6c27d') as never,
    { id: 'nota', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: true, color: hex('#b9b9b9'), width: mm(0.3) }, borderRadius: mm(1.5), padding: { top: mm(2), right: mm(2.5), bottom: mm(2), left: mm(2.5) }, body: { fontSize: pt(9.5), lineHeight: pt(12.5), firstLineIndent: mm(0) } } as never,
  ],
  pageTemplates: [{
    id: 'linea-tiempo',
    spread: true,
    gutter: mm(10),
    header: false,
    grid: { columns: 6, rows: 12, columnGap: mm(COLUMN_GAP), rowGap: mm(3) },
    decoration: {
      elements: [
        { kind: 'box', id: 'fondo', placement: { anchor: { to: 'bleed', edge: 'top-left' }, size: { width: 'fill', height: 'fill' } }, style: { backgroundColor: hex('#4f9fbf') } },
        { kind: 'box', id: 'tarjeta', placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(10), y: mm(16) } , size: { width: mm(440), height: mm(254) } }, style: { backgroundColor: hex('#ffffff'), borderRadius: mm(4) } },
        { kind: 'text', id: 'tema', content: '{attr.tema}', fontSize: pt(9), color: hex('#ffffff'), placement: { anchor: { to: 'page', edge: 'top-right' }, offset: { x: mm(-12), y: mm(6) } } },
      ],
    } as never,
    frames: [
      { name: 'titulo', takes: 'h1', style: 'tab-titulo', width: mm(150), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(-6), y: mm(-6) } } },
      { name: 'texto', flow: true, width: mm(196), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { x: mm(6), y: mm(3) } } },
      { name: 'recuadro', style: 'recuadro', grid: { col: 4, row: 1, cols: 3, rows: 4 }, height: 'auto' },
      { name: 'banda-1', style: 'banda', grid: { col: 1, row: 5, cols: 3 }, height: mm(8) },
      // The second band starts on the left page and runs across the spine.
      { name: 'banda-2', style: 'banda', crossGutter: true, height: mm(8), width: 'fill', placement: { anchor: { to: '#banda-1', edge: 'right-of' }, offset: { x: mm(2) } } },
      ...[1, 2, 3, 4, 5, 6].map((k) => ({ name: `era-${k}`, style: 'era', grid: { col: k, row: 6, rows: 2 }, height: 'auto' as const })),
      { name: 'tira', crossGutter: true, grid: { col: 1, row: 8, cols: 6, rows: 3 } },
      // The notes sit over the strip's foot, as cards over a picture.
      ...[1, 2, 3, 4, 5, 6].map((k) => ({ name: `nota-${k}`, style: 'nota', layer: 2, grid: { col: k, row: 10, rows: 3 }, height: 'auto' as const })),
    ],
  }],
};

export function timelineFixture(locale: 'es' | 'en'): { markdown: string; config: PostextConfig; resources: Resource[] } {
  return { markdown: timelineMarkdown(locale), config: { ...TIMELINE_CONFIG, locale }, resources: TIMELINE_RESOURCES };
}
