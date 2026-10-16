import { describe, it, expect } from 'vitest';
import { parseMarkdownWithIssues } from '../../parse';
import type { ContentBlock } from '../../parse';
import { composedPages } from '../../composed/document';

/** The p. 8 example of DESIGN §3.4. */
const P8 = `::::page{template="tema-cajas" fondo="banda-retos"}
# La actividad económica y el dinero

## La actividad económica

Las personas utilizan :chip[recursos]{style="clave"} que se obtienen de la naturaleza…

- Las :chip[empresas.]{style="clave"} Ofrecen bienes y servicios a cambio de un beneficio.
- Las :chip[personas y familias.]{style="clave"} Adquieren lo que ofrecen las empresas…

:::frame{slot="dinero" label="El dinero"}
Es el instrumento utilizado como medio de pago, ya que su valor es conocido…

Hasta hace pocos años, lo más normal, era pagar con dinero en **efectivo**…
:::

::resource{id="dinero-pago" slot="dinero-fotos"}

:::frame{slot="gasto" label="El gasto"}
El dinero que utilizan las personas para satisfacer sus necesidades…

- **Fijo:** es el que se produce todos los meses…
- **Variable:** puede cambiar según las necesidades…
- **Inesperado:** se producen por situaciones imprevistas…
:::

::resource{id="gasto-compras" slot="gasto-fotos"}

:::frame{slot="ahorro" label="Préstamos y ahorro"}
Si necesitas o quieres comprar algo muy caro…
:::

::resource{id="ahorro-balanza" slot="ahorro-fotos"}
::::
`;

const types = (blocks: ContentBlock[]) => blocks.map((b) => b.type);
const slice = (md: string, r: { sourceStart: number; sourceEnd: number }) => md.slice(r.sourceStart, r.sourceEnd);

