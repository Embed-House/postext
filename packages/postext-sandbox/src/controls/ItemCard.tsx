'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { loadSectionState, saveSectionState } from '../storage/persistence.js';
import { useSandboxLabels } from '../context/SandboxContext.js';
import { Button, Collapsible, HighlightedText, cn } from '../ui/index.js';
import { useSettingsSearch } from '../sidebar/search/SearchContext.js';

/*
 * The cards of a Design panel list (paragraph styles, box styles, TOC
 * levels…) fold one by one (#1031). A card's fold is kept under
 * `card:<list>:<id>` beside the sections' own, starts folded, and is shared
 * through a small store so "Expand all" reaches every card of a list.
 */

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

function cardKey(list: string, id: string): string {
  return `card:${list}:${id}`;
}

function readOpen(key: string): boolean {
  let open = cache.get(key);
  if (open === undefined) {
    open = loadSectionState(key) ?? false;
    cache.set(key, open);
  }
  return open;
}

function writeOpen(key: string, open: boolean): void {
  cache.set(key, open);
  saveSectionState(key, open);
}

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Open (or fold) the cards `ids` of `list`. */
export function setCardsOpen(list: string, ids: readonly string[], open: boolean): void {
  for (const id of ids) writeOpen(cardKey(list, id), open);
  notify();
}

/** Open one card: an entry just added or duplicated shows its controls. */
export function openCard(list: string, id: string): void {
  setCardsOpen(list, [id], true);
}

/** A renamed entry keeps its fold. */
export function moveCardState(list: string, from: string, to: string): void {
  if (from === to) return;
  writeOpen(cardKey(list, to), readOpen(cardKey(list, from)));
  notify();
}

/** Whether a card of `list` is open (folded until opened). */
export function isCardOpen(list: string, id: string): boolean {
  return readOpen(cardKey(list, id));
}

function useCardOpen(key: string): boolean {
  return useSyncExternalStore(subscribe, () => readOpen(key), () => false);
}

interface ItemCardProps {
  /** The list the card belongs to (its storage namespace). */
  list: string;
  /** The entry's id within the list. */
  id: string;
  title: string;
  /** A second line under the title (the style id when the name differs). */
  subtitle?: string;
  /** Buttons drawn beside the title (duplicate, delete, move…). */
  actions?: ReactNode;
  /** `data-style-id` / `data-config-path`, what a page selection looks for
   *  (see settingsFocus). */
  styleId?: string;
  configPath?: string;
  className?: string;
  children: ReactNode;
}

/** A foldable card of a Design panel list: the header (chevron, title, the
 *  entry's buttons) stays, the controls fold away. While the settings
 *  search is active every card is open. */
export function ItemCard({ list, id, title, subtitle, actions, styleId, configPath, className, children }: ItemCardProps) {
  const search = useSettingsSearch();
  const key = cardKey(list, id);
  const open = useCardOpen(key);
  const effectiveOpen = search.active || open;

  const toggle = () => {
    if (search.active) return;
    setCardsOpen(list, [id], !open);
  };

  return (
    <Collapsible.Root
      open={effectiveOpen}
      onOpenChange={toggle}
      data-item-card=""
      data-style-id={styleId}
      data-config-path={configPath}
      className={cn('mb-2 rounded border border-(--rule)', className)}
    >
      <div className="flex items-center gap-1 pe-1">
        <Collapsible.Trigger
          data-item-card-trigger=""
          className={cn(
            'flex min-h-8 pt-large:min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-2 py-1 text-start',
            'hover:bg-(--surface) focus-visible:outline-2 focus-visible:-outline-offset-2 outline-(--brand)',
          )}
        >
          <ChevronRight
            size={12}
            aria-hidden="true"
            className="shrink-0 text-(--slate) rtl:-scale-x-100"
            style={{ transform: effectiveOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-medium text-(--foreground)" title={title} dir="auto">
              <HighlightedText text={title} tokens={search.matcher.tokens} />
            </span>
            {subtitle && (
              <span className="truncate text-[0.68rem] text-(--slate)" dir="ltr">
                <HighlightedText text={subtitle} tokens={search.matcher.tokens} />
              </span>
            )}
          </span>
        </Collapsible.Trigger>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </div>
      <Collapsible.Panel keepMounted data-postext-collapsible="" data-instant={search.active ? '' : undefined}>
        <div data-item-card-body="" className="px-2 pt-1 pb-2">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** "Expand all" / "Collapse all" over a list's cards (two or more). */
export function ItemCardListActions({ list, ids }: { list: string; ids: readonly string[] }) {
  const labels = useSandboxLabels();
  const search = useSettingsSearch();
  if (ids.length < 2 || search.active) return null;
  return (
    <div className="mb-1 flex justify-end gap-1">
      <Button variant="ghost" size="xs" icon={<ChevronsUpDown size={12} aria-hidden="true" />} onClick={() => setCardsOpen(list, ids, true)}>
        {labels.cardsExpandAll}
      </Button>
      <Button variant="ghost" size="xs" icon={<ChevronsDownUp size={12} aria-hidden="true" />} onClick={() => setCardsOpen(list, ids, false)}>
        {labels.cardsCollapseAll}
      </Button>
    </div>
  );
}
