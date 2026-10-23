'use client';

// The Design panel of a book in several languages (#1209): what its
// sections read and where their writes go, by the scope chosen in its
// header, and what every row needs to say whose value it shows.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { diffConfigLayers, overridePaths, sameConfig, type ConfigOverride, type PostextConfig } from 'postext';
import { useSandboxSelector, useSandboxStore, type SandboxAction } from '../../context/SandboxContext.js';
import { ScopedDispatchContext, StateViewContext, capturedInto, scopedView } from '../../context/configScope.js';
import { FieldLayerContext, type FieldLayerValue } from '../../controls/fieldLayer.js';
import { editionOverride, generalSettingsFrom, generalSettingsView, ownPathsAt, promoteFields, rebaseEdition, recordSharedConfig, withoutOwnFields } from '../../editions/configLayers.js';
import { getProject, toSummary, updateProject } from '../../storage/projects.js';
import { localeDisplayName } from '../../presets/localeNames.js';

/** A write for every language that some editions do not follow, because
 *  they keep a value of their own there. */
export interface ShadowedWrite {
  paths: string[];
  keptBy: string[];
}

interface ConfigScopeValue {
  shadowed: ShadowedWrite | null;
  dismissShadowed: () => void;
  layer: FieldLayerValue | null;
}

export const ConfigScopeContext = createContext<ConfigScopeValue>({ shadowed: null, dismissShadowed: () => {}, layer: null });

export function useConfigScope(): ConfigScopeValue {
  return useContext(ConfigScopeContext);
}

/** The other editions' own fields, read from the project's record; again
 *  when the record's editions move. */
