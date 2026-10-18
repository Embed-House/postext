// A box style card carries a Design group (#1014): the heading design
// editor laid out in a band under the box title, with its minimum height
// and whether the design sets the box's content.

import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CalloutStyleConfig } from 'postext';
import { SandboxStoreContext } from '../../context/SandboxContext';
import { DEFAULT_LABELS } from '../../types/defaultLabels';
import { CalloutStylesSection } from './CalloutStylesSection';

function render(calloutStyles: CalloutStyleConfig[]): string {
  const state = { config: { calloutStyles }, resources: [], labels: DEFAULT_LABELS, locale: 'en', chapters: [], activeChapterId: null };
  const store = { getSnapshot: () => state, subscribe: () => () => {}, dispatch: () => {} };
  return renderToString(h(SandboxStoreContext, { value: store as never }, h(CalloutStylesSection)));
}

/** The markup of the switch row whose label is `label`. */
function switchRow(html: string, label: string): string {
  const at = html.indexOf(label);
  expect(at).toBeGreaterThan(-1);
  const row = html.slice(at, at + 6000);
  return row.slice(0, row.indexOf('role="switch"') + 200);
}

const practice: CalloutStyleConfig = {
  id: 'practice',
  design: {
    setsContent: true,
    slot: { elements: [{ kind: 'text', id: 'text1', content: '{boxText}', fontSize: { value: 12, unit: 'pt' }, placement: { anchor: { to: 'container', edge: 'top' } } }] },
  },
};

describe('CalloutStylesSection design group', () => {
  it('shows the design switched off for a style without one', () => {
    const html = render([{ id: 'note' }]);
    expect(html).toContain(DEFAULT_LABELS.calloutStyleDesignGroup);
    expect(switchRow(html, DEFAULT_LABELS.calloutStyleDesign)).toMatch(/aria-checked="false"/);
    expect(html).not.toContain(DEFAULT_LABELS.calloutStyleDesignSetsContent);
  });

  it('shows a style\'s design with its fields and elements', () => {
    const html = render([practice]);
    expect(switchRow(html, DEFAULT_LABELS.calloutStyleDesign)).toMatch(/aria-checked="true"/);
    expect(html).toContain(DEFAULT_LABELS.calloutStyleDesignMinHeight);
    expect(switchRow(html, DEFAULT_LABELS.calloutStyleDesignSetsContent)).toMatch(/aria-checked="true"/);
    expect(html).toContain('{boxText}');
    // A box design's elements count toward the band unless switched off.
    expect(html).toContain(DEFAULT_LABELS.headerFooterElementReserve);
  });

  it('shows a design switched off as off', () => {
    const html = render([{ ...practice, design: { ...practice.design!, enabled: false } }]);
    expect(switchRow(html, DEFAULT_LABELS.calloutStyleDesign)).toMatch(/aria-checked="false"/);
    expect(html).not.toContain(DEFAULT_LABELS.calloutStyleDesignSetsContent);
  });
});
