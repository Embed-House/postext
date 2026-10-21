import { describe, expect, it } from 'vitest';
import type { PostextConfig, VDTDocument } from 'postext';
import { baseConfig, layOut } from './__tests__/vdt.js';
import { buildReflowablePublication } from './index.js';

// #717: CSS names the two break rules the other way round. `orphans` is
// the lines a paragraph keeps at the foot of a page (the engine's
// `avoidWidows`), `widows` the lines at the head of the next (its
// `avoidOrphans`). A rule that is off is written as 1, since both
// properties start at 2.

async function bodyRule(docs: VDTDocument[]): Promise<string> {
  const pub = await buildReflowablePublication(docs, { layout: 'reflowable', metadata: { title: 'Rules', language: 'en', modified: new Date(Date.UTC(2026, 9, 11)) } });
  const css = pub.items.filter((i) => i.mediaType === 'text/css').map((i) => String(i.data)).join('\n');
  const at = css.indexOf('\nbody {');
  return css.slice(at, css.indexOf('}', at));
}
const withBody = (bodyText: PostextConfig['bodyText'], extra: Partial<PostextConfig> = {}): PostextConfig => ({
  ...baseConfig,
  ...extra,
  bodyText: { ...baseConfig.bodyText, ...bodyText },
});
const TEXT = 'One paragraph of text.';

describe('reflowable EPUB: orphans and widows (#717)', () => {
  it('writes orphans from avoidWidows and widows from avoidOrphans, 1 for a rule that is off', async () => {
    const cases: [boolean, boolean, string][] = [
      [true, true, 'orphans: 2;\n  widows: 2;'],
      [false, true, 'orphans: 1;\n  widows: 2;'],
      [true, false, 'orphans: 2;\n  widows: 1;'],
      [false, false, 'orphans: 1;\n  widows: 1;'],
    ];
    for (const [avoidWidows, avoidOrphans, css] of cases) {
      const body = await bodyRule([layOut(TEXT, withBody({ avoidWidows, avoidOrphans }))]);
      expect(body, `${avoidWidows} ${avoidOrphans}`).toContain(css);
    }
  });

  it('takes each minimum from its own rule', async () => {
    const body = await bodyRule([layOut(TEXT, withBody({ widowMinLines: 3, orphanMinLines: 4 }))]);
    expect(body).toContain('orphans: 3;\n  widows: 4;');
  });

  it('follows the defaults of a character grid', async () => {
    const grid = { cjk: { grid: { enabled: true, charsPerLine: 20, linesPerPage: 12 } } };
    const zh = await bodyRule([layOut('正文一段。', withBody({}, { locale: 'zh-Hans', ...grid }))]);
    expect(zh).toContain('orphans: 1;\n  widows: 2;');
    const ja = await bodyRule([layOut('本文一段。', withBody({}, { locale: 'ja', ...grid }))]);
    expect(ja).toContain('orphans: 1;\n  widows: 1;');
  });
});