function useAsideOverrides(projectId: string | null, active: boolean, locale: string, rev: number): Record<string, ConfigOverride> {
  const [overrides, setOverrides] = useState<Record<string, ConfigOverride>>({});
  useEffect(() => {
    if (!active || !projectId) {
      setOverrides({});
      return;
    }
    let live = true;
    void getProject(projectId).then((record) => {
      if (!live || !record?.editions) return;
      const base = recordSharedConfig(record);
      if (!base) return;
      const out: Record<string, ConfigOverride> = {};
      for (const [tag, e] of Object.entries(record.editions)) if (tag !== locale) out[tag] = editionOverride(base, e.config);
      setOverrides(out);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [projectId, active, locale, rev]);
  return overrides;
}

export function ConfigScopeProvider({ children }: { children: ReactNode }) {
  const store = useSandboxStore();
  const layers = useSandboxSelector((s) => s.configLayers);
  const config = useSandboxSelector((s) => s.config);
  const uiLocale = useSandboxSelector((s) => s.locale);
  const projectId = useSandboxSelector((s) => s.activeProjectId);
  const projects = useSandboxSelector((s) => s.projects);
  const summary = projects.find((p) => p.id === projectId);
  const locale = summary?.locale ?? config.locale ?? '';
  const locales = useMemo(() => summary?.locales ?? (locale ? [locale] : []), [summary?.locales, locale]);
  const [asideRev, setAsideRev] = useState(0);
  const aside = useAsideOverrides(projectId, !!layers, locale, (summary?.editionsRev ?? 0) + asideRev);
  const [shadowed, setShadowed] = useState<ShadowedWrite | null>(null);

  const own = useMemo(() => (layers ? editionOverride(layers.shared, config) : {}), [layers, config]);
  const overrides = useMemo(() => ({ ...aside, ...(locale ? { [locale]: own } : {}) }), [aside, own, locale]);
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  // Writes made in the same batch build on one another, not on the state
  // still on screen.
  const pending = useRef<{ sharedBase: PostextConfig; shared: PostextConfig; configBase: PostextConfig; config: PostextConfig } | null>(null);

  const dispatch = useCallback<Dispatch<SandboxAction>>((action) => {
    const caught = capturedInto();
    if (caught) {
      caught.push(action);
      return;
    }
    const s = store.getSnapshot();
    const l = s.configLayers;
    if (!l || l.scope !== 'all' || (action.type !== 'UPDATE_CONFIG' && action.type !== 'SET_CONFIG') || (action.type === 'SET_CONFIG' && action.shared)) {
      store.dispatch(action);
      return;
    }
    const p = pending.current;
    const before = p && p.sharedBase === l.shared ? p.shared : l.shared;
    const edition = p && p.configBase === s.config ? p.config : s.config;
    const merged = action.type === 'SET_CONFIG' ? action.payload : { ...generalSettingsView(before, edition), ...action.payload };
    const after = generalSettingsFrom(Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as PostextConfig, edition);
    const next = rebaseEdition(before, after, edition);
    pending.current = { sharedBase: l.shared, shared: after, configBase: s.config, config: next };
    store.dispatch({ type: 'SET_CONFIG', payload: next, shared: after, ...(action.history !== undefined ? { history: action.history } : {}) });
    // Editions that keep a value of their own there do not follow.
    const paths = overridePaths(diffConfigLayers(before, after));
    const keptBy = Object.entries(overridesRef.current).filter(([, o]) => ownPathsAt(o, paths).length > 0).map(([tag]) => tag);
    setShadowed(keptBy.length > 0 ? { paths, keptBy } : null);
  }, [store]);

  // The scope or the book changed: an old notice no longer applies.
  useEffect(() => setShadowed(null), [layers?.scope, projectId, locale]);

  const setEdition = useCallback((next: PostextConfig, shared?: PostextConfig) => {
    store.dispatch({ type: 'SET_CONFIG', payload: next, history: { merge: false }, ...(shared ? { shared } : {}) });
  }, [store]);

  const layer = useMemo<FieldLayerValue | null>(() => {
    if (!layers) return null;
    return {
      scope: layers.scope,
      locale,
      locales,
      languageName: (tag) => localeDisplayName(tag, uiLocale),
      editConfig: layers.scope === 'all' ? generalSettingsView(layers.shared, config) : config,
      overrides,
      useGeneral: (paths) => {
        const s = store.getSnapshot();
        if (s.configLayers) setEdition(withoutOwnFields(s.configLayers.shared, s.config, paths));
      },
      promote: (paths) => {
        const s = store.getSnapshot();
        const l = s.configLayers;
        if (!l) return;
        const shared = promoteFields(l.shared, s.config, paths);
        setEdition(rebaseEdition(l.shared, shared, s.config), shared);
      },
      useGeneralIn: (tag, paths) => {
        const s = store.getSnapshot();
        if (tag === locale) {
          if (s.configLayers) setEdition(withoutOwnFields(s.configLayers.shared, s.config, paths));
          return;
        }
        if (!s.activeProjectId) return;
        void updateProject(s.activeProjectId, (existing) => {
          const base = recordSharedConfig(existing);
          const e = existing.editions?.[tag];
          if (!base || !e) return null;
          const config = withoutOwnFields(base, e.config, paths);
          if (sameConfig(config, e.config)) return null;
          return { editions: { ...existing.editions, [tag]: { ...e, config } }, editionsRev: Date.now() };
        }).then((record) => {
          if (record) store.dispatch({ type: 'UPSERT_PROJECT_SUMMARY', payload: toSummary(record) });
          setAsideRev((n) => n + 1);
          setShadowed(null);
        }).catch(() => undefined);
      },
    };
  }, [layers, locale, locales, uiLocale, config, overrides, store, setEdition]);

  const scope = useMemo<ConfigScopeValue>(() => ({ shadowed, dismissShadowed: () => setShadowed(null), layer }), [shadowed, layer]);

  if (!layers) return <ConfigScopeContext value={scope}>{children}</ConfigScopeContext>;
  return (
    <ConfigScopeContext value={scope}>
      <StateViewContext value={scopedView}>
        <ScopedDispatchContext value={dispatch}>
          <FieldLayerContext value={layer}>{children}</FieldLayerContext>
        </ScopedDispatchContext>
      </StateViewContext>
    </ConfigScopeContext>
  );
}
