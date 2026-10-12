import { describe, it, expect } from 'vitest';
import { CONFIG_VERSION, migrateBundleConfig, migrateConfig, pinLegacyShapingLanguage } from '../../bundle/configVersion';
import { stripConfigDefaults } from '../../defaults';
import { resolveAllConfig } from '../../pipeline/config';
import type { PostextConfig } from '../../types';

// #764: a configuration stored before the text was measured, painted and
// embedded in the document's own language (configVersion 12 or older,
// postext 1.28 or earlier) keeps the language of the page that hosts the
// layout. Every such configuration: which faces answer with other glyphs
// under a language is not known when a configuration is read.

const kept = (config: PostextConfig): 'document' | 'host' | undefined => config.bodyText?.shapingLanguage;

describe('pinLegacyShapingLanguage (#764)', () => {
  it('writes shapingLanguage: host beside what the configuration sets', () => {
    expect(pinLegacyShapingLanguage<PostextConfig>({}).bodyText).toEqual({ shapingLanguage: 'host' });
    const own: PostextConfig = { locale: 'ca', bodyText: { fontFamily: 'Literata', textAlign: 'left' } };
    expect(pinLegacyShapingLanguage(own)).toEqual({
      locale: 'ca',
      bodyText: { fontFamily: 'Literata', textAlign: 'left', shapingLanguage: 'host' },
    });
    // The stored configuration is not touched.
    expect(kept(own)).toBeUndefined();
  });

  it('leaves a configuration that names the setting as it is', () => {
    for (const config of [{ bodyText: { shapingLanguage: 'document' } }, { bodyText: { shapingLanguage: 'host' } }] as PostextConfig[]) {
      expect(pinLegacyShapingLanguage(config)).toBe(config);
    }
  });

  it('pins every version before 13, whatever its content, and none from 13', () => {
    expect(CONFIG_VERSION).toBe(13);
    for (const v of [undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(kept(migrateConfig({}, v)), String(v)).toBe('host');
      // A face may answer with other glyphs to any text: the content alone
      // cannot rule the pin out.
      expect(kept(migrateConfig({}, v, { content: 'Words and nothing else.' })), String(v)).toBe('host');
      expect(kept(migrateConfig({ bodyText: { shapingLanguage: 'document' } }, v)), String(v)).toBe('document');
      expect(kept(migrateConfig({ bodyText: { shapingLanguage: 'host' } }, v)), String(v)).toBe('host');
    }
    // A configuration stored under 12 whose text holds no task item (#765)
    // gets this pin and no other.
    const twelve: PostextConfig = { locale: 'tr', bodyText: { fontFamily: 'Literata' } };
    expect(migrateConfig(twelve, 12, { content: 'Words.' })).toEqual({ locale: 'tr', bodyText: { fontFamily: 'Literata', shapingLanguage: 'host' } });
    expect(twelve.bodyText).toEqual({ fontFamily: 'Literata' });
    // One that names the setting has nothing left to pin.
    for (const value of ['document', 'host'] as const) {
      const named: PostextConfig = { bodyText: { shapingLanguage: value } };
      expect(migrateConfig(named, 12, { content: 'Words.' })).toBe(named);
    }
    const current: PostextConfig = {};
    expect(migrateConfig(current, 13)).toBe(current);
    expect(migrateConfig(current, CONFIG_VERSION)).toBe(current);
    expect(migrateConfig(current, 99)).toBe(current);
  });

  it('resolves to the setting only when the text is shaped in the document\'s language', () => {
    expect('shapingLanguage' in resolveAllConfig({}).bodyText).toBe(false);
    expect('shapingLanguage' in resolveAllConfig({ bodyText: { shapingLanguage: 'host' } }).bodyText).toBe(false);
    expect(resolveAllConfig({ bodyText: { shapingLanguage: 'document' } }).bodyText.shapingLanguage).toBe('document');
    // The host's language is the default (in postext 1.29.0 alone the
    // document's was): one read from before has it written out, and
    // resolves as a new one does.
    expect(migrateConfig({} as PostextConfig, 12).bodyText).toEqual({ shapingLanguage: 'host' });
    expect(resolveAllConfig(migrateConfig({}, 12)).bodyText).toEqual(resolveAllConfig({}).bodyText);
    expect(resolveAllConfig(migrateConfig({}, 13)).bodyText.shapingLanguage).toBeUndefined();
  });

  it('survives a save', () => {
    for (const config of [{}, { bodyText: { fontFamily: 'Literata' } }] as PostextConfig[]) {
      const migrated = migrateConfig(config, 12);
      const saved = stripConfigDefaults(migrated);
      expect(kept(saved)).toBe('host');
      const reloaded = migrateConfig(saved, 13);
      expect(reloaded).toBe(saved);
      expect(resolveAllConfig(reloaded).bodyText).toEqual(resolveAllConfig(migrated).bodyText);
      expect(kept(stripConfigDefaults(saved))).toBe('host');
    }
    // A value is stored as written, the default too: the default changed
    // between two releases, so the stored value says which was meant.
    expect(stripConfigDefaults({ bodyText: { shapingLanguage: 'document' } }).bodyText).toEqual({ shapingLanguage: 'document' });
    expect(stripConfigDefaults({ bodyText: { shapingLanguage: 'host' } }).bodyText).toEqual({ shapingLanguage: 'host' });
  });

  it('pins a bundle on the bodyText in force', () => {
    // The locale's layer replaces the manifest's `bodyText` wholesale: the
    // pin goes on what is left in force.
    const merged = migrateBundleConfig({}, [{ bodyText: { fontFamily: 'Amiri' } }, { bodyText: { fontFamily: 'Lora' } }], 12);
    expect(merged.bodyText).toEqual({ fontFamily: 'Lora', shapingLanguage: 'host' });
    // A bundle from before 12 takes the pin of #725 with it.
    const older = migrateBundleConfig({}, [{ bodyText: { fontFamily: 'Amiri' } }, { bodyText: { fontFamily: 'Lora' } }], 11);
    expect(older.bodyText).toEqual({ fontFamily: 'Lora', scriptContext: false, shapingLanguage: 'host' });
    // A layer that names the setting keeps its word.
    expect(kept(migrateBundleConfig({}, [{ bodyText: { shapingLanguage: 'document' } }], 12))).toBe('document');
    expect(kept(migrateBundleConfig({}, [{ bodyText: { shapingLanguage: 'host' } }], 12))).toBe('host');
    // The reader's own base is pinned with the rest when nothing names it.
    expect(kept(migrateBundleConfig({ bodyText: { fontFamily: 'Amiri' } }, [{}], 12))).toBe('host');
    // A current bundle is read as written.
    expect(kept(migrateBundleConfig({}, [{}], 13))).toBeUndefined();
    expect(migrateBundleConfig({ bodyText: { fontFamily: 'Amiri' } }, [{}], 13).bodyText).toEqual({ fontFamily: 'Amiri' });
  });
});
