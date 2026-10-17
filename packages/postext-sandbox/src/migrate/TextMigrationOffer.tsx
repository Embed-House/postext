'use client';

import { useEffect, useState } from 'react';
import { FileInput, Undo2 } from 'lucide-react';
import { useSandboxDispatch, useSandboxLabels, useSandboxSelector, useSandboxStateGetter } from '../context/SandboxContext';
import { Button, announce } from '../ui';
import { openTextMigration } from './migrationRequest';
import { bookFromSnapshot, bookKeyOf, writeBook, dropMigrationSnapshot, loadMigrationSnapshot, onMigrationSnapshotsChanged, type MigrationSnapshot } from './textMigration';

/** At the head of the Checks panel (#874): the way into «Move the text to
 *  the Markdown» when the book's configuration holds content, and the way
 *  back while the book keeps the snapshot taken before a move. */
export function TextMigrationOffer({ contentWarnings }: { contentWarnings: number }) {
  const labels = useSandboxLabels();
  const dispatch = useSandboxDispatch();
  const getState = useSandboxStateGetter();
  const key = useSandboxSelector((s) => bookKeyOf(s));
  const locale = useSandboxSelector((s) => s.locale);
  const [snapshot, setSnapshot] = useState<MigrationSnapshot | null>(null);

  useEffect(() => {
    let live = true;
    const read = () => { void loadMigrationSnapshot(key).then((s) => { if (live) setSnapshot(s); }); };
    read();
    const off = onMigrationSnapshotsChanged(read);
    return () => {
      live = false;
      off();
    };
  }, [key]);

  if (contentWarnings === 0 && !snapshot) return null;

  const restore = async () => {
    if (!snapshot) return;
    const s = getState();
    const same = s.chapters.length === snapshot.chapters.length && snapshot.chapters.every((c) => s.chapters.some((x) => x.id === c.id));
    if (same) {
      // The same chapters: the old text and design as steps of the one
      // history, so the restore can be undone in turn.
      writeBook(dispatch, s, snapshot.config, new Map(snapshot.chapters.map((c) => [c.id, c.markdown])), snapshot.resources);
    } else {
      // Chapters added or removed since: the book as it was, whole.
      dispatch({ type: 'SET_CONFIG', payload: snapshot.config, history: false });
      dispatch({ type: 'SET_BOOK', payload: bookFromSnapshot(snapshot, s) });
      // The anchors the move gave the pictures, as they were.
      for (const r of snapshot.resources ?? []) dispatch({ type: 'UPSERT_RESOURCE', payload: { ...r, updatedAt: Date.now() } });
    }
    await dropMigrationSnapshot(key);
    announce(labels.textMigrationUndone);
  };

  return (
    <div className="mx-2 my-2 flex flex-col gap-2 rounded border border-(--pt-control-border) p-2 text-xs">
      {contentWarnings > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-(--slate)">{labels.textMigrationOfferHint}</span>
          <Button variant="outline" size="sm" icon={<FileInput size={13} aria-hidden="true" />} onClick={() => openTextMigration('checks')}>
            {labels.textMigrationOffer}
          </Button>
        </div>
      )}
      {snapshot && (
        <div className="flex flex-col gap-1">
          <span className="text-(--slate)">
            {labels.textMigrationRestoreHint.replace('__date__', new Date(snapshot.savedAt).toLocaleString(locale))}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" icon={<Undo2 size={13} aria-hidden="true" />} onClick={() => void restore()}>
              {labels.textMigrationRestore}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void dropMigrationSnapshot(key)}>
              {labels.textMigrationKeep}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
