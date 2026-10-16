/**
 * A stand-in for page 8 of a primary-school social-science textbook (#855):
 * a topic page with a tabbed title, running text with key words, three
 * boxes with tabs (blue, green, yellow), each with its pictures beside it.
 * The words are written for this fixture (Spanish and English); the form is
 * a page template in the configuration, the content all in the Markdown.
 * The pictures are solid placeholders (`fixtures/page8/*.png`).
 */
import type { PostextConfig, Resource, ResourceType } from '../../../types';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });
const hex = (h: string) => ({ hex: h, model: 'hex' as const });

const MARKDOWN = {
  es: `::::page{template="tema-cajas" fondo="banda-tema" tema="Retos del planeta"}
# El dinero y la vida de cada día

## Lo que compramos y vendemos

Cada familia necesita :chip[alimentos]{style="clave"}, ropa y una casa. Los consigue en tiendas y mercados, que a su vez los reciben de quienes los cultivan o los fabrican. Este ir y venir de cosas y de trabajo es la :chip[actividad económica.]{style="clave"}

- Las :chip[tiendas y empresas.]{style="clave"} Preparan productos y servicios y los ofrecen a un precio.
- Las :chip[familias.]{style="clave"} Pagan esos productos con lo que ganan trabajando cada mes.

:::frame{slot="dinero" label="Para qué sirve el dinero"}
El dinero nos deja cambiar nuestro trabajo por las cosas que necesitamos, porque todo el mundo acepta su valor.

Antes casi todo se pagaba con monedas y billetes, en **efectivo**. Hoy también pagamos con **tarjetas**, con el teléfono o con una **transferencia** desde el banco.
:::

::resource{id="foto-dinero" slot="dinero-fotos"}

:::frame{slot="gasto" label="En qué lo gastamos"}
Lo que una familia paga para vivir es su gasto. Hay varias clases:

- **Fijo:** se repite cada mes, como el alquiler o la luz.
- **Variable:** cambia de un mes a otro, como la comida o la ropa.
- **Imprevisto:** llega sin avisar, como arreglar la bicicleta.
:::

::resource{id="foto-gasto" slot="gasto-fotos"}

:::frame{slot="ahorro" label="Pedir prestado y ahorrar"}
Para comprar algo muy caro, como un coche, a veces hay que pedir un **préstamo** al banco y devolverlo poco a poco. Si gastamos menos de lo que ganamos, podemos **ahorrar** para más adelante. Un **presupuesto** ayuda a decidir cada mes cuánto guardar.
:::

::resource{id="foto-ahorro" slot="ahorro-fotos"}
::::
`,
  en: `::::page{template="tema-cajas" fondo="banda-tema" tema="Planet challenges"}
# Money and everyday life

## What we buy and sell

Every family needs :chip[food]{style="clave"}, clothes and a home. They get them in shops and markets, which in turn get them from the people who grow or make them. This coming and going of goods and work is :chip[economic activity.]{style="clave"}

- :chip[Shops and companies.]{style="clave"} They make goods and services and offer them at a price.
- :chip[Families.]{style="clave"} They pay for them with what they earn at work each month.

:::frame{slot="dinero" label="What money is for"}
Money lets us swap our work for the things we need, because everybody accepts what it is worth.

Not long ago almost everything was paid in coins and notes, in **cash**. Today we also pay with **cards**, with a phone or with a **bank transfer**.
:::

::resource{id="foto-dinero" slot="dinero-fotos"}

:::frame{slot="gasto" label="What we spend it on"}
What a family pays to live is its spending. There are several kinds:

- **Fixed:** it comes back every month, like the rent or the electricity.
- **Variable:** it changes from month to month, like food or clothes.
- **Unexpected:** it arrives without warning, like mending the bicycle.
:::

::resource{id="foto-gasto" slot="gasto-fotos"}

:::frame{slot="ahorro" label="Borrowing and saving"}
To buy something very dear, like a car, a family may ask the bank for a **loan** and pay it back little by little. When we spend less than we earn, we can **save** for later. A **budget** helps us decide each month how much to keep.
:::

::resource{id="foto-ahorro" slot="ahorro-fotos"}
::::
`,
};

const box = (id: string, fill: string, ring: string, tabSide: 'top-left' | 'top-right') => ({
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
    rule: { enabled: false, color: hex(ring) },
  },
  body: { fontSize: pt(10.5), lineHeight: pt(15) },
});

