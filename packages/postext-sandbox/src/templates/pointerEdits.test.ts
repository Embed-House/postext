import { describe, expect, it } from 'vitest';
import type { PageTemplate } from 'postext';
import { pointersOf, removePointer, setPointer } from './pointerEdits.js';

// #1064: pointers from a frame to an anchor of another frame's picture, as
// connectors of the template's decoration.

const base: PageTemplate = {
  id: 'base',
  frames: [{ name: 'map', layer: -2 }, { name: 'note' }, { name: 'other' }],
  decoration: { elements: [{ kind: 'connector', id: 'p1', from: { to: '#note', side: 'end' }, to: { to: '#map', anchor: 'harbour', gap: { value: 1, unit: 'mm' } }, width: { value: 1, unit: 'pt' } }] },
};
const child: PageTemplate = { id: 'child', extends: 'base' };

describe('pointers (#1064)', () => {
  it('lists the pointers of a template, its inherited ones marked', () => {
    expect(pointersOf([base, child], 'base').map((p) => [p.id, p.from, p.toFrame, p.anchor, p.inherited])).toEqual([['p1', 'note', 'map', 'harbour', false]]);
    expect(pointersOf([base, child], 'child')[0]!.inherited).toBe(true);
    expect(pointersOf([base], 'base', 'other')).toEqual([]);
  });

  it('changes a pointer\'s target by id and keeps its look', () => {
    const out = setPointer([base], 'base', { id: 'p1', from: 'note', toFrame: 'map', anchor: 'mill' })!;
    const el = out.templates[0]!.decoration!.elements[0] as Extract<NonNullable<PageTemplate['decoration']>['elements'][number], { kind: 'connector' }>;
    expect(el.to).toEqual({ to: '#map', anchor: 'mill', gap: { value: 1, unit: 'mm' } });
    expect(el.from).toEqual({ to: '#note', side: 'end' });
    expect(el.width).toEqual({ value: 1, unit: 'pt' });
    // A frame with its own layer keeps it.
    expect(out.templates[0]!.frames!.find((f) => f.name === 'map')!.layer).toBe(-2);
  });

  it('writes the change of an inherited pointer on the child, under its id', () => {
    const out = setPointer([base, child], 'child', { id: 'p1', from: 'note', toFrame: 'map', anchor: 'mill' })!;
    expect(out.templates[0]).toBe(base);
    expect(pointersOf(out.templates, 'child')[0]).toMatchObject({ id: 'p1', anchor: 'mill', inherited: false });
  });

  it('adds a new pointer with a free id, and refuses a frame pointing at itself', () => {
    const out = setPointer([base], 'base', { from: 'other', toFrame: 'map', anchor: 'harbour' })!;
    expect(out.id).toBe('pointer-other-harbour');
    expect(pointersOf(out.templates, 'base')).toHaveLength(2);
    expect(setPointer([base], 'base', { from: 'map', toFrame: 'map', anchor: 'x' })).toBeNull();
    expect(setPointer([base], 'base', { id: 'nope', from: 'note', toFrame: 'map', anchor: 'x' })).toBeNull();
  });

  it('removes an own pointer, and hides an inherited one', () => {
    expect(pointersOf(removePointer([base], 'base', 'p1')!, 'base')).toEqual([]);
    const hidden = removePointer([base, child], 'child', 'p1')!;
    expect(hidden[1]!.decoration).toEqual({ elements: [{ id: 'p1', remove: true }] });
    expect(removePointer([base], 'base', 'nope')).toBeNull();
  });
});
