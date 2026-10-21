'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { ContrastAllowEntry } from 'postext';
import { useSandboxLabels } from '../../context/SandboxContext.js';
import { TextInput } from '../../controls/index.js';
import { FieldRow } from '../../controls/FieldRow.js';
import { Button, IconButton } from '../../ui/index.js';
import { SearchScope } from '../search/SearchScope.js';

/**
 * `contrast.allow` (#1124): the colour pairs of the source the contrast
 * check accepts, each by its text and ground colours, by the style the
 * text is set in, or both, with the reason it stays. The Checks panel
 * lists what they match as accepted.
 */

/** An entry with `key` left out. */
function without(entry: ContrastAllowEntry, key: 'fg' | 'bg' | 'style'): ContrastAllowEntry {
  const next = { ...entry };
  delete next[key];
  return next;
}

export function ContrastAllowField({ value, onChange }: {
  /** The entries as stored; undefined when unset. */
  value: ContrastAllowEntry[] | undefined;
  /** Undefined unsets the key. */
  onChange: (next: ContrastAllowEntry[] | undefined) => void;
}) {
  const labels = useSandboxLabels();
  const list = value ?? [];
  const write = (next: ContrastAllowEntry[]) => onChange(next.length > 0 ? next : undefined);
  const update = (i: number, next: ContrastAllowEntry) => write(list.map((e, k) => (k === i ? next : e)));
  return (
    <>
      <FieldRow stacked label={labels.contrastAllow} tooltip={labels.contrastAllowTooltip} isDefault={value === undefined} onReset={() => onChange(undefined)}>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="xs" icon={<Plus size={12} />} onClick={() => write([...list, { reason: '' }])}>
            {labels.contrastAllowAdd}
          </Button>
        </div>
      </FieldRow>
      {list.map((entry, i) => {
        const n = String(i + 1);
        const title = labels.contrastAllowItem.replace('__n__', n);
        const set = (key: 'fg' | 'bg' | 'style', v: string) => update(i, v.trim() ? { ...entry, [key]: v.trim() } : without(entry, key));
        return (
          // Entries have no id; their place in the list names them.
          <SearchScope key={i} title={`${labels.contrastAllow} ${title}`} overridden>
            <div className="mb-2 ms-1 rounded border border-(--rule) p-2">
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-(--foreground)">{title}</span>
                <IconButton label={labels.contrastAllowRemove.replace('__n__', n)} icon={<Trash2 size={13} />} destructive onClick={() => write(list.filter((_, k) => k !== i))} />
              </div>
              <TextInput label={labels.contrastAllowFg} value={entry.fg ?? ''} placeholder="#rrggbb" widthCh={9} onChange={(v) => set('fg', v)} tooltip={labels.contrastAllowFgTooltip} />
              <TextInput label={labels.contrastAllowBg} value={entry.bg ?? ''} placeholder="#rrggbb" widthCh={9} onChange={(v) => set('bg', v)} tooltip={labels.contrastAllowBgTooltip} />
              <TextInput label={labels.contrastAllowStyle} value={entry.style ?? ''} widthCh={12} onChange={(v) => set('style', v)} tooltip={labels.contrastAllowStyleTooltip} />
              <TextInput label={labels.contrastAllowReason} value={entry.reason} widthCh={18} onChange={(v) => update(i, { ...entry, reason: v })} tooltip={labels.contrastAllowReasonTooltip} />
            </div>
          </SearchScope>
        );
      })}
    </>
  );
}
