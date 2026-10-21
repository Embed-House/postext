/**
 * Connectors between frames (#1056): a three-level tree of a pond's food
 * chain, an org chart of a school with two trees (the head over two
 * departments, one department over three teachers) and a timeline bar with
 * a drop to each dated pill. The words are written for this fixture, in
 * English, Spanish and Catalan; the form is three templates, the content
 * all in the Markdown, and the lines are decoration of the templates, not
 * pictures.
 */
import type { PostextConfig } from '../../../types.js';
import type { PageTemplate } from '../../../composed/types.js';

export const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });
const linked = (h: string, paletteId: string) => ({ hex: h, model: 'hex' as const, paletteId });

export type FixtureLocale = 'en' | 'es' | 'ca';

/** The tree's nodes: the root, two children, two grandchildren each. */
interface TreeText {
  title: string;
  root: string;
  a: string;
  b: string;
  a1: string;
  a2: string;
  b1: string;
  b2: string;
}

const TREE: Record<FixtureLocale, TreeText> = {
  en: { title: 'Who eats whom in the pond', root: 'The heron', a: 'Fish', b: 'Frogs', a1: 'Water fleas', a2: 'Snails', b1: 'Flies', b2: 'Beetles' },
  es: { title: 'Quién se come a quién en la charca', root: 'La garza', a: 'Los peces', b: 'Las ranas', a1: 'Las pulgas de agua', a2: 'Los caracoles', b1: 'Las moscas', b2: 'Los escarabajos acuáticos que viven en la orilla del arroyo' },
  ca: { title: 'Qui es menja qui a la bassa', root: 'El bernat pescaire', a: 'Els peixos', b: 'Les granotes', a1: 'Les puces d’aigua', a2: 'Els cargols', b1: 'Les mosques', b2: 'Els escarabats d’aigua que viuen a la vora del rierol' },
};

const frame = (slot: string, text: string): string => `:::frame{slot="${slot}"}\n${text}\n:::\n`;

/** The tree page of `locale`. */
export function treePage(locale: FixtureLocale): string {
  const t = TREE[locale];
  return [
    '::::page{template="arbol"}',
    `# ${t.title}`,
    '',
    frame('raiz', t.root),
    frame('a', t.a),
    frame('b', t.b),
    frame('a1', t.a1),
    frame('a2', t.a2),
    frame('b1', t.b1),
    frame('b2', t.b2),
    '::::',
    '',
  ].join('\n');
}

/** The three-level tree: a root, two children under it, two grandchildren
 *  under each child. Every node's height follows its words. */
export const TREE_TEMPLATE: PageTemplate = {
  id: 'arbol',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'raiz', style: 'nodo', width: mm(60), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { x: mm(55), y: mm(12) } } },
    { name: 'a', style: 'nodo', width: mm(55), placement: { anchor: { to: '#raiz', edge: 'below' }, offset: { x: mm(-45), y: mm(16) } } },
    { name: 'b', style: 'nodo', width: mm(55), placement: { anchor: { to: '#a', edge: 'align-top' }, offset: { x: mm(85) } } },
    { name: 'a1', style: 'hoja', width: mm(30), placement: { anchor: { to: '#a', edge: 'below' }, offset: { x: mm(-8), y: mm(16) } } },
    { name: 'a2', style: 'hoja', width: mm(30), placement: { anchor: { to: '#a1', edge: 'align-top' }, offset: { x: mm(36) } } },
    { name: 'b1', style: 'hoja', width: mm(30), placement: { anchor: { to: '#b', edge: 'below' }, offset: { x: mm(-8), y: mm(16) } } },
    { name: 'b2', style: 'hoja', width: mm(30), placement: { anchor: { to: '#b1', edge: 'align-top' }, offset: { x: mm(36) } } },
  ],
  decoration: {
    elements: [
      { kind: 'connector', id: 'ramas', routing: 'tree', radius: mm(2), width: pt(1.25), color: linked('#2a6f97', 'tinta'), from: { to: '#raiz' }, to: [{ to: '#a' }, { to: '#b' }] },
      { kind: 'connector', id: 'ramasA', routing: 'tree', radius: mm(2), width: pt(1), color: linked('#2a6f97', 'tinta'), from: { to: '#a' }, to: [{ to: '#a1' }, { to: '#a2' }], endCap: 'arrow' },
      { kind: 'connector', id: 'ramasB', routing: 'tree', radius: mm(2), width: pt(1), color: linked('#2a6f97', 'tinta'), from: { to: '#b' }, to: [{ to: '#b1' }, { to: '#b2' }], endCap: 'arrow' },
    ],
  },
};

