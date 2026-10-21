'use client';

import { useMemo } from 'react';
import { useSandboxLabels, useSandboxSelector } from '../../../context/SandboxContext';
import { SelectInput } from '../../../controls';
import { pageFenceAttributes } from '../../../templates/templateUsage';

/** The page-fence condition of a design element (#1087). */
export interface FenceCondition {
  when?: string;
  unless?: string;
}

/** The attributes the book's page fences set, the open chapter as it is
 *  being written. */
export function useFenceAttributes(): string[] {
  const chapters = useSandboxSelector((s) => s.chapters);
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  const markdown = useSandboxSelector((s) => s.markdown) ?? '';
  return useMemo(
    () => pageFenceAttributes(chapters && chapters.length > 0
      ? chapters.map((c) => ({ markdown: c.id === activeChapterId ? markdown : c.markdown }))
      : [{ markdown }]),
    [chapters, activeChapterId, markdown],
  );
}

/** «Drawn when the page says» / «Not drawn when the page says»: a running
 *  head's or a composed page's decoration element drawn only on the pages
 *  whose `::::page` fence sets an attribute, or left out there. The choices
 *  are the attributes the book's fences use; a value no fence sets stays
 *  listed so it can be seen and cleared. */
export function FenceConditionFields<T extends FenceCondition>({ raw, attributes, onChange }: { raw: T; attributes: readonly string[]; onChange: (next: T) => void }) {
  const labels = useSandboxLabels();
  const set = (key: 'when' | 'unless', value: string | undefined) => {
    const next = { ...raw };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value as T[typeof key];
    onChange(next);
  };
  const options = (current: string | undefined) => [
    { value: '', label: labels.headerFooterElementFenceAny },
    ...[...attributes, ...(current && !attributes.includes(current) ? [current] : [])].map((a) => ({ value: a, label: a })),
  ];
  return (
    <>
      <SelectInput
        label={labels.headerFooterElementWhen}
        value={raw.when ?? ''}
        options={options(raw.when)}
        onChange={(v) => set('when', v)}
        tooltip={labels.headerFooterElementWhenTooltip}
        isDefault={raw.when === undefined}
        onReset={() => set('when', undefined)}
      />
      <SelectInput
        label={labels.headerFooterElementUnless}
        value={raw.unless ?? ''}
        options={options(raw.unless)}
        onChange={(v) => set('unless', v)}
        tooltip={labels.headerFooterElementUnlessTooltip}
        isDefault={raw.unless === undefined}
        onReset={() => set('unless', undefined)}
      />
    </>
  );
}