describe('composed page fence (#854)', () => {
  it('parses the p. 8 example into a page node with named slots', () => {
    const { blocks, issues } = parseMarkdownWithIssues(P8);
    expect(issues).toEqual([]);
    const pages = composedPages(blocks);
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.type).toBe('composedPage');
    expect(page.template).toBe('tema-cajas');
    expect(page.spread).toBe(false);
    expect(page.fenceIndex).toBe(0);
    expect(page.attrs).toEqual({ template: 'tema-cajas', fondo: 'banda-retos' });
    expect(slice(P8, page.attrSources.fondo!)).toBe('banda-retos');
    expect(slice(P8, page.attrSources.template!)).toBe('tema-cajas');
    expect(page.sourceStart).toBe(0);
    expect(page.sourceEnd).toBe(P8.length - 1);
    expect(page.unclosed).toBe(false);
    // Slots in Markdown order.
    expect(Object.keys(page.slots)).toEqual(['dinero', 'dinero-fotos', 'gasto', 'gasto-fotos', 'ahorro', 'ahorro-fotos']);
    const text = (idx: number[]) => idx.map((i) => blocks[i]!).filter((b) => b.text).map((b) => b.text);
    expect(text(page.slots.dinero!)).toEqual([
      'Es el instrumento utilizado como medio de pago, ya que su valor es conocido…',
      'Hasta hace pocos años, lo más normal, era pagar con dinero en efectivo…',
    ]);
    expect(page.slots.gasto!.map((i) => blocks[i]!.type)).toEqual(['paragraph', 'listItem', 'listItem', 'listItem']);
    expect(page.slots['dinero-fotos']!.map((i) => blocks[i]!.resourceId)).toEqual(['dinero-pago']);
    expect(page.slots['ahorro-fotos']!.map((i) => blocks[i]!.resourceId)).toEqual(['ahorro-balanza']);
    // The title, the subheading, the paragraph and the list stay unassigned
    // (the `takes: h1` frame and the flow frame receive them).
    expect(page.unassigned.map((i) => blocks[i]!.type)).toEqual(['heading', 'heading', 'paragraph', 'listItem', 'listItem']);
    expect(page.firstHeadings).toEqual({ h1: page.unassigned[0], h2: page.unassigned[1] });
    // A frame's tab text comes from the Markdown.
    const frame = blocks.find((b) => b.containerName === 'frame')!;
    expect(frame.containerAttrs).toEqual({ slot: 'dinero', label: 'El dinero' });
    expect(slice(P8, frame.slot!)).toBe('dinero');
    expect(slice(P8, page.slotSources['dinero-fotos']!)).toBe('dinero-fotos');
    // The chips inside the page read as anywhere else.
    expect(blocks.find((b) => b.type === 'paragraph')!.spans.some((s) => s.chip?.style === 'clave')).toBe(true);
  });

  it('keeps every offset absolute when index marks are taken out first', () => {
    const md = `Intro:index[economía] text.\n\n${P8}`;
    const { blocks } = parseMarkdownWithIssues(md);
    const page = composedPages(blocks)[0]!;
    expect(slice(md, page.attrSources.fondo!)).toBe('banda-retos');
    expect(slice(md, page.slotSources['gasto-fotos']!)).toBe('gasto-fotos');
    const frame = blocks.find((b) => b.containerName === 'frame')!;
    expect(slice(md, frame.slot!)).toBe('dinero');
    expect(md.slice(page.fence.sourceStart, page.fence.sourceEnd)).toBe('::::page{template="tema-cajas" fondo="banda-retos"}');
  });

  it('nests three-colon containers inside the page', () => {
    const md = [
      '::::page{template="t"}',
      ':::frame{slot="a"}',
      ':::callout{type="nota"}',
      'Inside a box.',
      ':::',
      ':::columns{count=2}',
      'Left.',
      '',
      'Right.',
      ':::',
      ':::',
      'Flow text.',
      '::::',
      'After.',
    ].join('\n');
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toEqual([]);
    expect(blocks.map((b) => b.containerName ?? b.type)).toEqual([
      'composedPage', 'frame', 'callout', 'paragraph', 'callout', 'columns', 'paragraph', 'paragraph', 'columns', 'frame', 'paragraph', 'composedPage', 'paragraph',
    ]);
    const page = composedPages(blocks)[0]!;
    // The frame's own markers are left out; the nested ones are kept.
    expect(page.slots.a).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(page.unassigned).toEqual([10]);
  });

  it('a bare ::: never closes the page', () => {
    const md = '::::page{template="t"}\nText.\n:::\nMore.\n::::\n';
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toEqual([]);
    expect(types(blocks)).toEqual(['containerStart', 'paragraph', 'paragraph', 'containerEnd']);
    // The stray fence is set as text, as a stray ::: always was.
    expect(blocks[2]!.text).toBe('::: More.');
  });

  it('closes with a fence of the same length (five colons)', () => {
    const md = ':::::page{template="t"}\nA.\n::::\nB.\n:::::\nAfter.';
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toEqual([]);
    expect(blocks[0]!.composedPage!.colons).toBe(5);
    // The four-colon line inside is not its fence: text of the paragraph.
    expect(blocks.map((b) => b.type)).toEqual(['containerStart', 'paragraph', 'containerEnd', 'paragraph']);
    expect(blocks[1]!.text).toBe('A. :::: B.');
    expect(blocks[3]!.text).toBe('After.');
  });

  it('reports a page left open and closes it at the end of the text', () => {
    const md = 'Before.\n\n::::page{template="t"}\nA.\n:::::\n';
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'unclosedContainer', containerName: 'composedPage' });
    expect(md.slice(issues[0]!.sourceStart, issues[0]!.sourceEnd)).toBe('::::page{template="t"}');
    const page = composedPages(blocks)[0]!;
    expect(page.unclosed).toBe(true);
    expect(page.sourceEnd).toBe(md.length);
  });

  it('recovers when a page opens before the last one closed', () => {
    const md = '::::page{template="a"}\n:::frame{slot="x"}\nA.\n::::page{template="b"}\nB.\n::::\n';
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues.map((i) => i.kind === 'unclosedContainer' && i.containerName)).toEqual(['frame', 'composedPage']);
    const pages = composedPages(blocks);
    expect(pages.map((p) => p.template)).toEqual(['a', 'b']);
    expect(pages.map((p) => p.fenceIndex)).toEqual([0, 1]);
    expect(pages[0]!.unclosed).toBe(true);
    expect(pages[1]!.unclosed).toBe(false);
    expect(blocks[pages[0]!.slots.x![0]!]!.text).toBe('A.');
  });

  it('closes a frame left open at the page fence', () => {
    const md = '::::page{template="t"}\n:::frame{slot="x"}\nA.\n::::\nAfter.';
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'unclosedContainer', containerName: 'frame' });
    expect(blocks.map((b) => b.containerName ?? b.type)).toEqual(['composedPage', 'frame', 'paragraph', 'frame', 'composedPage', 'paragraph']);
  });

  it('reads spread, id and the page’s own attributes', () => {
    const md = '::::page{template="doble" spread #p8 fondo=azul}\nA.\n::::\n';
    const { blocks } = parseMarkdownWithIssues(md);
    const page = composedPages(blocks)[0]!;
    expect(page.spread).toBe(true);
    expect(page.attrs).toEqual({ template: 'doble', spread: '', id: 'p8', fondo: 'azul' });
    expect(slice(md, page.attrSources.fondo!)).toBe('azul');
    expect(slice(md, page.attrSources.id!)).toBe('p8');
    expect(slice(md, page.attrSources.spread!)).toBe('spread');
    // `{#p8}` is an anchor on the page's first text, as for any container.
    expect(blocks[1]!.anchorMarks?.[0]?.anchorId).toBe('p8');
  });

  it('a page fence glued under a paragraph line ends the paragraph', () => {
    const md = 'Text\n::::page{template="t"}\nA.\n::::\nB.';
    const { blocks } = parseMarkdownWithIssues(md);
    expect(blocks.map((b) => b.containerName ?? b.text)).toEqual(['Text', 'composedPage', 'A.', 'composedPage', 'B.']);
  });

  it('leaves a three-colon :::page a comic page, template or not', () => {
    const md = ':::page{template="t" split="50%|*"}\n::panel\nNARRADOR: Hola.\n:::\n';
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('directive');
    expect(blocks[0]!.directiveName).toBe('page');
    expect(blocks[0]!.comic?.panels).toHaveLength(1);
    expect(composedPages(blocks)).toEqual([]);
  });

  it('numbers fences in order', () => {
    const md = '::::page{template="a"}\n::::\n\n::::page{template="b"}\n::::\n';
    const pages = composedPages(parseMarkdownWithIssues(md).blocks);
    expect(pages.map((p) => [p.template, p.fenceIndex])).toEqual([['a', 0], ['b', 1]]);
  });
});

