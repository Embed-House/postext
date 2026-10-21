import { describe, expect, it } from 'vitest';
import { AUTO_EDITION_LAYOUTS, editionsOnDemand } from './onDemand.js';
import { askEditions, editionsAsked, editionsVersion, resetEditions } from './editionStore.js';
import { bookEditionsOf } from './bookLocales.js';
import { state } from '../webmcp/tools/testHarness.js';

describe('the editions a big book lays out only when asked (#952)', () => {
  it('waits for a book that holds more chapter layouts than the limit, in several editions', () => {
    expect(AUTO_EDITION_LAYOUTS).toBe(48);
    // The three-edition sample (two chapters in three editions) is laid out unasked.
    expect(editionsOnDemand(2, 3)).toBe(false);
    expect(editionsOnDemand(24, 2)).toBe(false);
    expect(editionsOnDemand(25, 2)).toBe(true);
    expect(editionsOnDemand(56, 2)).toBe(true);
    // One edition is the book itself: nothing waits.
    expect(editionsOnDemand(300, 1)).toBe(false);
    expect(editionsOnDemand(300, 0)).toBe(false);
  });

  it('remembers the reader\'s word for a book until the session ends, and tells the panel', () => {
    resetEditions();
    const before = editionsVersion();
    expect(editionsAsked('project:a')).toBe(false);
    askEditions('project:a');
    expect(editionsAsked('project:a')).toBe(true);
    expect(editionsAsked('project:b')).toBe(false);
    expect(editionsVersion()).toBe(before + 1);
    // Asking twice changes nothing.
    askEditions('project:a');
    expect(editionsVersion()).toBe(before + 1);
    resetEditions();
    expect(editionsAsked('project:a')).toBe(false);
  });
});

describe('the editions of a book on screen', () => {
  it('names a sample by its summary and a project by its record', () => {
    const base = state();
    expect(bookEditionsOf(base)).toMatchObject({ bookKey: 'preset:guide', presetId: 'guide', projectId: null });
    const summary = { id: 'trio', name: 'Trio', source: 'public' as const, available: true, locale: 'es', locales: ['es', 'en', 'ca'] };
    const sample = bookEditionsOf({ ...base, activePresetId: 'trio', presetSummaries: [summary], presetApplied: { presetId: 'trio', locale: 'en', fingerprint: null, markdownHash: '', configHash: '', resourcesHash: '' } });
    expect(sample).toMatchObject({ locales: ['es', 'en', 'ca'], activeLocale: 'en' });
    const project = bookEditionsOf({ ...base, activeProjectId: 'p1', projects: [{ id: 'p1', name: 'P', locale: 'ca', locales: ['ca', 'es'] } as never] });
    expect(project).toMatchObject({ bookKey: 'project:p1', presetId: null, projectId: 'p1', locales: ['ca', 'es'], activeLocale: 'ca' });
  });
});
