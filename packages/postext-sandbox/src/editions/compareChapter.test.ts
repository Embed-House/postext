import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument } from 'postext';
import type { LayoutService } from '../worker/LayoutService';
import type { Chapter } from '../book/types';
import { editionEntry, ensureEdition, resetEditions, subscribeEditions, type EditionEntry } from './editionStore';
import { threeEditionsBook } from './threeEditions.fixture';

// Text measured at about the width of a book face (0.42 em a character).
class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
    return { width: s.length * px * 0.42 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

const service = { build: (r: { content: Parameters<typeof buildDocument>[0]; config: Parameters<typeof buildDocument>[1] }) => buildDocument(r.content, r.config) } as unknown as LayoutService;

/** A title chapter with no composed page, then the fixture's composed one. */
function book() {
  const fixture = threeEditionsBook('es');
  const chapters: Chapter[] = [
    { id: 'title', title: 'Portada', markdown: '# El cumpleaños\n\nDibujo y guion.' } as Chapter,
    { id: 'composed', title: fixture.chapters[0]!.title, markdown: fixture.chapters[0]!.markdown } as Chapter,
  ];
  return { source: { locale: 'es', chapters, config: fixture.config, resources: fixture.resources } };
}

function settled(key: string): Promise<EditionEntry> {
  return new Promise((resolve) => {
    const check = () => {
      const e = editionEntry('preset:test', key);
      if (e && e.status !== 'loading') {
        off();
        resolve(e);
      }
    };
    const off = subscribeEditions(check);
    check();
  });
}

afterEach(() => resetEditions());

describe('the side-by-side view of a chapter with no composed page (#1007)', () => {
  it('lays the chapter out when it is asked for, and keeps it when the checks ask again', async () => {
    const identity = ['original'];
    // The checks: only the composed chapter.
    ensureEdition({ bookKey: 'preset:test', locale: 'es', identity, other: false, service, load: async () => book() });
    let entry = await settled('es');
    expect(entry.layout!.chapters.map((c) => c.doc !== null)).toEqual([false, true]);

    // The side-by-side view on the title chapter.
    ensureEdition({ bookKey: 'preset:test', locale: 'es', identity, other: false, service, load: async () => book(), chapters: [0] });
    expect(editionEntry('preset:test', 'es')!.status).toBe('loading');
    entry = await settled('es');
    expect(entry.chapters.has(0)).toBe(true);
    expect(entry.layout!.chapters[0]!.doc!.pages.length).toBeGreaterThan(0);

    // The checks again, with the same inputs: nothing is laid out again.
    ensureEdition({ bookKey: 'preset:test', locale: 'es', identity, other: false, service, load: async () => book() });
    expect(editionEntry('preset:test', 'es')).toBe(entry);
  });
});
