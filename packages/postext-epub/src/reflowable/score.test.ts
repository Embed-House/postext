import { beforeAll, describe, expect, it } from 'vitest';
import { initMusicEngine } from 'postext';
import type { Resource } from 'postext';
import { baseConfig, layOut } from './__tests__/vdt.js';
import { checkXml } from './__tests__/xml.js';
import { buildReflowablePublication } from './index.js';

const TUNE = 'X:1\nT:Ode to Joy\nM:4/4\nL:1/4\nK:D\nFFGA|AGFE|DDEF|F3/2E/2E2|FFGA|AGFE|DDEF|E3/2D/2D2|]\n';

async function xhtml(markdown: string, resources: Resource[] = []): Promise<string> {
  const doc = layOut(markdown, baseConfig, resources);
  const pub = await buildReflowablePublication([doc], {
    layout: 'reflowable',
    metadata: { title: 'Scores', language: 'en', modified: new Date(Date.UTC(2026, 9, 22)) },
  });
  const files = pub.items.filter((i) => i.mediaType === 'application/xhtml+xml').map((i) => i.data as string);
  for (const f of files) expect(checkXml(f).errors).toEqual([]);
  return files.join('\n');
}

describe('music scores in a reflowable EPUB (#1172)', () => {
  beforeAll(async () => { await initMusicEngine(); }, 60_000);

  it('reads a score fence as one image of its systems, scaled to the column', async () => {
    const out = await xhtml(`# One\n\nBefore.\n\n\`\`\`abc {alt="The tune"}\n${TUNE}\`\`\`\n\nAfter.\n`);
    expect((out.match(/class="pt-score"/g) ?? []).length).toBe(1);
    expect(out).toContain('aria-label="The tune"');
    expect((out.match(/class="pt-score-system"/g) ?? []).length).toBeGreaterThan(0);
    expect(out).toMatch(/<svg[^>]*width="100%"/);
  });

  it('draws a score resource in its figure', async () => {
    const res: Resource = { id: 'ode', typeId: 'example', kind: 'score', createdAt: 0, updatedAt: 0, caption: 'The theme.', score: { format: 'abc', source: TUNE } };
    const out = await xhtml('# One\n\n::resource{id="ode"}\n', [res]);
    expect(out).toMatch(/<figure id="res-ode"[^>]*>[\s\S]*class="pt-score"[\s\S]*<figcaption>/);
    expect(out).toContain('aria-label="Ode to Joy"');
  });
});
