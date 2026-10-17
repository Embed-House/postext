import { describe, it, expect } from 'vitest';
import type { PostextConfig } from 'postext';
import type { Chapter } from '../book/types';
import {
  bookFromSnapshot,
  bookKeyOf,
  changedResources,
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
import { canUndoMigrationWrite, chapterEdits, undoMigrationWrite, writeBook } from './textMigration';
import { sandboxReducer, type SandboxAction, type SandboxState } from '../context/SandboxContext';
import { createSandboxHistory, setActiveHistory } from '../history/sandboxHistory';
import { resetViewerEdits } from '../editor/viewerEdits';
import { state as baseState } from '../webmcp/tools/testHarness';

class StubCtx {
  font = '';
  measureText(s: string): { width: number } {
    return { width: s.length * 7 };
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext(): StubCtx { return new StubCtx(); }
};

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

describe('the move on the one history (#899)', () => {
  it('is one step per chapter rewritten and one for the design, taken back together, the design first', () => {
    let current: SandboxState = { ...baseState(), chapters: CHAPTERS.slice(), activeChapterId: 'c1', markdown: CHAPTERS[0]!.markdown, config: CONFIG };
    const history = createSandboxHistory({
      dispatch: (a: SandboxAction) => { current = sandboxReducer(current, a); },
      getState: () => current,
      editorStates: (() => { const m = new Map<string, unknown>(); return () => m; })(),
    });
    setActiveHistory(history);
    try {
      const result = migrateBook({ config: CONFIG, chapters: CHAPTERS });
      const target = new Map(result.chapters.map((c) => [c.id, c.markdown]));
      expect(chapterEdits(CHAPTERS, target).map((e) => e.chapterId)).toEqual(['c1']);
      const record = writeBook(history.dispatch, current, result.config, target);
      expect(record).toEqual({ chapters: ['c1'], resources: [], steps: 2 });
      expect(current.config).toBe(result.config);
      expect(current.markdown).toContain('::::page{template="p1"}');
      expect(history.peek()).toMatchObject({ kind: 'config' });
      expect(canUndoMigrationWrite(history, record)).toBe(true);
      expect(undoMigrationWrite(history, record)).toBe(2);
      expect(current.markdown).toBe(CHAPTERS[0]!.markdown);
      expect(holdsContent(current.config, current.chapters)).toBe(true);
      // Redone, then something else changed: no longer the latest steps.
      history.redo();
      history.redo();
      expect(current.markdown).toContain('::::page{template="p1"}');
      history.dispatch({ type: 'UPDATE_CONFIG', payload: { bodyText: { fontSize: pt(13) } } as never, history: { merge: false } });
      expect(canUndoMigrationWrite(history, record)).toBe(false);
      expect(undoMigrationWrite(history, record)).toBe(0);
    } finally {
      setActiveHistory(null);
      resetViewerEdits();
    }
  });
});

// #941: words on a picture as its labels, in the same move.

describe('labels on pictures in the Sandbox’s move (#941)', () => {
  const PAGE = { anchor: { to: 'page', edge: 'top-left' }, size: undefined };
  const at = (x: number, y: number, width?: number, height?: number) => ({
    anchor: { to: 'page' as const, edge: 'top-left' as const },
    offset: { x: mm(x), y: mm(y) },
    ...(width !== undefined ? { size: { width: mm(width), ...(height !== undefined ? { height: mm(height) } : {}) } } : {}),
  });
  void PAGE;
  const MAP_CONFIG: PostextConfig = {
    page: { sizePreset: 'custom', width: mm(200), height: mm(260), margins: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } as never,
    bodyText: { fontFamily: 'Fixture Serif', fontSize: pt(12), lineHeight: pt(18) } as never,
    resourceTypes: [{ id: 'deco', name: 'Picture', shortLabel: '', numberingTemplate: '', resetOn: 'never', counterFormat: 'decimal', captionPrefix: '' }] as never,
    headingStyles: [{
      id: 'map--p1',
      hidden: true,
      header: {
        elements: [
          { kind: 'image', id: 'art', resourceId: 'atlas', decorative: true, placement: at(0, 0, 200, 260) },
          { kind: 'text', id: 'gauge', content: 'Rain gauge', fontFamily: 'Fixture Sans', fontSize: pt(9), fontWeight: 400, color: { hex: '#231f20', model: 'hex' }, align: 'left', verticalAlign: 'top', lineHeight: 1.5, overflow: 'wrap', placement: at(120, 150, 30) },
          { kind: 'text', id: 'intro', content: 'The map shows the coast and the river, drawn for this test.', fontFamily: 'Fixture Sans', fontSize: pt(14), fontWeight: 400, color: { hex: '#231f20', model: 'hex' }, align: 'left', verticalAlign: 'top', lineHeight: 1.5, overflow: 'wrap', placement: at(20, 30, 160) },
        ],
      },
    }],
  } as never;
  const ATLAS = { id: 'atlas', typeId: 'deco', kind: 'bitmap', createdAt: 0, updatedAt: 0, bitmap: { fileId: 'atlas.png', format: 'png', width: 2000, height: 2600 } } as never;
  const MAP_CHAPTERS = [chapter('c1', '# Atlas {style="map--p1" id="t1"}\n')];

  it('turns the short words on the picture into labels at its anchors, and returns the resource with them', () => {
    const off = migrateBook({ config: MAP_CONFIG, chapters: MAP_CHAPTERS, resources: [ATLAS] });
    expect(off.report.labels.labels).toBe(0);
    expect(changedResources([ATLAS], off.resources)).toEqual([]);
    const on = migrateBook({ config: MAP_CONFIG, chapters: MAP_CHAPTERS, resources: [ATLAS] }, { labelsOnPictures: true });
    expect(on.report.labels).toMatchObject({ pictures: 1, labels: 1, anchors: 1 });
    expect(on.chapters[0]!.markdown).toContain('::label[Rain gauge]');
    const written = changedResources([ATLAS], on.resources);
    expect(written.map((r) => r.id)).toEqual(['atlas']);
    expect(written[0]!.anchors).toHaveLength(1);
    // Without the book's resources the picture is unknown: nothing to label.
    expect(migrateBook({ config: MAP_CONFIG, chapters: MAP_CHAPTERS }, { labelsOnPictures: true }).report.labels.labels).toBe(0);
  });

  it('writes the anchors as steps between the text and the design, and takes them back with the move', () => {
    let current: SandboxState = { ...baseState(), chapters: MAP_CHAPTERS.slice(), activeChapterId: 'c1', markdown: MAP_CHAPTERS[0]!.markdown, config: MAP_CONFIG, resources: [ATLAS] };
    const history = createSandboxHistory({
      dispatch: (a: SandboxAction) => { current = sandboxReducer(current, a); },
      getState: () => current,
      editorStates: (() => { const m = new Map<string, unknown>(); return () => m; })(),
    });
    setActiveHistory(history);
    try {
      const result = migrateBook({ config: MAP_CONFIG, chapters: MAP_CHAPTERS, resources: [ATLAS] }, { labelsOnPictures: true });
      const record = writeBook(history.dispatch, current, result.config, new Map(result.chapters.map((c) => [c.id, c.markdown])), result.resources);
      expect(record).toEqual({ chapters: ['c1'], resources: ['atlas'], steps: 3 });
      expect(current.resources[0]!.anchors).toHaveLength(1);
      expect(canUndoMigrationWrite(history, record)).toBe(true);
      expect(undoMigrationWrite(history, record)).toBe(3);
      expect(current.resources[0]!.anchors).toBeUndefined();
      expect(current.markdown).toBe(MAP_CHAPTERS[0]!.markdown);
      expect(holdsContent(current.config, current.chapters)).toBe(true);
    } finally {
      setActiveHistory(null);
      resetViewerEdits();
    }
  });
});
