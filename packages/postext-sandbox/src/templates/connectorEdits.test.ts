// #1063: a connector of a page template's decoration is drawn by picking
// frames, on the page or in the editor's lists; these are the edits both
// make.

import { describe, expect, it } from 'vitest';
import type { DesignConnectorElement, PageTemplate } from 'postext';
import {
  connectorTargets,
  connectorToEnds,
  decorationElement,
  newConnector,
  pickConnectorFrame,
  setConnectorFrom,
  templateFrameInputs,
  toggleConnectorTo,
  updateConnectorEnd,
  updateDecorationElement,
} from './connectorEdits';

const line = (extra: Partial<DesignConnectorElement> = {}): DesignConnectorElement => ({ kind: 'connector', id: 'c', from: { to: '#root' }, to: [], ...extra });

describe('picking a connector\'s frames', () => {
  it('the first click sets the start, the next ones add ends, a second click on an end takes it out', () => {
    let el = line();
    let phase: 'from' | 'to' = 'from';
    for (const name of ['animals', 'plants', 'fungi', 'plants']) {
      const out = pickConnectorFrame(el, phase, name);
      el = out.element;
      phase = out.phase;
    }
    expect(el.from).toEqual({ to: '#animals' });
    expect(connectorToEnds(el).map((e) => e.to)).toEqual(['#fungi']);
    expect(el.to).toEqual({ to: '#fungi' });
    expect(phase).toBe('to');
  });

  it('a Shift-click adds an end even while the start is being picked; the start itself is never an end', () => {
    const shifted = pickConnectorFrame(line(), 'from', 'leaf', true);
    expect(shifted.phase).toBe('from');
    expect(shifted.element.from.to).toBe('#root');
    expect(shifted.element.to).toEqual({ to: '#leaf' });
    const self = pickConnectorFrame(line(), 'to', 'root');
    expect(self.element).toEqual(line());
  });

  it('picking the start again starts the ends afresh, and a start is never one of its own ends', () => {
    const drawn = line({ to: [{ to: '#a' }, { to: '#b' }] });
    expect(pickConnectorFrame(drawn, 'from', 'c').element.to).toEqual([]);
    expect(setConnectorFrom(drawn, 'a').to).toEqual({ to: '#b' });
  });

  it('moving the start keeps its side, point and gap', () => {
    const el = line({ from: { to: '#a', side: 'bottom', at: 0.25, gap: { value: 1, unit: 'mm' } } });
    expect(setConnectorFrom(el, 'b').from).toEqual({ to: '#b', side: 'bottom', at: 0.25, gap: { value: 1, unit: 'mm' } });
  });

  it('writes one end as an object and several as a list, and edits each end by its place', () => {
    let el = toggleConnectorTo(line(), 'a');
    expect(el.to).toEqual({ to: '#a' });
    el = toggleConnectorTo(el, '#b');
    expect(el.to).toEqual([{ to: '#a' }, { to: '#b' }]);
    el = updateConnectorEnd(el, 1, { side: 'top', at: 'start' });
    expect(el.to).toEqual([{ to: '#a' }, { to: '#b', side: 'top', at: 'start' }]);
    el = updateConnectorEnd(el, 1, { at: undefined });
    expect(el.to).toEqual([{ to: '#a' }, { to: '#b', side: 'top' }]);
    expect(updateConnectorEnd(el, 'from', { gap: { value: 2, unit: 'pt' } }).from).toEqual({ to: '#root', gap: { value: 2, unit: 'pt' } });
  });

  it('a new connector joins the first two frames', () => {
    expect(newConnector('connector1', ['title', 'body', 'note'])).toEqual({ kind: 'connector', id: 'connector1', from: { to: '#title' }, to: { to: '#body' }, routing: 'elbow' });
    expect(newConnector('connector1', ['only']).to).toEqual([]);
  });
});

describe('what an end can name', () => {
  it('frames (a repeated one\'s instances too), groups and the other placed elements', () => {
    const targets = connectorTargets(
      templateFrameInputs({
        frames: [{ name: 'title' }, { name: 'card' }] as never,
        groups: [{ name: 'grid', kind: 'grid', frames: ['card'], gap: { value: 0, unit: 'pt' }, repeat: { frames: ['card'] } }] as never,
      }),
      [{ id: 'band', kind: 'box' }, { id: 'c', kind: 'connector' }],
    );
    expect(targets.map((t) => `${t.kind}:${t.value}`)).toEqual(['frame:#title', 'frame:#card', 'instances:#card[*]', 'group:#grid', 'element:#band']);
  });
});

describe('the decoration element written back', () => {
  const templates: PageTemplate[] = [{
    id: 'tree',
    frames: [{ name: 'root' }, { name: 'leaf' }],
    decoration: { elements: [line({ id: 'c' }), { id: 'gone', remove: true } as never] },
    variants: { verso: { decoration: { elements: [line({ id: 'v' })] } } },
  }];

  it('changes the element of the scope and keeps the elements the scope hides', () => {
    const out = updateDecorationElement(templates, 'tree', 'base', 'c', (el) => toggleConnectorTo(el as DesignConnectorElement, 'leaf'));
    expect(out[0]!.decoration!.elements).toEqual([line({ id: 'c', to: { to: '#leaf' } }), { id: 'gone', remove: true }]);
    expect(decorationElement(out, 'tree', 'verso', 'v')).toEqual(line({ id: 'v' }));
    // An element the scope does not hold is left alone.
    expect(updateDecorationElement(templates, 'tree', 'verso', 'c', () => line({ id: 'x' }))).toEqual(templates);
  });
});