describe('slot attribute on blocks (#854)', () => {
  it('reads slot on headings, resources, code fences and containers', () => {
    const md = [
      '::::page{template="t"}',
      '## Retos {slot="retos-titulo"}',
      '',
      '::resource{slot="foto" id="mapa"}',
      '',
      '```js {slot="codigo"}',
      'let x = 1;',
      '```',
      '',
      ':::callout{type="nota" slot=aside}',
      'Box.',
      ':::',
      '',
      '# Bare {slot=titulo}',
      '::::',
    ].join('\n');
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toEqual([]);
    const heading = blocks.find((b) => b.type === 'heading')!;
    expect(heading.text).toBe('Retos');
    expect(heading.slot?.name).toBe('retos-titulo');
    expect(slice(md, heading.slot!)).toBe('retos-titulo');
    const res = blocks.find((b) => b.type === 'resourceBlock')!;
    expect(res.resourceId).toBe('mapa');
    expect(slice(md, res.slot!)).toBe('foto');
    const code = blocks.find((b) => b.type === 'code')!;
    expect(code.code?.lang).toBe('js');
    expect(code.text).toBe('let x = 1;');
    expect(slice(md, code.slot!)).toBe('codigo');
    const box = blocks.find((b) => b.containerName === 'callout')!;
    expect(slice(md, box.slot!)).toBe('aside');
    const bare = blocks.filter((b) => b.type === 'heading')[1]!;
    expect(slice(md, bare.slot!)).toBe('titulo');
    const page = composedPages(blocks)[0]!;
    expect(Object.keys(page.slots)).toEqual(['retos-titulo', 'foto', 'codigo', 'aside', 'titulo']);
    // The whole box goes to its slot, markers included.
    expect(page.slots.aside!.map((i) => blocks[i]!.type)).toEqual(['containerStart', 'paragraph', 'containerEnd']);
    expect(page.unassigned).toEqual([]);
    expect(page.firstHeadings).toEqual({});
  });

  it('concatenates pieces of the same slot in Markdown order', () => {
    const md = '::::page{template="t"}\n:::frame{slot="a"}\nOne.\n:::\nFlow.\n:::frame{slot="a"}\nTwo.\n:::\n::::';
    const { blocks } = parseMarkdownWithIssues(md);
    const page = composedPages(blocks)[0]!;
    expect(page.slots.a!.map((i) => blocks[i]!.text)).toEqual(['One.', 'Two.']);
    expect(page.unassigned.map((i) => blocks[i]!.text)).toEqual(['Flow.']);
  });

  it('keeps ::resource with any other attribute text, as before', () => {
    const md = '::resource{id="a" slot="b" width=3}';
    const { blocks } = parseMarkdownWithIssues(md);
    expect(blocks[0]!.type).toBe('paragraph');
  });

  it('a slot outside a composed page is read and changes nothing', () => {
    const md = '## Title {slot="x"}\n\n::resource{id="a" slot="b"}';
    const { blocks } = parseMarkdownWithIssues(md);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'resourceBlock']);
    expect(blocks[0]!.text).toBe('Title');
    expect(composedPages(blocks)).toEqual([]);
  });
});

