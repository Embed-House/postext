import { describe, expect, it } from 'vitest';
import { applyTextChanges } from '../book/textChanges.js';
import { countTemplatePages, fenceAttributeName, fenceTemplateChange, pageFenceAttributes, pageFenceIds, renameSlotChanges, renameTemplateChanges, templateFences } from './templateUsage.js';

const BOOK = [
  '# One',
  '',
  '::::page{template="tema-cajas" fondo="banda"}',
  '# A',
  '::::',
  '',
  '```',
  '::::page{template="tema-cajas"}',
  '```',
  '',
  ':::::page{template=mapa spread}',
  ':::::',
  '::::page',
  '::::',
].join('\n');

describe('templateFences', () => {
  it('reads every page fence outside code, quoted or not, with its value range', () => {
    const fences = templateFences(BOOK);
    expect(fences.map((f) => f.template)).toEqual(['tema-cajas', 'mapa', '']);
    const first = fences[0]!;
    expect(BOOK.slice(first.valueFrom, first.valueTo)).toBe('tema-cajas');
    expect(fences[1]!.spread).toBe(true);
    expect(BOOK.slice(fences[1]!.valueFrom, fences[1]!.valueTo)).toBe('mapa');
    expect(fences[2]!.missing).toBe(true);
  });
});

describe('countTemplatePages', () => {
  it('counts one page per fence and two for a spread', () => {
    const counts = countTemplatePages([{ markdown: BOOK }, { markdown: '::::page{template="tema-cajas"}\n::::\n' }]);
    expect(counts.get('tema-cajas')).toBe(2);
    expect(counts.get('mapa')).toBe(2);
    expect(countTemplatePages([{ markdown: '::::page{template="x"}\n::::' }], new Set(['x'])).get('x')).toBe(2);
  });
});

describe('fenceTemplateChange', () => {
  it('rewrites the value of the fence asked for, or adds the attribute', () => {
    const fence = templateFences(BOOK)[0]!;
    const out = applyTextChanges(BOOK, [fenceTemplateChange(BOOK, fence.fenceStart, 'tema-cajas-2')!]);
    expect(out).toContain('::::page{template="tema-cajas-2" fondo="banda"}');
    const bare = templateFences(BOOK)[2]!;
    expect(applyTextChanges(BOOK, [fenceTemplateChange(BOOK, bare.fenceStart, 'x')!])).toContain('::::page{template="x"}\n');
    const md = '::::page{fondo="a"}\n::::';
    expect(applyTextChanges(md, [fenceTemplateChange(md, 0, 'y')!])).toBe('::::page{fondo="a" template="y"}\n::::');
  });

  it('renames a template in every fence', () => {
    const out = applyTextChanges(BOOK, renameTemplateChanges(BOOK, 'tema-cajas', 'tema'));
    expect(out).toContain('::::page{template="tema" fondo="banda"}');
    // The code block keeps its text.
    expect(out).toContain('```\n::::page{template="tema-cajas"}\n```');
  });
});

describe('pageFenceIds (#943)', () => {
  it('lists the ids of the page fences of every chapter, once, outside code', () => {
    const one = ['::::page{template="articulo" id="p1" sigue="p47"}', '::::', '```', '::::page{id="en-codigo"}', '```', "::::page{id='p3'}", '::::'].join('\n');
    const two = ['::::page{template=salto id=p47}', '::::', '::::page{id="p1"}', '::::', '::::page{template="x"}', '::::'].join('\n');
    expect(pageFenceIds([{ markdown: one }, { markdown: two }])).toEqual([
      { id: 'p1', chapter: 0 },
      { id: 'p3', chapter: 0 },
      { id: 'p47', chapter: 1 },
    ]);
    expect(templateFences(two)[0]!.id).toBe('p47');
    expect(templateFences(two)[2]!.id).toBeUndefined();
  });
});

