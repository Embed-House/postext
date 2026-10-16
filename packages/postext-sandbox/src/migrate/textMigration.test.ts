import { describe, it, expect } from 'vitest';
import type { PostextConfig } from 'postext';
import type { Chapter } from '../book/types';
import {
  bookFromSnapshot,
  bookKeyOf,
  dropMigrationSnapshot,
  formatBytes,
  holdsContent,
  loadMigrationSnapshot,
  migrateBook,
  migratedBook,
  onMigrationSnapshotsChanged,
  pictureDifference,
  saveMigrationSnapshot,
  type MigrationSnapshot,
} from './textMigration';
import { closeTextMigration, openTextMigration, textMigrationRequestNow } from './migrationRequest';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pt = (value: number) => ({ value, unit: 'pt' as const });

/** A page style whose running head holds two sentences, one under the
 *  other (the 1.33 port pattern, with words written for the test). */
const CONFIG: PostextConfig = {
  page: { sizePreset: 'custom', width: mm(200), height: mm(260), margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } as never,
  headingStyles: [{
    id: 'topic--p1',
    hidden: true,
    header: {
      elements: [
        { kind: 'text', id: 'a', content: 'The river carries the water down to the sea.', fontSize: pt(11), lineHeight: 1.5, align: 'left', placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(20), y: mm(30) }, size: { width: mm(160) } } },
        { kind: 'text', id: 'b', content: 'Towns grew up where the river met the coast.', fontSize: pt(11), lineHeight: 1.5, align: 'left', placement: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(20), y: mm(35.82) }, size: { width: mm(160) } } },
      ],
    },
  } as never],
};

const chapter = (id: string, markdown: string): Chapter => ({ id, title: id, markdown, createdAt: 0, updatedAt: 0 });
const CHAPTERS = [chapter('c1', '# Rivers {style="topic--p1" id="t1"}\n'), chapter('c2', 'Plain text.\n')];
const slice = { config: CONFIG, chapters: CHAPTERS, activeChapterId: 'c2', activeProjectId: 'p-1', activePresetId: 'postext-guide', presetApplied: null };

describe('text migration in the Sandbox (#874)', () => {
  it('sees the content and moves it, giving back the chapters it changed and leaving the rest', () => {
    expect(holdsContent(CONFIG, CHAPTERS)).toBe(true);
    const result = migrateBook(slice);
    expect(result.unchanged).toBe(false);
    expect(holdsContent(result.config, CHAPTERS)).toBe(false);
    const book = migratedBook(slice, result, 42);
    expect(book.activeChapterId).toBe('c2');
    expect(book.chapters[0]!.markdown).toContain('::::page{template="p1"}');
    expect(book.chapters[0]!.markdown).toContain('The river carries the water down to the sea.\n\nTowns grew up');
    expect(book.chapters[0]!.updatedAt).toBe(42);
    // The chapter with nothing to move is the same object.
    expect(book.chapters[1]).toBe(CHAPTERS[1]);
  });

  it('keys the snapshot by the book on screen', () => {
    expect(bookKeyOf(slice)).toBe('project:p-1');
    expect(bookKeyOf({ activeProjectId: null, activePresetId: 'x', presetApplied: { presetId: 'x', locale: 'es' } })).toBe('preset:x:es');
    expect(bookKeyOf({ activeProjectId: null, activePresetId: 'x', presetApplied: { presetId: 'y', locale: 'es' } })).toBe('preset:x:');
  });

  it('keeps the book as it was and gives it back, without storage too', async () => {
    const snap: MigrationSnapshot = { version: 1, savedAt: 1, config: CONFIG, chapters: CHAPTERS.slice(), activeChapterId: 'gone', movedChars: 10, templates: 1 };
    let told = 0;
    const off = onMigrationSnapshotsChanged(() => { told++; });
    await saveMigrationSnapshot('project:p-1', snap);
    expect(await loadMigrationSnapshot('project:p-1')).toBe(snap);
    const back = bookFromSnapshot(snap, { canvasScope: 'book' });
    // A chapter no longer there: the first one is opened.
    expect(back).toEqual({ chapters: CHAPTERS, activeChapterId: 'c1', canvasScope: 'book' });
    await dropMigrationSnapshot('project:p-1');
    expect(await loadMigrationSnapshot('project:p-1')).toBeNull();
    expect(told).toBe(2);
    off();
  });

  it('measures how far two page pictures differ', () => {
    const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    const half = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(pictureDifference(white, white)).toBe(0);
    expect(pictureDifference(white, half)).toBeCloseTo(127.5, 5);
    expect(formatBytes(1_536_000)).toBe('1.5 MB');
    expect(formatBytes(394_000)).toBe('385 KB');
  });

  it('opens and closes the dialog from anywhere, a new request each time', () => {
    openTextMigration('checks');
    const first = textMigrationRequestNow()!;
    expect(first.reason).toBe('checks');
    openTextMigration('import');
    expect(textMigrationRequestNow()!.serial).toBeGreaterThan(first.serial);
    closeTextMigration();
    expect(textMigrationRequestNow()).toBeNull();
  });
});
