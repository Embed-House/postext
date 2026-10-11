import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostextConfig } from 'postext';
import { configKeyOf } from '../book/layoutKeys';
import { hashConfig } from '../presets/hash';
import { snapshotForApply } from '../presets/apply';
import type { LoadedPreset } from '../presets/types';
import { loadConfig, saveConfig } from './persistence';
import { getPresetDraft, presetDraftKey, putPresetDraft, type PresetDraftRecord } from './presetDrafts';
import { getProject, putProject, updateProject, type ProjectRecord } from './projects';
import { PROJECT_RECORD_VERSION } from './projectMigration';

// #694: the Sandbox stores every configuration stripped of defaults. The
// strip dropped the empty `header` or `footer` of a heading style, so a
// cover that silences the folio had the document's folio on it after the
// first save and reload, and so did a book opened from a bundle.

// The object stores, in memory: what `put` wrote is what `get` reads.
const rows = vi.hoisted(() => new Map<string, Map<string, unknown>>());
vi.mock('./blobStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./blobStore')>();
  const request = <T,>(result: T) => {
    const req = { result, error: null, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const storeOf = (name: string) => {
    if (!rows.has(name)) rows.set(name, new Map());
    const table = rows.get(name)!;
    return {
      put: (value: { id?: string; key?: string }) => {
        const key = (value.id ?? value.key)!;
        table.set(key, JSON.parse(JSON.stringify(value)));
        return request(key);
      },
      get: (key: string) => request(table.get(key)),
    } as unknown as IDBObjectStore;
  };
  return {
    ...actual,
    hasIndexedDB: () => true,
    withTransaction: <T,>(name: string, _mode: IDBTransactionMode, op: (store: IDBObjectStore) => Promise<T>) => op(storeOf(name)),
    runInStore: <T,>(name: string, _mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>) =>
      new Promise<T>((resolve) => {
        const out = op(storeOf(name));
        out.onsuccess = () => resolve(out.result);
      }),
  };
});

function installStorage() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
  (globalThis as { window?: unknown }).window = { localStorage };
  return map;
}

beforeEach(() => rows.clear());
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const pt = (value: number) => ({ value, unit: 'pt' as const });
const folio = { kind: 'text', id: 'folio', content: '{pageNumber}', fontSize: pt(8), placement: { anchor: { to: 'container', edge: 'top' } } };
/** A book with a folio on every page but its cover's. */
const book = (cover: Record<string, unknown> = { footer: { elements: [] }, header: { elements: [] } }): PostextConfig => ({
  footer: { elements: [folio] },
  headingStyles: [{ id: 'cover', numbered: false, ...cover }],
} as PostextConfig);
/** The cover style as stored: a slot it sets is the one its pages take. */
const coverOf = (config: PostextConfig) => config.headingStyles![0]!;
const chapters = [{ id: 'c1', title: 'One', markdown: '# Cover {style="cover"}\n\nText.', createdAt: 0, updatedAt: 0 }];

describe('a cover that silences the folio survives a save and a reload (#694)', () => {
  it('in the working configuration', () => {
    const map = installStorage();
    saveConfig(book());
    expect(JSON.parse(map.get('postext-sandbox-config')!).headingStyles[0].footer).toEqual({ elements: [] });
    const reloaded = loadConfig()!;
    expect(reloaded).toEqual(book());
    expect(coverOf(reloaded).footer).toEqual({ elements: [] });
    expect(coverOf(reloaded).header).toEqual({ elements: [] });
  });

  it('in a project record', async () => {
    const record: ProjectRecord = {
      version: PROJECT_RECORD_VERSION, id: 'p1', name: 'Book', createdAt: 1, updatedAt: 1,
      chapters, activeChapterId: 'c1', config: book(), resources: [],
    };
    await putProject(record);
    expect(coverOf((await getProject('p1'))!.config).footer).toEqual({ elements: [] });
    // The autosave writes the working configuration over it.
    await updateProject('p1', { config: { ...book(), bodyText: { fontFamily: 'Literata' } } });
    const reloaded = (await getProject('p1'))!;
    expect(reloaded.config.headingStyles).toEqual(book().headingStyles);
    expect(coverOf(reloaded.config).footer).toEqual({ elements: [] });
  });

  it('in the draft of a book opened from a preset', async () => {
    const loaded: LoadedPreset = {
      summary: { id: 'book', name: 'Book', source: 'public', available: true },
      locale: 'en', chapters, config: book(), resources: [], blobs: [], fonts: [],
    };
    const snapshot = snapshotForApply(loaded, { parts: 'all', fingerprint: 'fp', current: { chapters: [], config: {}, resources: [] } });
    const key = presetDraftKey('book', 'en');
    const draft: PresetDraftRecord = {
      version: PROJECT_RECORD_VERSION, key, presetId: 'book', locale: 'en', snapshot,
      chapters, activeChapterId: 'c1', config: book(), baseConfig: book(), resources: [], updatedAt: 1,
    };
    await putPresetDraft(draft);
    const reloaded = (await getPresetDraft(key))!;
    expect(coverOf(reloaded.config).footer).toEqual({ elements: [] });
    expect(coverOf(reloaded.baseConfig!).footer).toEqual({ elements: [] });
  });

  it('keeps an empty list of box styles and empty section fields of a style', () => {
    installStorage();
    const config: PostextConfig = { ...book({ layout: {}, margins: {}, bodyStyle: {} }), calloutStyles: [], chipStyles: [] };
    saveConfig(config);
    const reloaded = loadConfig()!;
    expect(reloaded).toEqual(config);
    expect(reloaded.calloutStyles).toEqual([]);
  });
});

// The worker's document cache, the stored page counts and the "edited
// since the preset" test are keyed by the stripped configuration: keys
// blind to the empty slot hand back the pages laid out with the folio.
describe('the keys of the stripped configuration see the empty slot (#694)', () => {
  it('tells a silenced cover from one that takes the document\'s folio', () => {
    expect(configKeyOf(book())).not.toBe(configKeyOf(book({})));
    expect(hashConfig(book())).not.toBe(hashConfig(book({})));
    expect(configKeyOf(book({ footer: { elements: [] } }))).not.toBe(configKeyOf(book()));
  });
});
