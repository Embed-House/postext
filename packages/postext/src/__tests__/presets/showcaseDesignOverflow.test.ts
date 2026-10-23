/* eslint-disable @typescript-eslint/ban-ts-comment -- node built-ins in a test */
// @ts-nocheck
/* #628: the showcase bundles (apps/web/public/presets) lay out as they did
   before heading and part design texts wrapped by default: read through
   the engine's own migration, every heading and part design text resolves
   to the overflow 1.23 gave it. A bundle stamped today (#1209) carries that
   overflow written out in its configuration. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrateBundleConfig } from '../../bundle/configVersion.js';
import { pickLocaleOverrides } from '../../bundle/manifest.js';
import { resolveAllConfig } from '../../pipeline/config.js';
import type { PostextConfig, ResolvedDesignSlot } from '../../types.js';

/** Every design text of a configuration: [path, element]. */
function designTexts(value: unknown, path: string, out: [string, Record<string, unknown>][] = []): [string, Record<string, unknown>][] {
  if (Array.isArray(value)) value.forEach((v, i) => designTexts(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (rec.kind === 'text' && rec.placement) out.push([path, rec]);
    for (const [k, v] of Object.entries(rec)) designTexts(v, `${path}.${k}`, out);
  }
  return out;
}

const PRESETS = join(__dirname, '../../../../../apps/web/public/presets');

describe('#628: the showcase bundles lay out as they did', () => {
  const ids = existsSync(PRESETS) ? readdirSync(PRESETS).filter((d) => existsSync(join(PRESETS, d, 'preset.json'))) : [];

  it('finds the showcase bundles', () => {
    expect(ids.length).toBeGreaterThan(5);
  });

  // A heading or part text that sets its overflow resolves to it under
  // either rule, so the layout cannot change; the pin writes the ellipsis
  // on any that does not.
  it.each(ids)('%s: every heading and part design text resolves to its 1.23 overflow', (id) => {
    const manifest = JSON.parse(readFileSync(join(PRESETS, id, 'preset.json'), 'utf8')) as { config: PostextConfig; configVersion?: number; locale?: string; locales?: string[]; localized?: Record<string, { config?: PostextConfig }> };
    // Every edition: the general settings and its language's override, read
    // as the reader merges them under the manifest's stamp.
    const locales = [...new Set([...(manifest.locale ? [manifest.locale] : []), ...(manifest.locales ?? []), ...Object.keys(manifest.localized ?? {})])];
    for (const locale of locales.length > 0 ? locales : ['en']) {
      const overrides = pickLocaleOverrides(manifest as never, locale);
      const migrated = migrateBundleConfig({}, [manifest.config, overrides?.config ?? {}], manifest.configVersion);
      const resolved = resolveAllConfig(migrated);
      const slots: [string, ResolvedDesignSlot][] = [
        ...resolved.headings.levels.map((l, i): [string, ResolvedDesignSlot] => [`headings.levels[${i}]`, l.advancedDesign.slot]),
        ...resolved.headingStyles.map((s, i): [string, ResolvedDesignSlot] => [`headingStyles[${i}]`, s.overrides.advancedDesign?.slot ?? { elements: [] }]),
        ['parts.design', resolved.parts.design],
        ['parts.versoDesign', resolved.parts.versoDesign],
      ];
      // What the manifest writes, merged by the same rule with no pin
      // (rules 20 pin nothing; 21 merges the language field by field).
      const unpinned = migrateBundleConfig({}, [manifest.config, overrides?.config ?? {}], (manifest.configVersion ?? 0) >= 21 ? manifest.configVersion : 20);
      const written = designTexts(unpinned, 'config').map(([, e]) => e);
      for (const [where, s] of slots) {
        for (const el of s.elements) {
          if (el.kind !== 'text') continue;
          const own = written.find((e) => e.id === el.id && e.content === el.content);
          expect(el.overflow, `${id} ${where} ${el.id}`).toBe((own?.overflow as string | undefined) ?? 'ellipsis-end');
        }
      }
    }
  });
});
