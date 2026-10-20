import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { baseConfig, layOut, pt } from './__tests__/vdt';
import { buildReflowablePublication } from '.';

// #1059: a box style's corners of their own and border per side reflow as
// CSS; a joined tab reflows as a plain tab.

const hex = (h: string) => ({ hex: h, model: 'hex' as const });

async function css(config: PostextConfig): Promise<string> {
  const pub = await buildReflowablePublication([layOut(':::callout{type="card" label="Words"}\nInside.\n:::', config)], {
    layout: 'reflowable',
    metadata: { title: 'Sample book', language: 'en-US', modified: new Date(Date.UTC(2026, 9, 20)) },
    resourceBytes: () => undefined,
  });
  return pub.items.filter((i) => i.mediaType === 'text/css').map((i) => String(i.data)).join('\n');
}
const rule = (sheet: string) => /aside\.pt-callout-card \{[^}]*\}/.exec(sheet)?.[0] ?? '';

describe('box shapes in the reflowable EPUB (#1059)', () => {
  it('writes a radius per corner and a border on the top only', async () => {
    const sheet = await css({
      ...baseConfig,
      calloutStyles: [{
        id: 'card',
        borderRadius: { topLeft: pt(6), bottomRight: pt(6) },
        border: { enabled: false, color: hex('#aa0000'), width: pt(1.5), sides: { top: { enabled: true } } },
        label: { joined: true },
      }],
    });
    const r = rule(sheet);
    expect(r).toMatch(/border-radius: [\d.]+em 0 [\d.]+em 0/);
    expect(r).toMatch(/border-top: 2px solid #aa0000/);
    expect(r).toContain('border-left: none');
    expect(r).not.toMatch(/border: /);
  });

  it('keeps one radius and one border as before', async () => {
    const r = rule(await css({ ...baseConfig, calloutStyles: [{ id: 'card', borderRadius: pt(6), border: { enabled: true, color: hex('#000000'), width: pt(1.5) } }] }));
    expect(r).toMatch(/border: 2px solid #000000/);
    expect(r).toMatch(/border-radius: [\d.]+em;/);
  });
});