export const PAGE8_TYPES: ResourceType[] = [
  { id: 'foto', name: 'Foto', shortLabel: 'Foto', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '', defaultPlacement: { position: 'here' } },
];

/** The fixture's pictures: solid placeholders of the photos' proportions. */
export const PAGE8_RESOURCES: Resource[] = [
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

/** The template and styles: form only, no words but the page's folio. */
export const PAGE8_CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(230), height: mm(288), margins: { top: mm(24), bottom: mm(22), left: mm(22), right: mm(22), mirror: true } } as never,
  bodyText: { fontSize: pt(12), lineHeight: pt(18) } as never,
  headings: {
    balancing: { enabled: false },
    levels: [
      { level: 1, fontSize: pt(22), lineHeight: pt(26), breakBefore: { enabled: false } },
      { level: 2, fontSize: pt(15), lineHeight: pt(20) },
    ],
  } as never,
  chipStyles: [{ id: 'clave', background: hex('#ffe500'), fontWeight: 700 } as never],
  resourceTypes: PAGE8_TYPES,
  footer: { elements: [{ kind: 'text', id: 'folio', content: '{pageNumber}', fontSize: pt(10), placement: { anchor: { to: 'container', edge: 'bottom-left' } } }] } as never,
  calloutStyles: [
    { id: 'tab-titulo', backgroundEnabled: true, background: hex('#ffffff'), border: { enabled: false }, borderRadius: mm(1), padding: { top: mm(1.5), right: mm(4), bottom: mm(1.5), left: mm(4) } } as never,
    box('caja-azul', '#d8ecf9', '#0885bf', 'top-left') as never,
    box('caja-verde', '#e6f3b4', '#66ae3e', 'top-right') as never,
    box('caja-amarilla', '#fdf0c4', '#f99d1c', 'top-left') as never,
  ],
  pageTemplates: [{
    id: 'tema-cajas',
    header: false,
    decoration: {
      elements: [
        { kind: 'image', id: 'fondo', resourceId: '{attr.fondo}', decorative: true, placement: { anchor: { to: 'bleed', edge: 'top-left' }, size: { width: 'fill', height: 'fill' } } },
        { kind: 'box', id: 'tarjeta', placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(-6), y: mm(-4) }, size: { width: mm(198), height: mm(250) } }, style: { backgroundColor: hex('#ffffff'), borderRadius: mm(4) } },
        { kind: 'text', id: 'tema', content: '{attr.tema}', fontSize: pt(9), color: hex('#ffffff'), placement: { anchor: { to: 'page', edge: 'top-right' }, offset: { x: mm(-10), y: mm(6) } } },
      ],
    } as never,
    frames: [
      { name: 'titulo', takes: 'h1', style: 'tab-titulo', width: mm(170), placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: mm(-4), y: mm(-2) } } },
      { name: 'texto', flow: true, placement: { anchor: { to: '#titulo', edge: 'below' }, offset: { x: mm(4), y: mm(2) } }, width: mm(182) },
      { name: 'dinero', style: 'caja-azul', padding: { right: mm(62) }, placement: { anchor: { to: '#texto', edge: 'below' }, offset: { y: mm(9) } }, width: mm(186) },
      { name: 'dinero-fotos', layer: 2, width: mm(58), placement: { anchor: { to: '#dinero', edge: 'top-right' }, offset: { x: mm(-2), y: mm(2) } } },
      { name: 'gasto', style: 'caja-verde', padding: { left: mm(82) }, minHeight: mm(62), placement: { anchor: { to: '#dinero', edge: 'below' }, offset: { y: mm(12) } }, width: mm(186) },
      { name: 'gasto-fotos', layer: 2, width: mm(76), placement: { anchor: { to: '#gasto', edge: 'top-left' }, offset: { x: mm(3), y: mm(9) } } },
      { name: 'ahorro', style: 'caja-amarilla', padding: { right: mm(50) }, placement: { anchor: { to: '#gasto', edge: 'below' }, offset: { y: mm(12) } }, width: mm(186) },
      { name: 'ahorro-fotos', layer: 2, width: mm(44), placement: { anchor: { to: '#ahorro', edge: 'right' }, offset: { x: mm(-3) } } },
    ],
  }],
};

export function page8Fixture(locale: 'es' | 'en'): { markdown: string; config: PostextConfig; resources: Resource[] } {
  return { markdown: MARKDOWN[locale], config: { ...PAGE8_CONFIG, locale }, resources: PAGE8_RESOURCES };
}
