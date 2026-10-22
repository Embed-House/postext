import { afterEach, describe, expect, it } from 'vitest';
import type { VDTDocument } from 'postext';
import { editModeNow, resetEditMode, selectedFrameNow } from '../editing/editMode.js';
import { templateEditor } from '../templates/editorStore.js';
import { applyTarget } from './applySelection.js';
import { setSelectionTemplates } from './selectionStore.js';

afterEach(() => {
  setSelectionTemplates(null);
  templateEditor.reset();
  resetEditMode();
});

const sel = { pageIndex: 3, chain: [], level: 0, point: { x: 0, y: 0 }, origin: 'page' as const };
const doc = { pages: [] } as unknown as VDTDocument;
const frame = { kind: 'frame' as const, template: 'tema', frame: { id: 'cp0:caja[1].texto', name: 'caja[1].texto', configPath: '/pageTemplates/1/frames/0' } as never };

function deps(panel: 'markdown' | 'config') {
  const dispatched: { type: string; payload?: unknown }[] = [];
  return {
    dispatched,
    deps: {
      dispatch: () => (action: { type: string; payload?: unknown }) => { dispatched.push(action); },
      activePanel: () => panel,
      sourceOfPage: () => null,
    },
  };
}

describe('a frame carried out in Design mode', () => {
  it('opens its properties in the template that draws it, asked for from Content mode (Alt on the path)', () => {
    templateEditor.getSnapshot();
    setSelectionTemplates(() => [{ id: 'tema' }, { id: 'modulo', role: 'module' }] as never);
    const { deps: d, dispatched } = deps('markdown');

    expect(applyTarget(frame, sel as never, doc, d, 'design')).toBe(true);

    // The module's frame is edited in the module template (#1065), the
    // Design panel opens, and the Sandbox stays in Content mode: the text
    // is still edited on the page.
    expect(templateEditor.getSnapshot().selection).toMatchObject({ templateId: 'modulo', frame: 'texto', pageIndex: 3 });
    expect(selectedFrameNow()).toMatchObject({ frameId: 'cp0:caja[1].texto', configPath: '/pageTemplates/1/frames/0' });
    expect(dispatched).toEqual([{ type: 'SET_PANEL', payload: 'config' }]);
    expect(editModeNow()).toBe('content');
  });

  it('opens the slot in the Markdown when the mode is the one of the moment (Content)', () => {
    const { deps: d, dispatched } = deps('markdown');
    const opened: number[] = [];
    const ok = applyTarget(frame, sel as never, doc, { ...d, openFrameSlot: (pageIndex) => { opened.push(pageIndex); return true; } });
    expect(ok).toBe(true);
    expect(opened).toEqual([3]);
    expect(dispatched).toEqual([]);
    expect(templateEditor.getSnapshot().selection).toBeNull();
  });
});
