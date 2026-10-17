/**
 * The text panels of a comic page (#885) in the page viewers: their frames
 * found under the pointer, the caret a click off their words puts, the
 * paragraph a double click edits on the page.
 */
import { describe, expect, it } from 'vitest';
import { buildDocument } from 'postext';
import type { VDTPage } from 'postext';
import { comicTextFrameAt, frameHitAt, pointInComicFrame } from './frameHit';
import { comicTextCaret, comicTextTargetAt, frameTextChange } from './frameLink';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

const markdown = ':::page{split="40~50 / *"}\n::panel{text}\nThe narrator speaks here.\n\nA second paragraph.\n::panel\nana: Hello!\n:::\n';

function comicPage(): VDTPage {
  const doc = buildDocument({ markdown, resources: [] }, {});
  return doc.pages.find((p) => p.comic)!;
}

describe('text panels in the viewers', () => {
  it('finds a text frame under the pointer, in its slanted outline', () => {
    const page = comicPage();
    const frame = page.comic!.frames![0]!;
    expect(frame.polygon).toBeDefined();
    const para = page.floats!.find((b) => b.type === 'paragraph')!;
    expect(comicTextFrameAt(page, para.bbox.x + 2, para.bbox.y + 2)?.id).toBe('cm0:p1');
    // The picture panel below holds no text: the comic tools have it.
    const second = page.comic!.panels[1]!.bbox;
    expect(comicTextFrameAt(page, second.x + second.width / 2, second.y + second.height / 2)).toBeNull();
    // A comic page is no composed page: the template tools see no frame.
    expect(frameHitAt(page, para.bbox.x + 2, para.bbox.y + 2)).toBeNull();
    // Outside the slant, inside the box: not the frame.
    const r = frame.rect;
    const corner = { x: r.x + 1, y: r.y + r.height - 1 };
    expect(pointInComicFrame(frame, corner.x, corner.y)).toBe(false);
  });

  it('puts the caret at the text and edits a paragraph in place', () => {
    const page = comicPage();
    const frame = page.comic!.frames![0]!;
    const at = comicTextCaret(page, frame)!;
    expect(markdown.slice(at)).toMatch(/^The narrator speaks here\./);
    const para = page.floats!.filter((b) => b.type === 'paragraph')[1]!;
    const target = comicTextTargetAt(page, markdown, frame, para.bbox.x + 2, para.bbox.y + 2)!;
    expect(target.kind).toBe('block');
    expect(target.text).toBe('A second paragraph.');
    expect(frameTextChange(target, 'Another paragraph.')).toEqual({ from: target.start, to: target.end, insert: 'Another paragraph.' });
  });
});