interface OrgText {
  title: string;
  head: string;
  deptA: string;
  deptB: string;
  staff: [string, string, string];
}

const ORG: Record<FixtureLocale, OrgText> = {
  en: { title: 'How our school is run', head: 'Head teacher', deptA: 'Office', deptB: 'Teachers', staff: ['Year 1', 'Year 2', 'Year 3'] },
  es: { title: 'Cómo se organiza nuestra escuela', head: 'Dirección', deptA: 'Secretaría', deptB: 'Profesorado', staff: ['Primer curso', 'Segundo curso', 'Tercer curso'] },
  ca: { title: 'Com s’organitza la nostra escola', head: 'Direcció', deptA: 'Secretaria', deptB: 'Professorat', staff: ['Primer curs', 'Segon curs', 'Tercer curs'] },
};

export function orgPage(locale: FixtureLocale): string {
  const t = ORG[locale];
  return [
    '::::page{template="organigrama"}',
    `# ${t.title}`,
    '',
    frame('jefe', t.head),
    frame('dptoA', t.deptA),
    frame('dptoB', t.deptB),
    ...t.staff.map((s, k) => frame(`p${k + 1}`, s)),
    '::::',
    '',
  ].join('\n');
}

/** An org chart: the head over two departments (one tree), the second
 *  department over three teachers (another), dots where the lines meet the
 *  boxes. */
export const ORG_TEMPLATE: PageTemplate = {
  id: 'organigrama',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'jefe', style: 'nodo', width: mm(50), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { x: mm(55), y: mm(12) } } },
    { name: 'dptoA', style: 'nodo', width: mm(45), placement: { anchor: { to: '#jefe', edge: 'below' }, offset: { x: mm(-45), y: mm(18) } } },
    { name: 'dptoB', style: 'nodo', width: mm(45), placement: { anchor: { to: '#dptoA', edge: 'align-top' }, offset: { x: mm(95) } } },
    { name: 'p1', style: 'hoja', width: mm(34), placement: { anchor: { to: '#dptoB', edge: 'below' }, offset: { x: mm(-50), y: mm(18) } } },
    { name: 'p2', style: 'hoja', width: mm(34), placement: { anchor: { to: '#p1', edge: 'align-top' }, offset: { x: mm(40) } } },
    { name: 'p3', style: 'hoja', width: mm(34), placement: { anchor: { to: '#p2', edge: 'align-top' }, offset: { x: mm(40) } } },
  ],
  decoration: {
    elements: [
      { kind: 'connector', id: 'mando', routing: 'tree', trunk: 0.5, width: pt(1.5), color: linked('#7b2d26', 'tinta'), from: { to: '#jefe' }, to: [{ to: '#dptoA' }, { to: '#dptoB' }], startCap: 'dot', endCap: 'dot' },
      { kind: 'connector', id: 'claustro', routing: 'tree', radius: mm(3), width: pt(1), color: linked('#7b2d26', 'tinta'), from: { to: '#dptoB' }, to: [{ to: '#p1' }, { to: '#p2' }, { to: '#p3' }], startCap: 'dot', endCap: 'arrow' },
    ],
  },
};

const EVENTS: Record<FixtureLocale, { title: string; bar: string; pills: [string, string, string, string] }> = {
  en: { title: 'A year at school', bar: 'September → June', pills: ['Start of term', 'Winter fair', 'Spring trip', 'Summer show'] },
  es: { title: 'Un curso en la escuela', bar: 'Septiembre → junio', pills: ['Empieza el curso', 'Feria de invierno', 'Excursión de primavera', 'Fiesta de verano'] },
  ca: { title: 'Un curs a l’escola', bar: 'Setembre → juny', pills: ['Comença el curs', 'Fira d’hivern', 'Excursió de primavera', 'Festa d’estiu'] },
};

