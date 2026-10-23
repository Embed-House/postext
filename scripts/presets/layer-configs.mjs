#!/usr/bin/env node
// Rewrite a bundle manifest in several languages as general settings plus
// one override per language (#1209).
//
//   node scripts/presets/layer-configs.mjs <bundle-dir> [--general <locale>] [--check]
//
// The showcase builders write `preset.json` with each language's
// configuration as top-level keys that replace the shared ones (the rule
// of a manifest older than configVersion 21), most without a
// `configVersion` (postext 1.4 rules). This reads every edition the way
// the engine does (`readBundle`, the legacy pins of the stamped version
// included), then writes the manifest under today's rules:
//
// - `config` holds what the editions set alike (`commonConfig` of a group
//   of them, see `generalSettings`), the language aside; with `--general
//   <locale>`, that edition's whole configuration (a book whose editions
//   are designs of their own, sharing little: the others state what they
//   set otherwise);
// - `localized[<lang>].config` holds what that edition sets differently,
//   field by field (`leastConfigOverride`, as `planBundle` writes them);
// - `configVersion` is `CONFIG_VERSION`.
//
// Each edition reads the same configuration as before (defaults aside),
// so its layout and the `configKey` of its `layouts.<lang>.json` stay as
// they were; the script fails when one would not. A manifest already in
// this form comes out the same. `--check` writes nothing and fails when
// the manifest is not in this form.
//
// `layerManifest` does the same for a manifest held in memory
// (docs/examples/open-guide/build-guide.mjs). Needs the engine built
// (`pnpm --filter postext build`).

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = (file) => import(pathToFileURL(join(ROOT, 'packages/postext/dist', file)).href);
const { stripConfigDefaults, commonConfig, diffConfigLayers, leastConfigOverride, overridePaths, sameConfig } = await dist('index.js');
const { readBundle, CONFIG_VERSION, bundleBaseConfig, resolveBundleConfigLocale } = await dist('bundle/index.js');

/** A configuration without the font registry (rebuilt from `fonts`). */
const withoutFonts = (config) => {
  const out = { ...config };
  delete out.customFonts;
  return out;
};

/** A configuration as the layout reads it: defaults and the font registry
 *  out. Only to compare: the manifest keeps the values the builder writes,
 *  defaults included. */
const normalize = (config) => withoutFonts(stripConfigDefaults(config));

/** How many fields `own` sets differently from `general`. */
const distance = (general, own) => overridePaths(diffConfigLayers(general, own)).length;

/** The general settings: what a group of editions sets alike, but the
 *  language. Every edition and its nearest ones are tried as the group;
 *  the largest group whose overrides name at most 5 % more fields than the
 *  fewest any group leaves is kept, so that two languages that happen to
 *  word a label alike do not make it general. Two editions share what they
 *  agree on; in a book of ten languages where seven are set alike, those
 *  seven share their design and the other three state what they set
 *  otherwise. */
function generalSettings(editions) {
  const names = Object.keys(editions);
  const groups = new Map();
  for (const a of names) {
    const near = names.filter((b) => b !== a).sort((x, y) => distance(editions[a], editions[x]) - distance(editions[a], editions[y]));
    for (let k = 1; k <= near.length; k++) {
      const group = [a, ...near.slice(0, k)].sort((x, y) => names.indexOf(x) - names.indexOf(y));
      groups.set(group.join(' '), group);
    }
  }
  const scored = [...groups.values()].map((group) => {
    const general = commonConfig(group.map((l) => editions[l]));
    delete general.locale;
    return { general, group, score: names.reduce((n, l) => n + distance(general, editions[l]), 0) };
  });
  const least = Math.min(...scored.map((c) => c.score));
  let best;
  for (const c of scored) {
    if (c.score > least * 1.05) continue;
    if (!best || c.group.length > best.group.length || (c.group.length === best.group.length && c.score < best.score)) best = c;
  }
  return best;
}

/** `manifest` with its configuration as general settings and per-language
 *  overrides, read through `readFile` (path in the bundle → bytes). Each
 *  edition keeps the configuration it reads from `manifest`, or the one
 *  `editions` gives for its locale (as a bundle of that language alone
 *  reads it). Throws when an edition would read another configuration.
 *  Returns the manifest unchanged for a bundle in one language. */