describe('pageFenceAttributes (#1087)', () => {
  it('lists the attributes the fences set, once, in book order, outside code', () => {
    const one = ['::::page{template="shell" frontmatter}', '::::', '```', '::::page{template="shell" hidden}', '```', '::::page{template="shell" folio fondo=banda}', '::::'].join('\n');
    const two = ['::::page{template="shell" folio draft=false id=p2 spread}', '::::'].join('\n');
    expect(pageFenceAttributes([{ markdown: one }, { markdown: two }])).toEqual(['frontmatter', 'folio', 'fondo']);
    expect(templateFences(two)[0]!.attrs).toEqual(['template', 'folio', 'id', 'spread']);
  });
});

describe('renameSlotChanges (#979)', () => {
  const md = [
    '::::page{template="tema"}',
    '',
    '# Title {slot="titulo"}',
    '',
    ':::frame{slot="caja-1" label="Tip slot=\\"caja-1\\""}',
    'The slot="caja-1" is quoted prose',
    ':::',
    '',
    '::resource{id="r1" slot=\'caja-1\'}',
    '',
    ':::figure{resource="r2" slot=caja-1}',
    ':::',
    '',
    '```',
    ':::frame{slot="caja-1"}',
    '```',
    '::::',
    '',
    '::::page{template="otra"}',
    ':::frame{slot="caja-1"}',
    ':::',
    '::::',
    '',
    ':::frame{slot="caja-1"}',
    '',
  ].join('\n');

  it('renames the slot of the pages whose template shares the frame, and only that attribute', () => {
    const out = applyTextChanges(md, renameSlotChanges(md, new Set(['tema']), 'caja-1', 'caja-azul'));
    expect(out).toContain(':::frame{slot="caja-azul" label="Tip slot=\\"caja-1\\""}');
    expect(out).toContain("::resource{id=\"r1\" slot='caja-azul'}");
    expect(out).toContain(':::figure{resource="r2" slot=caja-azul}');
    expect(out).toContain('The slot="caja-1" is quoted prose');
    expect(out).toContain('```\n:::frame{slot="caja-1"}\n```');
    // The other template's page, and a fence outside any page, are left alone.
    expect(out).toContain('::::page{template="otra"}\n:::frame{slot="caja-1"}');
    expect(out.endsWith(':::frame{slot="caja-1"}\n')).toBe(true);
    expect(out).toContain('# Title {slot="titulo"}');
  });

  it('names nothing when no page uses the templates', () => {
    expect(renameSlotChanges(md, new Set(['nope']), 'caja-1', 'x')).toEqual([]);
  });
});

// #1095: «Drawn when / Not drawn when the page says» takes an attribute no
// fence writes yet, typed, when it is a name a fence can write.
describe('fenceAttributeName', () => {
  it('takes a key the attribute grammar reads', () => {
    expect(fenceAttributeName('  frontmatter ')).toEqual({ ok: true, name: 'frontmatter' });
    expect(fenceAttributeName('sin_folio-2')).toEqual({ ok: true, name: 'sin_folio-2' });
    expect(fenceAttributeName('_x')).toEqual({ ok: true, name: '_x' });
  });
  it('refuses what a fence cannot write, and the page\'s own keys', () => {
    expect(fenceAttributeName('')).toEqual({ ok: false, reason: 'empty' });
    expect(fenceAttributeName('2col')).toEqual({ ok: false, reason: 'syntax' });
    expect(fenceAttributeName('sin folio')).toEqual({ ok: false, reason: 'syntax' });
    expect(fenceAttributeName('portada=1')).toEqual({ ok: false, reason: 'syntax' });
    expect(fenceAttributeName('作者')).toEqual({ ok: false, reason: 'syntax' });
    expect(fenceAttributeName('x'.repeat(65))).toEqual({ ok: false, reason: 'syntax' });
    expect(fenceAttributeName('template')).toEqual({ ok: false, reason: 'reserved' });
    expect(fenceAttributeName('spread')).toEqual({ ok: false, reason: 'reserved' });
  });
});
