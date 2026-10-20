/**
 * A page of one-off frames (#1065), as a port often starts: a title, five
 * photo cards drawn one by one (`foto1`…`foto5`, each with its caption
 * pill `pie1`…`pie5` hanging from its foot) on a three-column lattice,
 * then a box with a tab and a picture beside it (`nota`, `imagen`), a
 * rule over the box and a closing frame under it. «Turn these frames into
 * a grid» and «Extract a module» start from it. The words are written for
 * this fixture; the pictures are solid placeholders.
 */

import type { PageTemplate, PostextConfig, Resource } from 'postext';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

export const RESHAPE_RESOURCES: Resource[] = (
  [['foto-a', 150, 100], ['foto-b', 190, 140], ['foto-c', 115, 95]] as const
).map(([id, width, height]) => ({
  id,
  typeId: 'foto',
  kind: 'bitmap' as const,
  caption: '',
  createdAt: 0,
  updatedAt: 0,
  bitmap: { fileId: `${id}.png`, format: 'png', width, height, resolution: 72 },
})) as Resource[];

const card = (k: number, placement: NonNullable<PageTemplate['frames']>[number]['placement']): NonNullable<PageTemplate['frames']> => [
  { name: `foto${k}`, style: 'marco', width: mm(50), height: mm(36), placement },
  { name: `pie${k}`, style: 'pastilla', width: 'auto', layer: 2, overlap: 'allow', placement: { anchor: { to: `#foto${k}`, edge: 'bottom' }, offset: { y: mm(4) } } },
];

/** The page as drawn frame by frame. */
export const ONE_OFF_TEMPLATE: PageTemplate = {
  id: 'rio',
  header: false,
  frames: [
    { name: 'titulo', takes: 'h1', placement: { anchor: { to: 'container', edge: 'top-left' } } },
    ...card(1, { anchor: { to: '#titulo', edge: 'below' }, offset: { y: mm(6) } }),
    ...card(2, { anchor: { to: '#foto1', edge: 'right-of' }, offset: { x: mm(6) } }),
    ...card(3, { anchor: { to: '#foto2', edge: 'right-of' }, offset: { x: mm(6) } }),
    ...card(4, { anchor: { to: '#foto1', edge: 'below' }, offset: { y: mm(14) } }),
    ...card(5, { anchor: { to: '#foto4', edge: 'right-of' }, offset: { x: mm(6) } }),
    { name: 'nota', style: 'recuadro', width: mm(110), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { y: mm(150) } } },
    { name: 'imagen', style: 'marco', width: mm(50), height: mm(34), placement: { anchor: { to: '#nota', edge: 'right-of' }, offset: { x: mm(6) } } },
    { name: 'cierre', placement: { anchor: { to: '#nota', edge: 'below' }, offset: { y: mm(8) } } },
  ],
  decoration: {
    elements: [
      { kind: 'rule', id: 'raya', direction: 'horizontal', color: hex('#2a6f97'), thickness: pt(1), placement: { anchor: { to: '#nota', edge: 'above' }, offset: { y: mm(-2) }, size: { width: mm(110) } } },
    ],
  } as never,
};

export const RESHAPE_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(210), height: mm(280), margins: { top: mm(18), bottom: mm(18), left: mm(16), right: mm(16), mirror: true } } as never,
  bodyText: { fontSize: pt(11), lineHeight: pt(15) } as never,
  headings: { balancing: { enabled: false }, levels: [{ level: 1, fontSize: pt(20), lineHeight: pt(24), breakBefore: { enabled: false } }] } as never,
  resourceTypes: [{ id: 'foto', name: 'Foto', shortLabel: 'Foto', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } }] as never,
  calloutStyles: [
    { id: 'marco', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: true, color: hex('#2a6f97'), width: pt(1.5) }, borderRadius: mm(2), padding: { top: mm(2), right: mm(2), bottom: mm(2), left: mm(2) } } as never,
    { id: 'pastilla', backgroundEnabled: true, background: hex('#f4a259'), border: { enabled: false }, borderRadius: mm(4), padding: { top: mm(1), right: mm(3), bottom: mm(1), left: mm(3) }, body: { fontSize: pt(9), lineHeight: pt(11), firstLineIndent: mm(0) } } as never,
    {
      id: 'recuadro', backgroundEnabled: true, background: hex('#d8ecf9'), border: { enabled: false }, borderRadius: mm(1.5),
      padding: { top: mm(3), right: mm(4), bottom: mm(3.5), left: mm(4) },
      label: { position: 'top-left', background: hex('#0885bf'), color: hex('#ffffff'), fontSize: pt(10), height: mm(6.4), paddingX: mm(2.5), offset: mm(6.4), inset: mm(0), rule: { enabled: false, color: hex('#0885bf') } },
      body: { fontSize: pt(10.5), lineHeight: pt(15), firstLineIndent: mm(0) },
    } as never,
  ],
  pageTemplates: [ONE_OFF_TEMPLATE],
};

const CAPTIONS = ['The heron', 'The otter', 'The toad', 'The dragonfly', 'The kingfisher'];
const PICTURES = ['foto-a', 'foto-b', 'foto-c'];

/** The page's Markdown: the title, the cards (each picture and its
 *  caption), the box and the closing words. */
export function oneOffPage(): string {
  const cards = CAPTIONS.map((c, i) => `:::frame{slot="foto${i + 1}"}\n::resource{id="${PICTURES[i % PICTURES.length]}"}\n:::\n\n:::frame{slot="pie${i + 1}"}\n${c}\n:::\n`).join('\n');
  return [
    '::::page{template="rio"}',
    '# The river',
    '',
    cards,
    ':::frame{slot="nota" label="Did you know?"}',
    'A river begins in the mountains, where rain and snow gather into streams that run down the slopes.',
    '',
    'On its way it takes in smaller rivers and grows wider until it reaches the sea.',
    ':::',
    '',
    '::resource{id="foto-b" slot="imagen"}',
    '',
    ':::frame{slot="cierre"}',
    'Look after the river and leave nothing in its water.',
    ':::',
    '::::',
    '',
  ].join('\n');
}
