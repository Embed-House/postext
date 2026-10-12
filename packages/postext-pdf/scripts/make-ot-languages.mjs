// Writes src/otLanguageData.ts: the OpenType language systems of each
// language, as the HarfBuzz this package ships maps them (postext #764).
//
//     node scripts/make-ot-languages.mjs            write the module
//     node scripts/make-ot-languages.mjs --check    compare with the one on disk
//
// It takes a minute or two, and needs python3 with fontTools.
//
// A browser hands the language of a text (`lang`, `ctx.lang`) to HarfBuzz,
// which turns the BCP 47 tag into up to three OpenType language tags, in
// order of preference, and takes the first one the font's script has
// (`zh-MO` is `ZHTM`, then `ZHH`). The PDF shapes plain left-to-right text
// with fontkit, which wants the OpenType tag itself, so it needs the same
// table. HarfBuzz keeps it in `hb-ot-tag-table.hh`, made from the IANA
// subtag registry and the OpenType registry, but the WebAssembly build of
// harfbuzzjs exports no function that reads it forwards
// (`hb_ot_tags_from_script_and_language`). This script reads it out of the
// build by what the build does:
//
// 1. Which OpenType tags it knows: `hb_ot_tag_to_language` answers a
//    language for a tag of the table and a private-use one (`x-hbot-…`) for
//    any other. Every tag of three capitals, with a fourth capital, digit
//    or space, is asked.
// 2. A probe font (`ot_language_probe.py`, fontTools) has one `locl` rule
//    for each of those tags under the Latin script: `a` becomes a glyph of
//    its own in each language system.
// 3. `a` is shaped in a language: the glyph that comes out names the
//    language system HarfBuzz chose, its first tag for the language. The
//    same again with a copy of the font that lacks the tags already found
//    gives the second, then the third.
// 4. The languages asked: every primary subtag of two and of three
//    letters; `und` with every script (ISO 15924: the ones
//    `Intl.DisplayNames` has a name for) and with every variant HarfBuzz
//    named in step 1 (`und-fonipa`, `el-polyton`), which finds the subtags
//    that decide the tag in any language (`*-Syre` in the module); each
//    language that has a tag with every script, every region of two
//    letters and those variants; and, for the languages where a script or
//    a region changes the answer (Chinese), their pairs.
//
// A language of three letters the table does not hold is given its own
// letters in capitals as the tag (ISO 639-3, as most OpenType tags are).
// The lookup applies that rule and the module holds what differs from it;
// the rule is checked for every such language with fonts that have every
// tag of three capitals.
//
// The lookup of a tag (`openTypeLanguagesOf` in src/otLanguages.ts, and
// `lookup` below, which must stay the same) tries, in this order: the
// language with each variant, with its script and region, with its script;
// each variant and the script in any language; the language with its
// region; the language. This script ends by checking that it answers what
// HarfBuzz answered for every tag asked.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const TARGET = fileURLToPath(new URL('../src/otLanguageData.ts', import.meta.url));
const wasmPath = require.resolve('harfbuzzjs/dist/harfbuzz.wasm');
// The package's own package.json is not among its exports: it is two
// folders above the binary.
const harfbuzzjsVersion = JSON.parse(readFileSync(join(wasmPath, '..', '..', 'package.json'), 'utf8')).version;
const wasmModule = new WebAssembly.Module(readFileSync(wasmPath));

/** HarfBuzz takes at most this many tags for a language. */
const MAX_TAGS = 3;
/** Languages asked before HarfBuzz is started afresh: it keeps every
 *  language it was ever asked in a list it walks on each call. */
const LANGUAGES_PER_INSTANCE = 300;

const CAPITALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

// ---------------------------------------------------------------------------
// HarfBuzz, with the host functions its binary imports (see src/harfbuzz.ts)
// ---------------------------------------------------------------------------