export async function layerManifest(manifest, readFile, { editions: given = {}, general: from } = {}) {
  const locales = [...new Set([
    ...(manifest.locales ?? []),
    ...(manifest.chapters && !Array.isArray(manifest.chapters) ? Object.keys(manifest.chapters) : []),
    ...Object.keys(manifest.localized ?? {}),
  ])];
  if (locales.length < 2) return { manifest, summary: `${manifest.id}: one language, nothing to layer` };
  const editionConfig = async (m, locale) => (await readBundle(m, readFile, {
    locale,
    traceContours: false,
    readResolution: false,
    measureBitmap: () => ({ width: 1, height: 1 }),
    measureSvg: () => ({ width: 1, height: 1 }),
  })).config;

  // What each edition reads today, as written, but the keys every edition
  // takes from the reader's own base (the default palette, the resource
  // types in its language).
  const read = {};
  for (const locale of locales) read[locale] = withoutFonts(given[locale] ?? await editionConfig(manifest, locale));
  const baseOf = (locale, m) => bundleBaseConfig(resolveBundleConfigLocale(m, locale));
  const fromBase = Object.keys(baseOf(locales[0], manifest)).filter((key) => locales.every((l) => sameConfig(read[l][key], baseOf(l, manifest)[key])));
  const editions = {};
  for (const locale of locales) {
    editions[locale] = { ...read[locale] };
    for (const key of fromBase) delete editions[locale][key];
  }
  let general;
  let group;
  if (from) {
    if (!editions[from]) throw new Error(`${manifest.id}: no ${from} edition`);
    general = { ...editions[from] };
    delete general.locale;
    group = [from];
  } else ({ general, group } = generalSettings(editions));

  // Each language's override, over the base the reader lays the general
  // settings on (the default palette and the resource types in that
  // language, replaced key by key by the manifest's `config`).
  const layered = { ...manifest, configVersion: CONFIG_VERSION, config: general };
  const localized = {};
  for (const locale of locales) {
    const base = { ...baseOf(locale, layered), ...general };
    const own = { ...baseOf(locale, layered), ...editions[locale] };
    const override = leastConfigOverride(base, own, withoutFonts);
    const { config: _old, ...rest } = manifest.localized?.[locale] ?? {};
    localized[locale] = Object.keys(override).length > 0 ? { config: override, ...rest } : rest;
  }
  layered.localized = localized;
  // `configVersion` right after `version`, as the engine writes it.
  const { version, configVersion: _v, ...others } = layered;
  const out = { version, configVersion: CONFIG_VERSION, ...others };

  // Every edition must read what it read before.
  const failures = [];
  for (const locale of locales) {
    if (!sameConfig(normalize(await editionConfig(out, locale)), normalize(read[locale]))) failures.push(locale);
  }
  if (failures.length) throw new Error(`${manifest.id}: ${failures.join(', ')} would read another configuration`);
  const count = (o) => Object.keys(o ?? {}).length;
  const summary = `${manifest.id}: general ${count(general)} keys (${from ? `the ${from} edition` : `shared by ${group.join('+')}`}); ${locales.map((l) => `${l} ${count(localized[l].config)}`).join(', ')}`;
  return { manifest: out, summary };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const CHECK = args.includes('--check');
  const at = args.indexOf('--general');
  const from = at >= 0 ? args.splice(at, 2)[1] : undefined;
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: layer-configs.mjs <bundle-dir> [--general <locale>] [--check]');
    process.exit(2);
  }
  const dir = resolve(target);
  const manifestPath = join(dir, 'preset.json');
  const text = readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(text);
  let result;
  try {
    result = await layerManifest(parsed, async (path) => new Uint8Array(readFileSync(join(dir, path))), from ? { general: from } : {});
  } catch (err) {
    console.error(`${err.message}, manifest left as it was`);
    process.exit(1);
  }
  const written = result.manifest === parsed ? text : `${JSON.stringify(result.manifest, null, 1)}\n`;
  if (CHECK) {
    // Key order aside: a manifest written from a builder's output and one
    // layered again order a few keys differently.
    if (written !== text && !sameConfig(result.manifest, parsed)) {
      console.error(`${result.summary}: preset.json is not layered (run without --check)`);
      process.exit(1);
    }
    console.log(`${result.summary}: up to date`);
  } else {
    if (written !== text) writeFileSync(manifestPath, written);
    console.log(result.summary);
  }
}