describe(':::figure and ::label (#854)', () => {
  const FIG = [
    ':::figure{resource="mapa-europa" slot="mapa"}',
    '::label[OCÉANO ATLÁNTICO]{at="atlantico" style="mar"}',
    '',
    '::label[**Madrid** :chip[capital]{style="c"}]{at="madrid"}',
    '::label[Mar Negro]{at="62% 48%"}',
    ':::',
    'After.',
  ].join('\n');

  it('reads one resource block with its labels', () => {
    const { blocks, issues } = parseMarkdownWithIssues(FIG);
    expect(issues).toEqual([]);
    expect(types(blocks)).toEqual(['resourceBlock', 'paragraph']);
    const fig = blocks[0]!;
    expect(fig.resourceId).toBe('mapa-europa');
    expect(slice(FIG, fig.slot!)).toBe('mapa');
    expect(fig.figure!.attrs).toEqual({ resource: 'mapa-europa', slot: 'mapa' });
    expect(slice(FIG, fig.figure!.attrSources.resource!)).toBe('mapa-europa');
    expect(fig.sourceStart).toBe(0);
    expect(fig.sourceEnd).toBe(FIG.indexOf('\nAfter.'));
    const [ocean, madrid, sea] = fig.figure!.labels;
    expect(ocean).toMatchObject({ text: 'OCÉANO ATLÁNTICO', at: { anchor: 'atlantico' }, style: 'mar' });
    expect(slice(FIG, ocean!)).toBe('::label[OCÉANO ATLÁNTICO]{at="atlantico" style="mar"}');
    expect(FIG.slice(ocean!.textStart, ocean!.textEnd)).toBe('OCÉANO ATLÁNTICO');
    expect(slice(FIG, ocean!.attrSources.style!)).toBe('mar');
    // Inline Markdown: bold and a chip, every character mapped back.
    expect(madrid!.spans.some((s) => s.bold && s.text === 'Madrid')).toBe(true);
    expect(madrid!.spans.some((s) => s.chip?.style === 'c')).toBe(true);
    expect(madrid!.sourceMap).toHaveLength(madrid!.text.length);
    expect(FIG[madrid!.sourceMap[0]!]).toBe('M');
    expect(sea!.at).toEqual({ x: 0.62, y: 0.48 });
    expect(sea!.style).toBeUndefined();
  });

  it('works inside a frame of a composed page', () => {
    const md = `::::page{template="t"}\n:::frame{slot="mapa"}\n${FIG.replace(' slot="mapa"', '')}\n:::\n::::`;
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toEqual([]);
    const page = composedPages(blocks)[0]!;
    expect(page.slots.mapa!.map((i) => blocks[i]!.type)).toEqual(['resourceBlock', 'paragraph']);
  });

  it('ends a figure left open at its first line that is not a label', () => {
    const md = ':::figure{resource="m"}\n::label[A]{at="a"}\n\nText.';
    const { blocks, issues } = parseMarkdownWithIssues(md);
    expect(issues).toEqual([expect.objectContaining({ kind: 'unclosedContainer', containerName: 'figure' })]);
    expect(types(blocks)).toEqual(['resourceBlock', 'paragraph']);
    expect(blocks[0]!.figure!.labels).toHaveLength(1);
    expect(blocks[0]!.sourceEnd).toBe(md.indexOf('\n\nText'));
  });

  it('keeps label offsets absolute after index marks are taken out', () => {
    const md = `Intro :index[mapa].\n\n${FIG}`;
    const { blocks } = parseMarkdownWithIssues(md);
    const fig = blocks.find((b) => b.figure)!;
    const label = fig.figure!.labels[2]!;
    expect(md.slice(label.textStart, label.textEnd)).toBe('Mar Negro');
    expect(md[label.sourceMap[4]!]).toBe('N');
    expect(slice(md, label.attrSources.at!)).toBe('62% 48%');
  });

  it('a stray ::label outside a figure stays text', () => {
    const { blocks } = parseMarkdownWithIssues('::label[A]{at="a"}');
    expect(blocks[0]!.type).toBe('paragraph');
  });
});
