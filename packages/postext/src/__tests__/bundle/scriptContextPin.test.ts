import { describe, it, expect } from 'vitest';
import { migrateBundleConfig, migrateConfig, pinLegacyScriptContext } from '../../bundle/configVersion';
import { stripConfigDefaults } from '../../defaults';
import { resolveAllConfig } from '../../pipeline/config';
import type { PostextConfig } from '../../types';

// #725: a configuration stored before a word with no letter took the
// script of the text around it (configVersion 11 or older, postext 1.27 or
// earlier) keeps shaping such a word alone, as the browser that stored it
// did. Every such configuration: which faces draw their punctuation by
// script is not known when a configuration is read.

const kept = (config: PostextConfig): boolean | undefined => config.bodyText?.scriptContext;

describe('pinLegacyScriptContext (#725)', () => {
  it('writes scriptContext: false beside what the configuration sets', () => {
    expect(pinLegacyScriptContext<PostextConfig>({}).bodyText).toEqual({ scriptContext: false });
    const own: PostextConfig = { bodyText: { fontFamily: 'Amiri', textAlign: 'left' } };
    expect(pinLegacyScriptContext(own).bodyText).toEqual({ fontFamily: 'Amiri', textAlign: 'left', scriptContext: false });
    // The stored configuration is not touched.
    expect(kept(own)).toBeUndefined();
  });

  it('leaves a configuration that names the setting as it is', () => {
    for (const config of [{ bodyText: { scriptContext: true } }, { bodyText: { scriptContext: false } }] as PostextConfig[]) {
      expect(pinLegacyScriptContext(config)).toBe(config);
    }
  });

  it('pins every version before 12, whatever its content, and none from 12', () => {
    for (const v of [undefined, 1, 5, 8, 10, 11]) {
      expect(kept(migrateConfig({}, v)), String(v)).toBe(false);
      // The engine sets words with no letter of its own (a caption's
      // number, a list's): the text alone cannot rule them out.
      expect(kept(migrateConfig({}, v, { content: 'Words and nothing else.' })), String(v)).toBe(false);
      expect(kept(migrateConfig({ bodyText: { scriptContext: true } }, v)), String(v)).toBe(true);
    }
    const current: PostextConfig = {};
    // One stamped 12 takes the pins of rules 13 alone: the language (#764)
    // and, its text not being known, the task box (#765). One stamped 13 is
    // read as it is.
    expect(migrateConfig(current, 12)).toEqual({ bodyText: { shapingLanguage: 'host' }, unorderedLists: { taskBox: 'character' } });
    expect(migrateConfig(current, 13)).toBe(current);
    // A new document has the rule; one read from before keeps the old way.
    expect(resolveAllConfig(current).bodyText.scriptContext).toBeUndefined();
    expect(resolveAllConfig(migrateConfig({}, 11)).bodyText.scriptContext).toBe(false);
  });

  it('survives a save', () => {
    for (const config of [{}, { bodyText: { fontFamily: 'Amiri' } }] as PostextConfig[]) {
      const migrated = migrateConfig(config, 11);
      const saved = stripConfigDefaults(migrated);
      expect(kept(saved)).toBe(false);
      const reloaded = migrateConfig(saved, 12);
      expect(reloaded).toBe(saved);
      expect(resolveAllConfig(reloaded).bodyText).toEqual(resolveAllConfig(migrated).bodyText);
      expect(kept(stripConfigDefaults(saved))).toBe(false);
    }
    // The default is not stored, and resolves to nothing.
    expect(stripConfigDefaults({ bodyText: { scriptContext: true } }).bodyText).toBeUndefined();
    expect(stripConfigDefaults({ bodyText: { scriptContext: false } }).bodyText).toEqual({ scriptContext: false });
    expect('scriptContext' in resolveAllConfig({ bodyText: { scriptContext: true } }).bodyText).toBe(false);
  });

  it('pins a bundle on the bodyText in force', () => {
    // The locale's layer replaces the manifest's `bodyText` wholesale: the
    // pin goes on what is left in force.
    const merged = migrateBundleConfig({}, [{ bodyText: { fontFamily: 'Amiri' } }, { bodyText: { fontFamily: 'Lora' } }], 11);
    // (With the pin every bundle before 13 takes, #764.)
    expect(merged.bodyText).toEqual({ fontFamily: 'Lora', scriptContext: false, shapingLanguage: 'host' });
    // A layer that names the setting keeps its word.
    expect(kept(migrateBundleConfig({}, [{ bodyText: { scriptContext: true } }], 11))).toBe(true);
    // The reader's own base is pinned with the rest when nothing names it.
    expect(kept(migrateBundleConfig({ bodyText: { fontFamily: 'Amiri' } }, [{}], 11))).toBe(false);
    // A current bundle is read as written.
    expect(kept(migrateBundleConfig({}, [{}], 12))).toBeUndefined();
  });
});
