import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../parse/index.js';
import { CHIP_PLACEHOLDER } from '../../parse/inlineFormatting.js';

describe('exercise fences (#1225)', () => {
  it('reads [[…]] inside an exercise only', () => {
    const md = 'Out [[here]].\n\n:::exercise\nThe roots take in [[water | Water]] and [[go | (goes)]].\n\n::bank[sun | rain]\n\n:::solution\nSee [[x]].\n:::\n:::\n';
    const blocks = parseMarkdown(md);
    const types = blocks.map((b) => b.type + (b.containerName ? ':' + b.containerName : '') + (b.directiveName ? ':' + b.directiveName : ''));
    expect(types).toEqual(['paragraph', 'containerStart:exercise', 'paragraph', 'directive:bank', 'containerStart:solution', 'paragraph', 'containerEnd:solution', 'containerEnd:exercise']);
    expect(blocks[0]!.text).toBe('Out [[here]].');
    const p = blocks[2]!;
    expect(p.text).toBe(`The roots take in ${CHIP_PLACEHOLDER} and ${CHIP_PLACEHOLDER}.`);
    const gaps = p.spans.filter((s) => s.chip?.gap).map((s) => s.chip!.gap!);
    expect(gaps[0]).toMatchObject({ texts: ['water', 'Water'], correct: [0, 1], choice: false });
    expect(gaps[1]).toMatchObject({ texts: ['go', 'goes'], correct: [1], choice: true });
    // The gap maps to its `[[`, the text after it to its own place.
    const at = p.text.indexOf(CHIP_PLACEHOLDER);
    expect(md.slice(p.sourceMap[at]!, p.sourceMap[at]! + 2)).toBe('[[');
    expect(p.sourceMap[at + 1]).toBe(md.indexOf(' and [[go'));
    expect(blocks[3]!.text).toBe('sun | rain');
    expect(blocks[5]!.text).toBe('See [[x]].');
  });

  it('keeps an escaped [[ and a gap attribute', () => {
    const md = ':::exercise\nA \\[[b]] and [[went]]{width=6}.\n:::\n';
    const p = parseMarkdown(md)[1]!;
    const gap = p.spans.find((s) => s.chip?.gap)!.chip!.gap!;
    expect(gap.attrs).toEqual({ width: '6' });
    expect(p.text.endsWith(`and ${CHIP_PLACEHOLDER}.`)).toBe(true);
  });

  it('reads task items, pairs and ordered items as ordinary blocks', () => {
    const md = ':::exercise{type=choice}\nPick.\n\n- [ ] Madrid\n- [x] Lisbon\n:::\n';
    const blocks = parseMarkdown(md);
    expect(blocks[0]!.containerAttrs).toEqual({ type: 'choice' });
    expect(blocks.filter((b) => b.type === 'listItem').map((b) => b.checked)).toEqual([false, true]);
  });
});
