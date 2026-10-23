import { describe, expect, it } from 'vitest';
import type { PostextConfig } from 'postext';
import { harness } from './testHarness.js';

// #1209: the settings tools of a book in several languages write the
// general settings or the edition on screen.

const pt = (value: number) => ({ value, unit: 'pt' as const });

describe('settings of a book in several languages', () => {
  const shared = { bodyText: { fontSize: pt(11) } } as PostextConfig;
  const edition = { locale: 'ar', bodyText: { fontSize: pt(11), fontFamily: 'Amiri' } } as PostextConfig;

  it('read and write the general settings, the edition keeping its own fields', async () => {
    const { call, get } = harness({ config: edition, configLayers: { shared, scope: 'all' } });
    const read = await call('sandbox_get_config', {});
    expect(read).toMatchObject({ scope: 'all', ownFields: ['bodyText.fontFamily', 'locale'] });
    expect(read.set).toEqual(shared);

    const set = await call('sandbox_set_config', { changes: [{ path: 'bodyText.fontSize', value: pt(12) }, { path: 'bodyText.fontFamily', value: 'Lora' }], wait: false });
    expect(set.scope).toBe('all');
    expect(set.keptBy).toEqual(['ar']);
    expect(get().configLayers?.shared.bodyText).toEqual({ fontSize: pt(12), fontFamily: 'Lora' });
    expect(get().config.bodyText).toEqual({ fontSize: pt(12), fontFamily: 'Amiri' });
    expect(get().config.locale).toBe('ar');
  });

  it('write the edition on screen alone', async () => {
    const { call, get } = harness({ config: edition, configLayers: { shared, scope: 'all' } });
    await call('sandbox_set_config', { changes: [{ path: 'bodyText.fontSize', value: pt(13) }], scope: 'edition', wait: false });
    expect(get().configLayers?.shared).toEqual(shared);
    expect(get().config.bodyText?.fontSize).toEqual(pt(13));
    expect((await call('sandbox_get_config', { scope: 'edition' })).ownFields).toEqual(['bodyText.fontSize', 'bodyText.fontFamily', 'locale']);
  });

  it('refuse the general scope for a book in one language', async () => {
    const { call } = harness({ config: edition });
    expect((await call('sandbox_set_config', { changes: [{ path: 'bodyText.fontSize', value: pt(13) }], scope: 'all' })).error).toMatch(/one language/);
  });
});
