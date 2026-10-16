/**
 * «Move the text to the Markdown» in the Sandbox (#874): what the dialog
 * runs, applies and undoes, apart from React. The migration itself is the
 * engine's `moveTextToMarkdown`; here are the book on screen read as its
 * input, the book it gives back, the snapshot that undoes it, and the
 * comparison of a page before and after. Pure but for the snapshot store.
 */
import { collectConfigWarnings, moveTextToMarkdown, type PostextConfig, type TextMigrationOptions, type TextMigrationResult } from 'postext';
import type { Dispatch } from 'react';
import type { BookContent, Chapter } from '../book/types';
import type { SandboxAction } from '../context/SandboxContext';
import { composeBookMemo } from '../book/compose';
import { minimalChange, type TextChange } from '../book/textChanges';
import { applyViewerEdit } from '../editor/viewerEdits';
import type { HistoryStepInfo, SandboxHistory } from '../history/sandboxHistory';
import { deleteBlob, getBlob, listBlobIds, putBlobAt } from '../storage/blobStore';

/** What the migration reads of the Sandbox state. */
export interface MigrationStateSlice {
  config: PostextConfig;
  chapters: readonly Chapter[];
  activeChapterId: string;
  canvasScope?: BookContent['canvasScope'];
  bookStart?: BookContent['start'];
  activeProjectId: string | null;
  activePresetId: string;
  presetApplied: { presetId: string; locale?: string } | null;
}

/** The book's metadata, as the Checks panel reads it for the check: the
 *  book's front matter (its first chapter's). */
export function bookMetadataOf(chapters: readonly Chapter[]): Record<string, unknown> | undefined {
  if (chapters.length === 0) return undefined;
  return composeBookMemo(chapters, chapters[0]!.id).metadata as Record<string, unknown> | undefined;
}

/** Whether the configuration holds content text (`contentInConfig`). */
export function holdsContent(config: PostextConfig, chapters: readonly Chapter[]): boolean {
  const metadata = bookMetadataOf(chapters);
  return collectConfigWarnings(config, metadata ? { metadata } : {}).some((w) => w.kind === 'contentInConfig');
}

/** Run the migration on the book on screen. */
export function migrateBook(s: Pick<MigrationStateSlice, 'config' | 'chapters'>, options: TextMigrationOptions = {}): TextMigrationResult {
  const metadata = bookMetadataOf(s.chapters);
  return moveTextToMarkdown(
    { config: s.config, chapters: s.chapters.map((c) => ({ id: c.id, markdown: c.markdown })), ...(metadata ? { metadata } : {}) },
    options,
  );
}

/** The book with the migrated chapters' text (the others as they were). */
export function migratedBook(s: MigrationStateSlice, result: TextMigrationResult, now = Date.now()): BookContent {
  const byId = new Map(result.chapters.map((c) => [c.id, c.markdown]));
  return {
    chapters: s.chapters.map((c) => {
      const md = byId.get(c.id);
      return md === undefined || md === c.markdown ? c : { ...c, markdown: md, updatedAt: now };
    }),
    activeChapterId: s.activeChapterId,
    ...(s.canvasScope === 'book' ? { canvasScope: s.canvasScope } : {}),
    ...(s.bookStart ? { start: s.bookStart } : {}),
  };
}

// ---------------------------------------------------------------------------
// On the one history (#899)
// ---------------------------------------------------------------------------

/** One chapter's text change: the smallest edit from what it holds to
 *  what it should hold. */
export interface ChapterEdit {
  chapterId: string;
  changes: TextChange[];
  baseLength: number;
}

/** The edits that turn the chapters' text into `target`'s (by id; a
 *  chapter `target` does not name is left alone). */
export function chapterEdits(chapters: readonly Chapter[], target: ReadonlyMap<string, string>): ChapterEdit[] {
  const out: ChapterEdit[] = [];
  for (const c of chapters) {
    const next = target.get(c.id);
    if (next === undefined) continue;
    const change = minimalChange(c.markdown, next);
    if (change) out.push({ chapterId: c.id, changes: [change], baseLength: c.markdown.length });
  }
  return out;
}

/** What a write of the migration added to the history, to take it back. */
export interface MigrationRecord {
  chapters: string[];
  /** Steps added: one per chapter rewritten, then the design. */
  steps: number;
}

/** Write a book's text and design as steps of the Sandbox's one history
 *  (#899), as a style merge does: one text step per chapter rewritten
 *  (the chapter in the editor through its editor), then the design as a
 *  step of its own. Cmd/Ctrl+Z then takes the design back first, then the
 *  chapters; {@link undoMigrationWrite} takes them all. */
export function writeBook(
  dispatch: Dispatch<SandboxAction>,
  s: Pick<MigrationStateSlice, 'chapters' | 'activeChapterId'>,
  config: PostextConfig,
  target: ReadonlyMap<string, string>,
): MigrationRecord {
  const edits = chapterEdits(s.chapters, target);
  for (const e of edits) {
    if (e.chapterId === s.activeChapterId) applyViewerEdit(dispatch, e.chapterId, e.changes, e.baseLength);
    else dispatch({ type: 'EDIT_CHAPTER_MARKDOWN', payload: { chapterId: e.chapterId, changes: e.changes, baseLength: e.baseLength } });
  }
  dispatch({ type: 'SET_CONFIG', payload: config, history: { merge: false } });
  return { chapters: edits.map((e) => e.chapterId), steps: edits.length + 1 };
}

/** The migration's own step on top of the history: its design step (the
 *  first one met), or a chapter it rewrote. */
