import { afterEach, describe, expect, it } from 'vitest';
import type { Resource } from 'postext';
import { sandboxReducer, type SandboxAction, type SandboxState } from '../context/SandboxContext';
import { state as baseState } from '../webmcp/tools/testHarness';
import { COALESCE_MS, createSandboxHistory, setActiveHistory } from './sandboxHistory';
import { describeStep } from './historyKeys';
import { DEFAULT_LABELS } from '../types/defaultLabels';

// #866: the marks of a picture (its label anchors) are steps of the one
// undo history when the change asks for it.

const MAP: Resource = {
  id: 'mapa', typeId: 'figure', kind: 'bitmap', createdAt: 0, updatedAt: 0,
  bitmap: { fileId: 'mapa.png', format: 'png', width: 400, height: 300 },
  anchors: [{ id: 'madrid', x: 0.25, y: 0.75, style: 'ciudad' }],
};

function setup(initial: Partial<SandboxState> = {}) {
  let current: SandboxState = { ...baseState(), resources: [MAP], ...initial };
  let clock = 1_000;
  const reduce = (action: SandboxAction) => { current = sandboxReducer(current, action); };
  const history = createSandboxHistory({ dispatch: reduce, getState: () => current, editorStates: () => new Map(), now: () => clock });
  setActiveHistory(history);
  return { history, dispatch: history.dispatch, get: () => current, tick: (ms: number) => { clock += ms; } };
}

const anchorOf = (s: SandboxState, id = 'madrid') => s.resources.find((r) => r.id === 'mapa')!.anchors!.find((a) => a.id === id);
const moved = (s: SandboxState, x: number, y: number): Resource => {
  const r = s.resources.find((q) => q.id === 'mapa')!;
  return { ...r, anchors: r.anchors!.map((a) => (a.id === 'madrid' ? { ...a, x, y } : a)), updatedAt: Date.now() };
};

afterEach(() => setActiveHistory(null));

describe('resource steps of the history (#866)', () => {
  it('records a resource change that asks for it, and undoes and redoes it', () => {
    const env = setup();
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: moved(env.get(), 0.5, 0.5), history: { merge: false } });
    expect(anchorOf(env.get())).toMatchObject({ x: 0.5, y: 0.5 });
    expect(env.history.peek()).toEqual({ kind: 'resource', resourceId: 'mapa' });
    expect(env.history.undo()).toEqual({ kind: 'resource', resourceId: 'mapa' });
    expect(anchorOf(env.get())).toMatchObject({ x: 0.25, y: 0.75, style: 'ciudad' });
    expect(env.history.canRedo()).toBe(true);
    env.history.redo();
    expect(anchorOf(env.get())).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('leaves out changes that do not ask (an upload, a rename) and new resources', () => {
    const env = setup();
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: moved(env.get(), 0.5, 0.5) });
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: { ...MAP, id: 'otro' }, history: {} });
    expect(env.history.canUndo()).toBe(false);
  });

  it('joins changes of one resource within the coalescing window unless one says merge: false', () => {
    const env = setup();
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: moved(env.get(), 0.3, 0.3), history: {} });
    env.tick(COALESCE_MS / 2);
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: moved(env.get(), 0.4, 0.4), history: {} });
    env.tick(10);
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: moved(env.get(), 0.6, 0.6), history: { merge: false } });
    env.history.undo();
    expect(anchorOf(env.get())).toMatchObject({ x: 0.4, y: 0.4 });
    env.history.undo();
    expect(anchorOf(env.get())).toMatchObject({ x: 0.25, y: 0.75 });
    expect(env.history.canUndo()).toBe(false);
  });

  it('interleaves with design steps in the order they were made', () => {
    const env = setup();
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: moved(env.get(), 0.5, 0.5), history: { merge: false } });
    env.tick(2 * COALESCE_MS);
    env.dispatch({ type: 'UPDATE_CONFIG', payload: { labelStyles: [{ id: 'ciudad' } as never] } });
    expect(env.history.undo()?.kind).toBe('config');
    expect(anchorOf(env.get())).toMatchObject({ x: 0.5 });
    expect(env.history.undo()?.kind).toBe('resource');
    expect(anchorOf(env.get())).toMatchObject({ x: 0.25 });
  });

  it('drops a step whose resource is gone', () => {
    const env = setup();
    env.dispatch({ type: 'UPSERT_RESOURCE', payload: moved(env.get(), 0.5, 0.5), history: { merge: false } });
    env.dispatch({ type: 'DELETE_RESOURCE', payload: 'mapa' });
    expect(env.history.undo()).toBeNull();
    expect(env.get().resources).toHaveLength(0);
  });

  it('names the picture in the announcement', () => {
    expect(describeStep({ kind: 'resource', resourceId: 'mapa' }, { chapters: [] }, DEFAULT_LABELS)).toBe('marks of the picture mapa');
  });
});
