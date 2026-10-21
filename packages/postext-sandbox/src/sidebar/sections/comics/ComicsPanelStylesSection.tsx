'use client';

import { memo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { NamedPanelStyleConfig } from 'postext';
import { useSandboxLabels } from '../../../context/SandboxContext.js';
import { CollapsibleSection, ItemCard, ItemCardListActions, moveCardState, openCard } from '../../../controls/index.js';
import { Button, ConfirmPopover, IconButton } from '../../../ui/index.js';
import { SearchScope } from '../../search/SearchScope.js';
import { nextFreeId, removeById, renameById, resetFieldById, setComicsField, slugifyStyleId, upsertById } from './comicsConfig.js';
import { ComicsCardHeader } from './ComicsCardHeader.js';
import { PanelStyleFields, useComics } from './comicsShared.js';

/** Comics → Panel styles: named panel looks a page (`:::page{style=…}`) or
 *  a panel (`::panel{style=…}`) picks. Each inherits the fields it leaves
 *  unset from the default panel style. */
export const ComicsPanelStylesSection = memo(function ComicsPanelStylesSection() {
  const labels = useSandboxLabels();
  const { raw, resolved, write } = useComics();
  const styles: NamedPanelStyleConfig[] = raw?.panelStyles ?? [];
  const setList = (next: NamedPanelStyleConfig[]) => write(setComicsField(raw, 'panelStyles', next));

  return (
    <CollapsibleSection
      title={labels.comicsPanelStylesSection}
      sectionId="comicsPanelStyles"
      hasOverrides={styles.length > 0}
      onReset={() => setList([])}
      resetLabel={labels.reset}
      resetConfirmMessage={labels.comicsPanelStylesResetConfirm}
    >
      {styles.length === 0 && <p className="mb-2 text-xs text-(--slate)">{labels.comicsPanelStylesEmpty}</p>}
      <ItemCardListActions list="comicsPanelStyles" ids={styles.map((x) => x.id)} />
      {styles.map((style) => {
        const r = resolved.panelStyles.find((s) => s.id === style.id) ?? { ...resolved.panel, id: style.id, name: style.id };
        return (
          <SearchScope key={style.id} title={`${style.name ?? ''} ${style.id}`} overridden>
            <ItemCard
              list="comicsPanelStyles"
              id={style.id}
              title={style.name || style.id}
              subtitle={style.name && style.name !== style.id ? style.id : undefined}
              actions={
                <ConfirmPopover message={labels.comicsPanelStyleDeleteConfirm} onConfirm={() => setList(removeById(styles, style.id))}>
                  {({ open }) => <IconButton label={`${labels.comicsStyleDelete}: ${style.name || style.id}`} icon={<Trash2 size={13} />} destructive onClick={open} />}
                </ConfirmPopover>
              }
            >
              <ComicsCardHeader
                hideTitle
                title={style.name || style.id}
                id={style.id}
                sanitizeId={slugifyStyleId}
                otherIds={new Set(styles.filter((s) => s.id !== style.id).map((s) => s.id))}
                idLabel={labels.idLabel}
                idHelp={labels.styleIdHelp}
                idAria={labels.comicsPanelStyleIdAria}
                idHint={labels.comicsPanelStyleUsageHint.replaceAll('__id__', style.id)}
                idDuplicateHint={labels.comicsStyleIdDuplicate}
                onRename={(nextId) => { moveCardState('comicsPanelStyles', style.id, nextId); setList(renameById(styles, style.id, nextId)); }}
                name={style.name}
                nameLabel={labels.comicsStyleNameLabel}
                nameHelp={labels.styleNameHelp}
                nameAria={labels.comicsPanelStyleNameAria}
                onName={(name) => setList(upsertById(styles, style.id, { name }))}
                deleteLabel={labels.comicsStyleDelete}
                deleteConfirm={labels.comicsPanelStyleDeleteConfirm}
              />
              <PanelStyleFields
                raw={style}
                resolved={r}
                onChange={(partial) => setList(upsertById<NamedPanelStyleConfig>(styles, style.id, partial))}
                onResetField={(field) => setList(resetFieldById(styles, style.id, field))}
                fieldIdPrefix={`comics-panelStyle-${style.id}`}
              />
            </ItemCard>
          </SearchScope>
        );
      })}
      <Button
        variant="outline"
        size="xs"
        icon={<Plus size={12} />}
        onClick={() => {
          const id = nextFreeId('panel', styles.map((s) => s.id));
          openCard('comicsPanelStyles', id);
          setList([...styles, { id, name: labels.comicsPanelStyleNewName }]);
        }}
        className="mt-1"
      >
        {labels.comicsPanelStyleAdd}
      </Button>
    </CollapsibleSection>
  );
});
