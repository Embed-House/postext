import { afterEach, describe, expect, it } from 'vitest';
import type { VDTDocument } from 'postext';
import { takeSettingsFocus, takeSettingsSection } from '../context/settingsNavigation';
import { applyTarget } from '../selection/applySelection';
import { setSelectionTemplates } from '../selection/selectionStore';
import { templateEditor } from '../templates/editorStore';
import { bestConfigPath } from './settingsFocus';

afterEach(() => {
  setSelectionTemplates(null);
  templateEditor.reset();
});

const deps = { dispatch: () => () => undefined, activePanel: () => 'config' as const, sourceOfPage: () => null };
const sel = { pageIndex: 3, chain: [], level: 0, point: { x: 0, y: 0 }, origin: 'page' as const };
const doc = { pages: [] } as unknown as VDTDocument;

describe('a Design panel entry asked for from a page (#899)', () => {
  it('finds the card a pointer points into', () => {
    const shown = ['/header/elements/0', '/header/elements/1', '/footer/elements/0'];
    expect(bestConfigPath(shown, '/header/elements/1')).toBe('/header/elements/1');
    expect(bestConfigPath(shown, '/header/elements/1/content')).toBe('/header/elements/1');
    expect(bestConfigPath(shown, '/header/elements/10')).toBeNull();
    expect(bestConfigPath(['/header', '/header/elements/0'], '/header/elements/0/placement')).toBe('/header/elements/0');
  });

  it('carries the element and the style to the panel, and opens the template an element is set in', () => {
    setSelectionTemplates(() => [{ id: 'base' }, { id: 'tema', extends: 'base' }] as never);
    applyTarget({ kind: 'settings', group: 'page', section: 'pageTemplates', path: '/pageTemplates/1/variants/verso/decoration/elements/2' }, sel as never, doc, deps);
    expect(takeSettingsFocus('page')).toEqual({ path: '/pageTemplates/1/variants/verso/decoration/elements/2' });
    expect(takeSettingsFocus('page')).toBeNull();
    expect(takeSettingsSection('page')).toBe('pageTemplates');
    expect(templateEditor.getSnapshot().selection).toMatchObject({ templateId: 'tema', scope: 'verso', pageIndex: 3 });

    applyTarget({ kind: 'settings', group: 'callouts', section: 'calloutStyles', styleId: 'caja-azul' }, sel as never, doc, deps);
    expect(takeSettingsFocus('callouts')).toEqual({ styleId: 'caja-azul' });
    expect(takeSettingsSection('callouts')).toBe('calloutStyles');
  });
});