function ownStep(step: HistoryStepInfo | null, chapters: ReadonlySet<string>, designDone: boolean): 'design' | 'text' | null {
  if (!step) return null;
  // The design step writes the templates and the heading styles.
  if (step.kind === 'config') return !designDone && (step.keys.includes('pageTemplates') || step.keys.includes('headingStyles')) ? 'design' : null;
  return chapters.has(step.chapterId) ? 'text' : null;
}

/** Whether the latest steps of the history are still `record`'s. */
export function canUndoMigrationWrite(history: Pick<SandboxHistory, 'peek'> | null | undefined, record: MigrationRecord | null): boolean {
  if (!history || !record) return false;
  return ownStep(history.peek(), new Set(record.chapters), false) === 'design';
}

/** Take back `record`'s steps from the top of the history, and no other;
 *  the number taken back. */
export function undoMigrationWrite(history: Pick<SandboxHistory, 'peek' | 'undo'>, record: MigrationRecord): number {
  const chapters = new Set(record.chapters);
  let designDone = false;
  let taken = 0;
  while (taken < record.steps) {
    const own = ownStep(history.peek(), chapters, designDone);
    if (!own) break;
    const step = history.undo();
    if (!step) break;
    if (own === 'design') designDone = true;
    else if (step.kind === 'text') chapters.delete(step.chapterId);
    taken++;
  }
  return taken;
}

// ---------------------------------------------------------------------------
// Snapshot: the book as it was, to undo the move
// ---------------------------------------------------------------------------

/** Blob ids of migration snapshots start so (the garbage collection keeps
 *  them: see `keepMigrationSnapshots`). */
export const MIGRATION_SNAPSHOT_PREFIX = 'migration-snapshot:';

/** The book on screen, one key per project or preset edition. */
export function bookKeyOf(s: Pick<MigrationStateSlice, 'activeProjectId' | 'activePresetId' | 'presetApplied'>): string {
  if (s.activeProjectId) return `project:${s.activeProjectId}`;
  const locale = s.presetApplied?.presetId === s.activePresetId ? s.presetApplied.locale ?? '' : '';
  return `preset:${s.activePresetId}:${locale}`;
}

export interface MigrationSnapshot {
  version: 1;
  savedAt: number;
  config: PostextConfig;
  chapters: Chapter[];
  activeChapterId: string;
  /** What the move did, for the notice that offers to undo it. */
  movedChars: number;
  templates: number;
}

const memory = new Map<string, MigrationSnapshot>();
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

export function onMigrationSnapshotsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keep the book as it was before the move: in memory, and in IndexedDB
 *  so a reload can still undo it. */
export async function saveMigrationSnapshot(key: string, snap: MigrationSnapshot): Promise<void> {
  memory.set(key, snap);
  notify();
  try {
    await putBlobAt(`${MIGRATION_SNAPSHOT_PREFIX}${key}`, new TextEncoder().encode(JSON.stringify(snap)).buffer as ArrayBuffer, 'application/json');
  } catch {
    // Storage unavailable: the snapshot lives for the session.
  }
}

/** The snapshot of `key`, from memory or storage. */
export async function loadMigrationSnapshot(key: string): Promise<MigrationSnapshot | null> {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const rec = await getBlob(`${MIGRATION_SNAPSHOT_PREFIX}${key}`);
    if (!rec) return null;
    const snap = JSON.parse(new TextDecoder().decode(rec.bytes)) as MigrationSnapshot;
    if (snap?.version !== 1 || !Array.isArray(snap.chapters)) return null;
    memory.set(key, snap);
    return snap;
  } catch {
    return null;
  }
}

/** Forget the snapshot (the move is kept, or was undone). */
export async function dropMigrationSnapshot(key: string): Promise<void> {
  memory.delete(key);
  try {
    await deleteBlob(`${MIGRATION_SNAPSHOT_PREFIX}${key}`);
  } catch {
    // Nothing stored.
  }
  notify();
}

/** Add the stored snapshots to the blob ids the garbage collection keeps. */
export async function keepMigrationSnapshots(keep: Set<string>): Promise<void> {
  const ids = await listBlobIds().catch(() => [] as string[]);
  for (const id of ids) if (id.startsWith(MIGRATION_SNAPSHOT_PREFIX)) keep.add(id);
}

/** The book a snapshot gives back. */
export function bookFromSnapshot(snap: MigrationSnapshot, s: Pick<MigrationStateSlice, 'canvasScope' | 'bookStart'>): BookContent {
  const active = snap.chapters.some((c) => c.id === snap.activeChapterId) ? snap.activeChapterId : snap.chapters[0]!.id;
  return {
    chapters: snap.chapters,
    activeChapterId: active,
    ...(s.canvasScope === 'book' ? { canvasScope: s.canvasScope } : {}),
    ...(s.bookStart ? { start: s.bookStart } : {}),
  };
}

// ---------------------------------------------------------------------------
// Before and after
// ---------------------------------------------------------------------------

/** How far two page pictures differ: the mean absolute difference of their
 *  RGB channels, 0–255, over the pixels both have. */
export function pictureDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += 4) {
    sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
    count += 3;
  }
  return sum / count;
}

/** Above this mean difference a page counts as looking different. Small
 *  enough to catch a line set a little off, large enough to pass the
 *  anti-aliasing of the same text drawn twice. */
export const PAGE_DIFFERENCE_THRESHOLD = 1.5;

/** Bytes as a short size: `1.4 MB`, `385 KB`. */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