export function timelinePage(locale: FixtureLocale): string {
  const t = EVENTS[locale];
  return [
    '::::page{template="linea"}',
    `# ${t.title}`,
    '',
    frame('barra', t.bar),
    ...t.pills.map((p, k) => frame(`e${k + 1}`, p)),
    '::::',
    '',
  ].join('\n');
}

/** A timeline: a bar, four dated pills under it, and from the bar's foot
 *  a straight drop to each (`trunk: 0`: no bar of the tree's own, the
 *  drops hang from the band). */
export const TIMELINE_TEMPLATE: PageTemplate = {
  id: 'linea',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    { name: 'barra', style: 'barra', width: mm(160), placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(10) } } },
    { name: 'e1', style: 'hoja', width: mm(32), placement: { anchor: { to: '#barra', edge: 'below' }, offset: { x: mm(4), y: mm(14) } } },
    { name: 'e2', style: 'hoja', width: mm(32), placement: { anchor: { to: '#e1', edge: 'align-top' }, offset: { x: mm(40), y: mm(10) } } },
    { name: 'e3', style: 'hoja', width: mm(32), placement: { anchor: { to: '#e1', edge: 'align-top' }, offset: { x: mm(80) } } },
    { name: 'e4', style: 'hoja', width: mm(32), placement: { anchor: { to: '#e1', edge: 'align-top' }, offset: { x: mm(120), y: mm(10) } } },
  ],
  decoration: {
    elements: [
      { kind: 'connector', id: 'hitos', routing: 'tree', trunk: 0, width: pt(1.25), dash: [pt(2), pt(1.5)], color: linked('#2a6f97', 'tinta'), from: { to: '#barra' }, to: [{ to: '#e1' }, { to: '#e2' }, { to: '#e3' }, { to: '#e4' }], startCap: 'dot', capSize: mm(2) },
    ],
  },
};

export const CONNECTOR_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(200), height: mm(260), margins: { top: mm(18), bottom: mm(18), left: mm(20), right: mm(20) } } as never,
  bodyText: { fontSize: pt(11), lineHeight: pt(14) } as never,
  headings: { balancing: { enabled: false }, levels: [{ level: 1, fontSize: pt(20), lineHeight: pt(24), breakBefore: { enabled: false } }] } as never,
  colorPalette: [{ id: 'tinta', name: 'Ink', value: hex('#2a6f97') }] as never,
  calloutStyles: [
    { id: 'nodo', backgroundEnabled: true, background: hex('#e9f5db'), border: { enabled: true, color: hex('#2a6f97'), width: pt(1) }, borderRadius: mm(2), padding: { top: mm(2), right: mm(3), bottom: mm(2), left: mm(3) }, body: { fontSize: pt(12), lineHeight: pt(15), firstLineIndent: mm(0), textAlign: 'center' } } as never,
    { id: 'hoja', backgroundEnabled: true, background: hex('#fff3d6'), border: { enabled: true, color: hex('#f4a259'), width: pt(1) }, borderRadius: mm(4), padding: { top: mm(1.5), right: mm(2), bottom: mm(1.5), left: mm(2) }, body: { fontSize: pt(10), lineHeight: pt(12), firstLineIndent: mm(0), textAlign: 'center' } } as never,
    { id: 'barra', backgroundEnabled: true, background: hex('#2a6f97'), border: { enabled: false }, borderRadius: mm(1), padding: { top: mm(2), right: mm(4), bottom: mm(2), left: mm(4) }, body: { fontSize: pt(12), lineHeight: pt(15), firstLineIndent: mm(0), color: hex('#ffffff') } } as never,
  ],
  pageTemplates: [TREE_TEMPLATE, ORG_TEMPLATE, TIMELINE_TEMPLATE],
};
