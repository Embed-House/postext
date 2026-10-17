'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { useSandboxLabels, useSandboxStore } from '../context/SandboxContext';
import { IconButton } from '../ui';
import { runHistoryFromUi } from './historyKeys';

const noSubscription = () => () => undefined;
const noVersion = () => 0;
/** A store rendered without the provider (tests) has no history. */
const NO_HISTORY = { subscribe: noSubscription, getVersion: noVersion, canUndo: () => false, canRedo: () => false };

/** Whether there is a step to undo and one to redo, kept current. */
export function useHistoryAvailability(): { canUndo: boolean; canRedo: boolean } {
  const history = useSandboxStore().history ?? NO_HISTORY;
  const version = useSyncExternalStore(history.subscribe, history.getVersion, history.getVersion);
  // `version` changes whenever the lists do.
  void version;
  return { canUndo: history.canUndo(), canRedo: history.canRedo() };
}

/** Undo and redo of the whole history, as the toolbars run them. */
export function useHistoryCommands(): { undo: () => void; redo: () => void } {
  const store = useSandboxStore();
  const undo = useCallback(() => { if (store.history) runHistoryFromUi(store.history, 'undo', store.getSnapshot); }, [store]);
  const redo = useCallback(() => { if (store.history) runHistoryFromUi(store.history, 'redo', store.getSnapshot); }, [store]);
  return { undo, redo };
}

/** How the keys read on this machine. */
function keysText(): { undo: string; redo: string } {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return mac ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Y' };
}

/**
 * Undo / Redo in the bar above the preview (#899), beside the Content /
 * Design switch: the latest change, to the text or to the design.
 */
export function HistoryButtons() {
  const labels = useSandboxLabels();
  const { canUndo, canRedo } = useHistoryAvailability();
  const { undo, redo } = useHistoryCommands();
  // Read after mounting: the server has no keyboard to name.
  const [keys, setKeys] = useState({ undo: 'Ctrl+Z', redo: 'Ctrl+Y' });
  useEffect(() => setKeys(keysText()), []);
  return (
    <div className="flex items-center" role="group" aria-label={labels.historyGroup}>
      <IconButton
        label={`${labels.historyUndo} (${keys.undo})`}
        icon={<Undo2 size={15} aria-hidden="true" />}
        onClick={undo}
        disabled={!canUndo}
        tooltipSide="bottom"
      />
      <IconButton
        label={`${labels.historyRedo} (${keys.redo})`}
        icon={<Redo2 size={15} aria-hidden="true" />}
        onClick={redo}
        disabled={!canRedo}
        tooltipSide="bottom"
      />
    </div>
  );
}
