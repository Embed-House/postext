import { describe, expect, it, vi } from 'vitest';
import { emitFrameEditorEvent, onFrameEditorEvent } from './frameEvents';

describe('frame editor events', () => {
  it('reaches every listener until it stops, and one that throws does not stop the others', () => {
    const a = vi.fn();
    const b = vi.fn(() => { throw new Error('x'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const offA = onFrameEditorEvent(a);
    const offB = onFrameEditorEvent(b);
    emitFrameEditorEvent({ type: 'cancel', pageIndex: 2 });
    offA();
    emitFrameEditorEvent({ type: 'select', pageIndex: 0, templateId: 't', frame: 'f', frameId: 'cp0:f' });
    offB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