function startHarfBuzz() {
  const heap = {};
  const abort = (what) => {
    throw new Error(`HarfBuzz aborted (${what})`);
  };
  const instance = new WebAssembly.Instance(wasmModule, {
    env: {
      _abort_js: () => abort('abort'),
      _emscripten_runtime_keepalive_clear: () => {},
      _setitimer_js: () => 0,
      emscripten_resize_heap: (requested) => {
        const old = heap.memory.buffer.byteLength;
        try {
          heap.memory.grow(Math.ceil((Math.max(requested >>> 0, old * 2) - old) / 65536));
          return 1;
        } catch {
          return 0;
        }
      },
    },
    wasi_snapshot_preview1: { proc_exit: (code) => abort(`exit ${code}`) },
  });
  const hb = instance.exports;
  heap.memory = hb.memory;
  hb.__wasm_call_ctors();
  const u8 = () => new Uint8Array(hb.memory.buffer);
  const cString = (ptr) => {
    const bytes = u8();
    let end = ptr;
    while (bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(ptr, end));
  };
  const withString = (str, fn) => {
    const ptr = hb.malloc(str.length + 1);
    const bytes = u8();
    for (let i = 0; i < str.length; i++) bytes[ptr + i] = str.charCodeAt(i);
    bytes[ptr + str.length] = 0;
    try {
      return fn(ptr);
    } finally {
      hb.free(ptr);
    }
  };
  const buffer = hb.hb_buffer_create();
  const latin = withString('Latn', (ptr) => hb.hb_script_from_string(ptr, -1));
  /** The languages asked so far, by tag. */
  const languages = new Map();
  return {
    get asked() {
      return languages.size;
    },
    version: () => cString(hb.hb_version_string()),
    /** The language HarfBuzz names for an OpenType language tag. */
    tagToLanguage(tag) {
      const code = ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0;
      const language = hb.hb_ot_tag_to_language(code);
      return language === 0 ? undefined : cString(hb.hb_language_to_string(language));
    },
    openFont(bytes) {
      const data = hb.malloc(bytes.byteLength);
      u8().set(bytes, data);
      const blob = hb.hb_blob_create(data, bytes.byteLength, 1, 0, 0);
      const face = hb.hb_face_create(blob, 0);
      hb.hb_blob_destroy(blob);
      return hb.hb_font_create(face);
    },
    /** The glyph `a` becomes in `language`, shaped as Latin text. */
    shape(font, language) {
      let handle = languages.get(language);
      if (handle === undefined) {
        handle = withString(language, (ptr) => hb.hb_language_from_string(ptr, -1));
        languages.set(language, handle);
      }
      hb.hb_buffer_reset(buffer);
      const text = hb.malloc(2);
      new Uint16Array(hb.memory.buffer, text, 1)[0] = 0x61;
      hb.hb_buffer_add_utf16(buffer, text, 1, 0, 1);
      hb.free(text);
      hb.hb_buffer_set_direction(buffer, 4);
      hb.hb_buffer_set_script(buffer, latin);
      hb.hb_buffer_set_language(buffer, handle);
      hb.hb_shape(font, buffer, 0, 0);
      const infos = hb.hb_buffer_get_glyph_infos(buffer, 0);
      return new Uint32Array(hb.memory.buffer, infos, 1)[0];
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The OpenType language tags HarfBuzz knows
// ---------------------------------------------------------------------------

function knownTags() {
  let hb = startHarfBuzz();
  const version = hb.version();
  const tags = [];
  /** The language HarfBuzz names for each (`ZHH` is `zh-HK`): where the
   *  variants that matter are read from. */
  const named = new Map();
  let asked = 0;
  for (const a of CAPITALS) for (const b of CAPITALS) for (const c of CAPITALS) for (const d of `${CAPITALS}0123456789 `) {
    // The private-use language of an unknown tag is kept in the list too.
    if (++asked % LANGUAGES_PER_INSTANCE === 0) hb = startHarfBuzz();
    const tag = a + b + c + d;
    const language = hb.tagToLanguage(tag);
    // A tag out of the table comes back as a private-use language
    // (`x-hbot-…`, after the tag's own letters when there are three).
    if (language === undefined || /(^|-)x-hbot-/.test(language)) continue;
    tags.push(tag.trimEnd());
    named.set(tag.trimEnd(), language);
  }
  return { tags, named, version };
}

/** Every script code (ISO 15924) this Node has a name for. */
function knownScripts() {
  const names = new Intl.DisplayNames('en', { type: 'script', fallback: 'none' });
  const scripts = [];
  for (const a of CAPITALS) for (const b of LOWER) for (const c of LOWER) for (const d of LOWER) {
    const script = a + b + c + d;
    if (names.of(script) !== undefined) scripts.push(script);
  }
  return scripts;
}

// ---------------------------------------------------------------------------
// 2. The probe font, and copies of it with other language systems
// ---------------------------------------------------------------------------

/** A probe font whose language systems are `tags` (sorted, as the font
 *  lists them): `a` becomes glyph 2 in the first, 3 in the second… */
function probeFont(tags) {
  const dir = mkdtempSync(join(tmpdir(), 'postext-ot-languages-'));
  try {
    const file = join(dir, 'probe.ttf');
    execFileSync('python3', [join(HERE, 'ot_language_probe.py'), file, ...tags], { stdio: ['ignore', 'inherit', 'inherit'] });
    return new Uint8Array(readFileSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Where the Latin script table of the font's `GSUB` starts, and its
 *  language system records (tag, then offset: six bytes each). */
function latinScript(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagAt = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const tables = view.getUint16(4);
  let gsub = -1;
  for (let i = 0; i < tables; i++) if (tagAt(12 + i * 16) === 'GSUB') gsub = view.getUint32(12 + i * 16 + 8);
  if (gsub < 0) throw new Error('the probe font has no GSUB');
  const scriptList = gsub + view.getUint16(gsub + 4);
  const scripts = view.getUint16(scriptList);
  for (let i = 0; i < scripts; i++) {
    const record = scriptList + 2 + i * 6;
    if (tagAt(record) !== 'latn') continue;
    const script = scriptList + view.getUint16(record + 4);
    const count = view.getUint16(script + 2);
    const records = [];
    for (let k = 0; k < count; k++) records.push({ tag: tagAt(script + 4 + k * 6).trimEnd(), bytes: bytes.slice(script + 4 + k * 6, script + 10 + k * 6) });
    return { script, records };
  }
  throw new Error('the probe font has no Latin script');
}

/** A copy of the probe font without the language systems `without`: their
 *  records are taken out of the list (it stays sorted, and the offsets of
 *  the others, counted from the script table, hold). */
function fontWithout(bytes, without) {
  const { script, records } = latinScript(bytes);
  const kept = records.filter((r) => !without.includes(r.tag));
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint16(script + 2, kept.length);
  kept.forEach((r, k) => copy.set(r.bytes, script + 4 + k * 6));
  return copy;
}

/** A copy of the probe font whose language systems are named `tags`
 *  instead (as many, sorted): each keeps its rule. */
function fontRenamed(bytes, tags) {
  const { script, records } = latinScript(bytes);
  if (records.length !== tags.length) throw new Error('as many tags as the font has language systems');
  const copy = bytes.slice();
  tags.forEach((tag, k) => {
    for (let i = 0; i < 4; i++) copy[script + 4 + k * 6 + i] = (tag[i] ?? ' ').charCodeAt(0);
  });
  return copy;
}

// ---------------------------------------------------------------------------
// 3. The tags of a language, by shaping
// ---------------------------------------------------------------------------

/** A function that gives the tags HarfBuzz takes for a language, in its
 *  order, among the language systems `tags` of `font` (at most `most`). */
function prober(tags, font, most = MAX_TAGS) {
  let hb = startHarfBuzz();
  let fonts = new Map();
  const answers = new Map();
  const tagsOf = (language) => {
    const known = answers.get(language);
    if (known) return known;
    if (hb.asked >= LANGUAGES_PER_INSTANCE) {
      hb = startHarfBuzz();
      fonts = new Map();
    }
    const found = [];
    while (found.length < most) {
      const key = found.join(',');
      let handle = fonts.get(key);
      if (handle === undefined) {
        handle = hb.openFont(found.length === 0 ? font : fontWithout(font, found));
        fonts.set(key, handle);
      }
      const glyph = hb.shape(handle, language);
      if (glyph < 2) break;
      found.push(tags[glyph - 2]);
    }
    answers.set(language, found);
    return found;
  };
  tagsOf.answers = answers;
  return tagsOf;
}

// ---------------------------------------------------------------------------
// 4. The languages asked, and the table
// ---------------------------------------------------------------------------

/** The parts of a tag this script asks: a language, then a script, a
 *  region and a variant, any of them. */
function partsOf(key) {
  const [language, ...rest] = key.split('-');
  const parts = { language };
  for (const sub of rest) {
    if (/^[A-Z][a-z]{3}$/.test(sub)) parts.script = sub;
    else if (/^[A-Z]{2}$/.test(sub)) parts.region = sub;
    else parts.variant = sub;
  }
  return parts;
}

function build() {
  const { tags, named, version } = knownTags();
  const tagsOf = prober(tags, probeFont(tags));
  const entries = new Map();

  /** The rule for a language the table does not hold. */
  const ruleOf = (language) => (language.length === 3 ? [language.toUpperCase()] : []);
  /** What the lookup of the module answers, from the entries so far (the
   *  same steps as `openTypeLanguagesOf`). */
  const lookup = ({ language, script, region, variant }) => {
    const keys = [];
    if (variant) keys.push(`${language}-${variant}`);
    if (script && region) keys.push(`${language}-${script}-${region}`);
    if (script) keys.push(`${language}-${script}`);
    if (variant) keys.push(`*-${variant}`);
    if (script) keys.push(`*-${script}`);
    if (region) keys.push(`${language}-${region}`);
    keys.push(language);
    for (const key of keys) {
      const hit = entries.get(key);
      if (hit) return hit;
    }
    return ruleOf(language);
  };

  // Every primary subtag. A language of three letters with no tag here may
  // still have the one the rule gives it, which the font above lacks
  // unless the table holds it: a font with every tag of three capitals
  // that start with its letter tells (one font made, its language systems
  // renamed for each letter).
  const languages = [];
  for (const a of LOWER) for (const b of LOWER) languages.push(a + b);
  for (const a of LOWER) for (const b of LOWER) for (const c of LOWER) languages.push(a + b + c);
  const endings = [];
  for (const b of CAPITALS) for (const c of CAPITALS) endings.push(b + c);
  const ruleFont = probeFont(endings.map((e) => `A${e}`));
  const byRule = new Map();
  for (const letter of CAPITALS) {
    const ruleTags = endings.map((e) => letter + e);
    byRule.set(letter.toLowerCase(), prober(ruleTags, fontRenamed(ruleFont, ruleTags), 1));
  }
  const mapped = new Set(['und']);
  let unruly = 0;
  for (const language of languages) {
    let found = tagsOf(language);
    if (found.length > 0) mapped.add(language);
    else if (language.length === 3) {
      found = byRule.get(language[0])(language);
      if (found.length === 0) unruly++;
    }
    if (!same(found, lookup({ language }))) entries.set(language, found);
  }

  /** The tags of a list the probe font has: the tag the rule gives a
   *  language is none of them unless the table holds it, so a tag that
   *  falls to such a language shows as none. */
  const inFont = new Set(tags);
  const shown = (list) => list.filter((tag) => inFont.has(tag));
  const agrees = (key, found) => same(found, shown(lookup(partsOf(key))));

  /** Ask a tag, and keep its answer where the lookup would give another. */
  const note = (key) => {
    const found = tagsOf(key);
    if (!agrees(key, found)) entries.set(key, found);
    return found;
  };

  // The subtags that decide in any language: asked with `und`, which has
  // no tag of its own.
  const scripts = knownScripts();
  const variants = new Set();
  for (const language of named.values()) {
    const [primary, ...rest] = language.split('-');
    if (primary.length <= 3) mapped.add(primary);
    for (const sub of rest) if (!/^[A-Za-z]{4}$/.test(sub) && !/^[A-Za-z]{2}$/.test(sub) && !/^\d{3}$/.test(sub)) variants.add(sub.toLowerCase());
  }
  for (const sub of [...scripts, ...variants]) {
    const found = tagsOf(`und-${sub}`);
    if (found.length > 0) entries.set(`*-${sub}`, found);
  }

  // Scripts, regions and variants, for every language that has a tag.
  const regions = [];
  for (const a of CAPITALS) for (const b of CAPITALS) regions.push(a + b);
  const sensitive = new Map();
  for (const language of [...mapped].sort()) {
    const bare = shown(lookup({ language }));
    const own = { scripts: [], regions: [] };
    for (const script of scripts) if (!same(note(`${language}-${script}`), entries.get(`*-${script}`) ?? bare)) own.scripts.push(script);
    for (const region of regions) if (!same(note(`${language}-${region}`), bare)) own.regions.push(region);
    for (const variant of variants) note(`${language}-${variant}`);
    if (own.scripts.length > 0 || own.regions.length > 0) sensitive.set(language, own);
  }
  // A script with a region, where either one matters to the language: its
  // scripts that matter with every region, and its regions that matter
  // with every script. Where a pair goes by its script, an entry for the
  // script alone settles all its pairs.
  for (const [language, own] of sensitive) {
    const pair = (script, region) => {
      const key = `${language}-${script}-${region}`;
      const found = tagsOf(key);
      if (agrees(key, found)) return;
      const byScript = `${language}-${script}`;
      if (!entries.has(byScript) && same(found, tagsOf(byScript))) entries.set(byScript, found);
      else entries.set(key, found);
    };
    for (const script of own.scripts) for (const region of regions) pair(script, region);
    for (const region of own.regions) for (const script of scripts) pair(script, region);
  }

  // Every tag asked, once more against the finished entries: an entry
  // added late may have changed an answer checked before it.
  for (let pass = 0; ; pass++) {
    let changed = 0;
    for (const [key, found] of tagsOf.answers) {
      const parts = partsOf(key);
      // A language of three letters with no tag went by the rule's fonts.
      if (key === parts.language && found.length === 0) continue;
      if (agrees(key, found)) continue;
      entries.set(key, found);
      changed++;
    }
    if (changed === 0) break;
    if (pass > 4) throw new Error('the entries do not settle');
  }

  // The module: tags, then the languages that take them.
  const byTags = new Map();
  for (const [key, found] of entries) {
    const list = found.join(',');
    if (!byTags.has(list)) byTags.set(list, []);
    byTags.get(list).push(key);
  }
  const data = [...byTags].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([list, keys]) => `${list}=${keys.sort().join(' ')}`).join(';');
  return { data, version, tags: tags.length, entries: entries.size, asked: tagsOf.answers.size, mapped: mapped.size, unruly, sensitive: [...sensitive.keys()] };
}

function moduleText({ data, version }) {
  const lines = [];
  for (let at = 0; at < data.length; at += 110) lines.push(`'${data.slice(at, at + 110)}'`);
  return `// Generated by scripts/make-ot-languages.mjs from HarfBuzz ${version}
// (harfbuzzjs ${harfbuzzjsVersion}): do not edit. Run the script again when
// harfbuzzjs is updated; \`otLanguages.test.ts\` fails while the two differ.

/** The HarfBuzz the table was read from. */
export const OT_LANGUAGES_HARFBUZZ = '${version}';

/**
 * The OpenType language tags of each language, as HarfBuzz takes them:
 * \`TAGS=languages\` separated by \`;\`, the tags in order of preference
 * separated by commas, the languages by spaces. A language is a primary
 * subtag, alone or with a script, a region or a variant where that changes
 * the answer; \`*\` stands for any language. One with no tags is listed
 * under the empty list. Read by \`otLanguages.ts\`.
 */
export const OT_LANGUAGE_DATA =
  ${lines.join('\n  + ')};
`;
}

const built = build();
const text = moduleText(built);
console.log(`HarfBuzz ${built.version}: ${built.tags} OpenType language tags, ${built.mapped} languages with one, ${built.asked} tags asked`);
console.log(`${built.unruly} languages of three letters without their own letters as the tag`);
console.log(`a script or a region changes the answer in: ${built.sensitive.join(' ')}`);
console.log(`${built.entries} entries, ${built.data.length} characters`);
if (process.argv.includes('--check')) {
  if (readFileSync(TARGET, 'utf8') !== text) {
    console.error(`${TARGET} is not what this HarfBuzz gives: run the script without --check`);
    process.exit(1);
  }
  console.log('src/otLanguageData.ts is up to date');
} else {
  writeFileSync(TARGET, text);
  console.log(`wrote ${TARGET}`);
}
