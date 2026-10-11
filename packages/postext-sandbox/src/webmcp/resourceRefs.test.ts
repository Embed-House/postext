import { describe, expect, it } from 'vitest';
import type { Resource } from 'postext';
import { applyTextChanges } from '../book/textChanges';
import { configPathsNaming, renameResourceInResources, renameResourceInText, resourceIdRanges } from './resourceRefs';

const rename = (markdown: string, from: string, to: string): string => applyTextChanges(markdown, renameResourceInText(markdown, from, to));

describe('the references to a resource', () => {
  it('are the embeds, the citations and the comic panels that name it', () => {
    const markdown = [
      '# The map :ref{id="map"}',
      '',
      'See :ref{id="map"}, :ref{style=number id=\'map\'}, :ref{#map}, :ref{id=map text="the map"} and \\ref{map}.',
      '',
      '::resource{id="map"}',
      '',
      '- an item citing :ref{id="map"}[^n]',
      '',
      ':::page',
      '::panel{art=map focus="50% 40%"}',
      'ana: A map!',
      ':::',
      '',
      '[^n]: A note with :ref{id="map"}.',
      '',
    ].join('\n');
    const ranges = resourceIdRanges(markdown, 'map');
    expect(ranges).toHaveLength(10);
    expect(ranges.every((r) => markdown.slice(r.from, r.to) === 'map')).toBe(true);
    const renamed = rename(markdown, 'map', 'europe');
    expect(renamed).toContain('See :ref{id="europe"}, :ref{style=number id=\'europe\'}, :ref{#europe}, :ref{id=europe text="the map"} and \\ref{europe}.');
    expect(renamed).toContain('::resource{id="europe"}');
    expect(renamed).toContain('[^n]: A note with :ref{id="europe"}.');
    expect(renamed).toContain('# The map :ref{id="europe"}');
    expect(renamed).toContain(':ref{id=europe text="the map"}');
    expect(renamed).toContain('::panel{art=europe focus="50% 40%"}');
    expect(renamed).toContain('ana: A map!');
  });

  it('leave alone what only looks like one', () => {
    const markdown = [
      'The word map, the code `:ref{id="map"}` and another resource :ref{id="map-2"}.',
      '',
      '```',
      '::resource{id="map"}',
      ':ref{id="map"}',
      '```',
      '',
      '::resource{id="map-2"}',
      '',
    ].join('\n');
    expect(resourceIdRanges(markdown, 'map')).toEqual([]);
    expect(rename(markdown, 'map', 'europe')).toBe(markdown);
    expect(resourceIdRanges(markdown, 'map-2')).toHaveLength(2);
  });

  it('are followed into the other resources, and found in the design', () => {
    const resources: Resource[] = [
      { id: 'map', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0, caption: 'Itself' },
      { id: 'detail', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0, caption: 'A detail of :ref{id="map"}', note: 'No reference here: map' },
      {
        id: 'legend', typeId: 'table', kind: 'table', createdAt: 0, updatedAt: 0,
        table: { model: { rows: [[{ content: 'Key', image: { resourceId: 'map', width: 0.5 } }, { content: 'See :ref{id="map"}' }], [{ content: 'map' }, { content: '', image: { resourceId: 'other' } }]] } },
      },
      { id: 'plain', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0, caption: 'Nothing' },
    ];
    const renamed = renameResourceInResources(resources, 'map', 'europe');
    expect(renamed.map((r) => [r.resource.id, r.count])).toEqual([['detail', 1], ['legend', 2]]);
    expect(renamed[0]!.resource).toMatchObject({ caption: 'A detail of :ref{id="europe"}', note: 'No reference here: map' });
    const rows = renamed[1]!.resource.table!.model.rows;
    expect(rows[0]![0]).toEqual({ content: 'Key', image: { resourceId: 'europe', width: 0.5 } });
    expect(rows[0]![1]!.content).toBe('See :ref{id="europe"}');
    expect(rows[1]).toEqual(resources[2]!.table!.model.rows[1]);

    const config = {
      headerFooter: { header: { elements: [{ kind: 'image', resourceId: 'map' }, { kind: 'image', resourceId: 'logo' }] } },
      calloutStyles: [{ id: 'note', icon: { kind: 'resource', resourceId: 'map' } }],
    };
    expect(configPathsNaming(config as never, 'map')).toEqual(['headerFooter.header.elements[0].resourceId', 'calloutStyles[0].icon.resourceId']);
  });
});
