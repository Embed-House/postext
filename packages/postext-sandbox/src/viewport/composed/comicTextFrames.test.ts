/**
 * The text panels of a comic page (#885) in the page viewers: their frames
 * found under the pointer and the caret a click off their words puts.
 */
import { describe, expect, it } from 'vitest';
import { buildDocument, comicBlockOnSheet, flowToPage } from 'postext';
import type { VDTPage } from 'postext';
import { comicTextFrameAt, comicTextHitAt, frameHitAt, pointInComicFrame, sheetToFlow } from './frameHit';
import { comicTextCaret } from './frameLink';

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

  it('puts the caret at the text', () => {
    const page = comicPage();
    const frame = page.comic!.frames![0]!;
    const at = comicTextCaret(page, frame)!;
    expect(markdown.slice(at)).toMatch(/^The narrator speaks here\./);
  });

  it('on a right-to-left page: the frame on the sheet, its words in the mirrored flow (#909)', () => {
    const md = markdown.replace('40~50 / *', '50 / *');
    const doc = buildDocument({ markdown: md, resources: [] }, { direction: 'rtl', locale: 'ar' } as never);
    const page = doc.pages.find((p) => p.comic)!;
    const frame = page.comic!.frames![0]!;
    const para = page.floats!.filter((b) => b.type === 'paragraph')[1]!;
    // A point of the paragraph as the sheet shows it.
    const sheet = flowToPage(page, para.bbox.x + 2, para.bbox.y + 2);
    expect(comicTextFrameAt(page, sheet.x, sheet.y)?.id).toBe('cm0:p1');
    const inFlow = sheetToFlow(page, sheet.x, sheet.y);
    expect(comicTextHitAt(page, sheet.x, sheet.y)?.frame.id).toBe(frame.id);
    expect(md.slice(comicTextCaret(page, frame)!)).toMatch(/^The narrator speaks here\./);
    expect(inFlow.x).toBeCloseTo(para.bbox.x + 2, 3);
  });

  it('finds the text frame of a strip, with the strip\'s comic, and its caret (#959)', () => {
    const md = 'Before.\n\n:::strip{split="* | *" aspect=2.5}\n::panel{text}\nThe narrator speaks here.\n\nA second paragraph.\n::panel\nana: Hello!\n:::\n';
    const doc = buildDocument({ markdown: md, resources: [] }, {});
    const page = doc.pages.find((p) => p.columns.some((c) => c.blocks.some((b) => b.comic)))!;
    const strip = page.columns.flatMap((c) => c.blocks).find((b) => b.comic)!;
    const frame = strip.comic!.frames![0]!;
    const para = page.floats!.filter((b) => frame.blockIds.includes(b.id) && b.type === 'paragraph')[1]!;
    const hit = comicTextHitAt(page, para.bbox.x + 2, para.bbox.y + 2)!;
    expect(hit.frame.id).toBe('cm0:p1');
    expect(hit.comic).toBe(comicBlockOnSheet(page, strip));
    expect(comicTextFrameAt(page, para.bbox.x + 2, para.bbox.y + 2)?.id).toBe('cm0:p1');
    // The picture panel holds no text.
    const second = hit.comic.panels[1]!.bbox;
    expect(comicTextHitAt(page, second.x + second.width / 2, second.y + second.height / 2)).toBeNull();
    const at = comicTextCaret(page, hit.frame)!;
    expect(md.slice(at)).toMatch(/^The narrator speaks here\./);
  });
});
