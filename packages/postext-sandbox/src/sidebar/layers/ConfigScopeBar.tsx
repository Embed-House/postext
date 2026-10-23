'use client';

// The scope switch at the top of the Design panel of a book in several
// languages (#1209): whether a change reaches every edition or only the
// one on screen, said in words under it, with the fields the edition sets
// of its own and the notice of a general change some editions do not
// follow.

import { useId, useState } from 'react';
import { ChevronDown, Globe, Languages, Link2 } from 'lucide-react';
import { overridePaths } from 'postext';
import { useSandboxDispatch, useSandboxLabels, useSandboxSelector } from '../../context/SandboxContext.js';
import { Button, SegmentedControl, cn } from '../../ui/index.js';
import { SETTINGS_SECTIONS } from '../sections/registry.js';
import type { ConfigScope } from '../../editions/configLayers.js';
import { useConfigScope } from './ConfigScopeProvider.js';

/** Setting paths by their top-level key, in order, with the fields or
 *  entries right under it (`fontFamily`, `elements[id=rule]`). */
function groupPaths(paths: readonly string[]): { key: string; paths: string[]; parts: string[] }[] {
  const groups = new Map<string, { key: string; paths: string[]; parts: string[] }>();
  for (const p of paths) {
    const key = p.split(/[.[]/)[0] ?? p;
    const rest = p.slice(key.length).replace(/^\./, '');
    const part = rest.match(/^[^.[]*(\[[^\]]*\])?/)?.[0] ?? '';
    const g = groups.get(key) ?? { key, paths: [], parts: [] };
    g.paths.push(p);
    if (part && !g.parts.includes(part)) g.parts.push(part);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function ConfigScopeBar() {
  const labels = useSandboxLabels();
  const storeDispatch = useSandboxDispatch();
  const layers = useSandboxSelector((s) => s.configLayers);
  const { shadowed, dismissShadowed, layer } = useConfigScope();
  const [listOpen, setListOpen] = useState(false);
  const hintId = useId();
  const listId = useId();
  if (!layers || !layer) return null;

  const name = layer.languageName(layer.locale);
  const all = layer.locales.map(layer.languageName).join(', ');
  const ownPaths = overridePaths(layer.overrides[layer.locale] ?? {});
  const sectionOf = (key: string) => {
    const entry = SETTINGS_SECTIONS.find((e) => (e.configKeys as readonly string[]).includes(key));
    return entry ? String(labels[entry.labelKey]) : undefined;
  };
  const edition = layers.scope === 'edition';

  return (
    <div
      className="flex shrink-0 flex-col gap-1.5 border-b border-(--rule) px-3 py-2"
      style={{ borderTop: `3px solid ${edition ? 'var(--edition, var(--brand))' : 'var(--brand)'}` }}
    >
      <SegmentedControl<ConfigScope>
        fill
        value={layers.scope}
        onValueChange={(scope) => storeDispatch({ type: 'SET_CONFIG_SCOPE', payload: scope })}
        ariaLabel={labels.configScopeLabel}
        ariaDescribedBy={hintId}
        options={[
          { value: 'all', label: <span className="inline-flex items-center gap-1"><Globe size={11} aria-hidden="true" />{labels.configScopeAll}</span>, title: labels.configScopeAll },
          { value: 'edition', label: <span className="inline-flex items-center gap-1"><Languages size={11} aria-hidden="true" />{labels.configScopeEdition.replace('__language__', name)}</span>, title: labels.configScopeEdition.replace('__language__', name) },
        ]}
      />
      <p id={hintId} className="text-[0.68rem] leading-[1.4] text-(--slate) [text-wrap:pretty]">
        {edition
          ? labels.configScopeEditionHint.replace('__language__', name)
          : labels.configScopeAllHint.replace('__languages__', all)}
      </p>

      {edition && ownPaths.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-expanded={listOpen}
              aria-controls={listId}
              onClick={() => setListOpen((v) => !v)}
              className="inline-flex min-h-7 pt-large:min-h-11 cursor-pointer items-center gap-1 rounded text-[0.7rem] text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-1 outline-(--brand)"
            >
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--edition, var(--brand))' }} />
              {labels.configLayerOwnCount.replace('__count__', String(ownPaths.length)).replace('__language__', name)}
              <ChevronDown size={12} aria-hidden="true" className={cn('transition-transform', listOpen && 'rotate-180')} />
            </button>
            <Button size="xs" variant="ghost" icon={<Link2 size={12} />} onClick={() => layer.useGeneral(ownPaths)}>
              {labels.configLayerUseGeneralAll}
            </Button>
          </div>
          {listOpen && (
            <ul id={listId} className="flex flex-col gap-0.5 ps-3">
              {groupPaths(ownPaths).map(({ key, paths, parts }) => {
                const section = sectionOf(key) ?? key;
                return (
                  <li key={key} className="flex items-center justify-between gap-2 text-[0.68rem] text-(--slate)">
                    <span className="min-w-0 truncate" title={paths.join('\n')}>
                      <span className="text-(--foreground)">{section}</span>
                      <span className="ms-1">({paths.length})</span>
                      {parts.length > 0 && <code className="ms-1 text-[0.64rem]">{parts.join(', ')}</code>}
                    </span>
                    <button
                      type="button"
                      onClick={() => layer.useGeneral(paths)}
                      aria-label={`${labels.configLayerUseGeneral}: ${section}`}
                      title={labels.configLayerUseGeneral}
                      className="inline-flex h-5 w-5 pt-large:h-11 pt-large:w-11 shrink-0 cursor-pointer items-center justify-center rounded text-(--slate) hover:text-(--foreground) focus-visible:outline-2 outline-(--brand)"
                    >
                      <Link2 size={11} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {!edition && shadowed && (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-dashed border-(--slate) px-2 py-1.5 text-[0.68rem] leading-[1.4] text-(--foreground)">
          <span>{labels.configLayerShadowed.replace('__languages__', shadowed.keptBy.map(layer.languageName).join(', '))}</span>
          <span className="flex flex-wrap items-center gap-1">
            <Button size="xs" variant="ghost" icon={<Link2 size={12} />} onClick={() => { for (const l of shadowed.keptBy) layer.useGeneralIn(l, shadowed.paths); dismissShadowed(); }}>
              {shadowed.keptBy.length === 1
                ? labels.configLayerApplyIn.replace('__language__', layer.languageName(shadowed.keptBy[0]!))
                : labels.configLayerApplyInAll}
            </Button>
            <Button size="xs" variant="ghost" onClick={dismissShadowed}>{labels.configLayerKeep}</Button>
          </span>
        </div>
      )}
    </div>
  );
}
