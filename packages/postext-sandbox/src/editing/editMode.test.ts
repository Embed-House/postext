import { afterEach, describe, expect, it } from 'vitest';
import { editModeNow, isEditModeShortcut, onEditModeChange, resetEditMode, selectFrame, selectedFrameNow, setEditMode, toggleEditMode } from './editMode.js';
import { panelForMode } from './EditModeSwitch.js';

afterEach(() => resetEditMode());

describe('edit mode', () => {
  it('starts in Content, toggles and tells its listeners', () => {
    expect(editModeNow()).toBe('content');
    let calls = 0;
    const off = onEditModeChange(() => { calls++; });
    expect(toggleEditMode()).toBe('design');
    setEditMode('design');
    expect(calls).toBe(1);
    off();
  });

  it('forgets the picked frame on the way back to Content', () => {
    setEditMode('design');
    selectFrame({ pageIndex: 0, frameId: 'cp0:a', name: 'a', template: 't', configPath: '/pageTemplates/0/frames/0' });
    expect(selectedFrameNow()?.name).toBe('a');
    setEditMode('content');
    expect(selectedFrameNow()).toBeNull();
  });

  it('reads Alt+Shift+M by the key, on any layout', () => {
    const ev = (o: Partial<KeyboardEvent>) => ({ altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, code: '', key: '', ...o });
    expect(isEditModeShortcut(ev({ altKey: true, shiftKey: true, code: 'KeyM', key: 'Â' }))).toBe(true);
    expect(isEditModeShortcut(ev({ altKey: true, shiftKey: true, code: 'KeyM', key: 'M', ctrlKey: true }))).toBe(false);
    expect(isEditModeShortcut(ev({ altKey: true, code: 'KeyM', key: 'µ' }))).toBe(false);
  });

  it('swaps the Text and Design panels with the mode', () => {
    expect(panelForMode('design', 'markdown')).toBe('config');
    expect(panelForMode('content', 'config')).toBe('markdown');
    expect(panelForMode('design', 'resources')).toBeNull();
    expect(panelForMode('content', null)).toBeNull();
  });
});
