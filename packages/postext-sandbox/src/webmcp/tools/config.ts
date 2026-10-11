// The book's design: reading and writing its configuration.

import { collectConfigWarnings, resolveDebugConfig, resolveHtmlViewerConfig, stripConfigDefaults } from 'postext';
import type { PostextConfig } from 'postext';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '../../sidebar/sections/registry';
import { tokenize } from '../../sidebar/search/normalize';
import { buildSectionSearchIndex, planSettingsSearch } from '../../sidebar/search/sectionIndex';
import { getAtPath, mergePatch, parsePath, patchPaths, setAtPath } from '../configPaths';
import { bookPagesSummary, dispatchAndWait, layOutChapter, whenSettled, type SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';

/** Every top-level key a configuration has: a path outside them is
 *  refused. */
const CONFIG_KEYS = [
  'page', 'layout', 'bodyText', 'headings', 'tableStyle', 'tableStyles', 'captionStyle', 'diagramStyle', 'videoStyle',
  'paragraphStyles', 'calloutStyles', 'chipStyles', 'parts', 'headingStyles', 'toc', 'index', 'unorderedLists',
  'orderedLists', 'math', 'footnotes', 'crossRefs', 'citations', 'cjk', 'lineNumbers', 'codeStyle', 'header', 'footer',
  'locale', 'direction', 'numerals', 'debug', 'htmlViewer', 'folio', 'comics', 'pdfGeneration', 'print', 'contrast',
  'colorPalette', 'customFonts', 'resourceTypes',
] as const satisfies readonly (keyof PostextConfig)[];

// A section the engine gains must be added above: this line stops
// compiling until it is.
const everySection: Exclude<keyof PostextConfig, (typeof CONFIG_KEYS)[number]> extends never ? true : never = true;
void everySection;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every leaf path of `value`, lists by position, down to `depth` levels. */
function leafPaths(value: unknown, prefix: string, depth: number, out: string[]): void {
  if (depth === 0 || (!isRecord(value) && !Array.isArray(value))) {
    if (prefix) out.push(prefix);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      const id = isRecord(item) && typeof item.id === 'string' ? `[id=${item.id}]` : `[${i}]`;
      leafPaths(item, `${prefix}${id}`, depth - 1, out);
    });
    return;
  }
  for (const [key, member] of Object.entries(value)) leafPaths(member, prefix ? `${prefix}.${key}` : key, depth - 1, out);
}

export function configTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  /** The configuration with every default filled in, as the engine
   *  resolved it for the chapter on screen — what each setting comes to
   *  when the book does not set it. */
  const effectiveConfig = async (signal?: AbortSignal): Promise<Record<string, unknown>> => {
    const s = store.getSnapshot();
    const { doc } = await layOutChapter(host, s.activeChapterId, signal);
    return {
      ...(doc.config as unknown as Record<string, unknown>),
      debug: resolveDebugConfig(s.config.debug),
      htmlViewer: resolveHtmlViewerConfig(s.config.htmlViewer),
      ...(s.config.customFonts ? { customFonts: s.config.customFonts } : {}),
      ...(s.config.resourceTypes ? { resourceTypes: s.config.resourceTypes } : {}),
    };
  };

  const getConfig: WebMcpTool = {
    name: 'sandbox_get_config',
    title: 'Sandbox: read the design settings',
    description: "The book's configuration — page size and margins, columns, body text, headings, lists, figures, running heads, notes, colours, print and so on. A book stores only what departs from the defaults: \"set\" is what it stores at the path, \"effective\" what the setting comes to with the defaults filled in (which also shows every setting that exists there). Paths look like page.margins.top, bodyText.hyphenation, headingStyles[0], calloutStyles[id=note].title. Without a path: everything the book sets, and the names of the top-level sections. The settings are documented at /docs/configuration.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The setting, or the section, to read.' },
        effective: { type: 'boolean', description: 'Include the value with defaults filled in (default true when a path is given).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args, { signal }) => {
      const { config } = store.getSnapshot();
      const set = stripConfigDefaults(config);
      const path = ((args.path as string | undefined) ?? '').trim();
      if (path === '') {
        return {
          set,
          sections: CONFIG_KEYS,
          ...(args.effective ? { effective: await effectiveConfig(signal) } : {}),
        };
      }
      const top = parsePath(path)[0];
      if (!top || !('key' in top) || !(CONFIG_KEYS as readonly string[]).includes(top.key)) {
        throw new ToolError(`"${path}" does not start with a section of the configuration. The sections: ${CONFIG_KEYS.join(', ')}.`);
      }
      const answer: Record<string, unknown> = { path, set: getAtPath(set, path) ?? null };
      if (args.effective !== false) {
        const effective = getAtPath(await effectiveConfig(signal), path);
        if (effective === undefined && answer.set === null) {
          const parentPath = path.replace(/(\.[^.[\]]+|\[[^\]]+\])$/, '');
          const parent = parentPath !== path ? getAtPath(await effectiveConfig(signal), parentPath) : undefined;
          answer.note = isRecord(parent)
            ? `Nothing is set or resolved at this path. The settings under ${parentPath}: ${Object.keys(parent).join(', ')}.`
            : 'Nothing is set or resolved at this path.';
        }
        answer.effective = effective ?? null;
      }
      return answer;
    },
  };

  const setConfig: WebMcpTool = {
    name: 'sandbox_set_config',
    title: 'Sandbox: change the design settings',
    description: "Change the book's configuration, then lay the book out again. changes sets one value per path (page.margins.top, bodyText.fontSize, headingStyles[0].fontSize, calloutStyles[id=note].title); a null value removes the setting, which brings its default back. patch merges an object into the configuration (objects merge, null removes, lists are replaced whole). Lengths are objects such as { \"value\": 2, \"unit\": \"cm\" }; read a setting first (sandbox_get_config) to see its shape. Answers with each setting's value before and after — which is how to take a change back — any warning the new values raise, and the pages every chapter came to before and after.",
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The setting, as a path from the top of the configuration.' },
              value: { description: 'Its new value; null (or left out) removes the setting.' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
        patch: { type: 'object', description: 'An object merged into the configuration.' },
        wait: { type: 'boolean', description: 'Wait for the book to be laid out again and answer with its pages (default true).' },
      },
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const changes = (args.changes as { path: string; value?: unknown }[] | undefined) ?? [];
      const patch = args.patch as Record<string, unknown> | undefined;
      if (changes.length === 0 && !patch) throw new ToolError('Give "changes" (a list of { path, value }) or "patch" (an object to merge in).');
      const before = store.getSnapshot();
      let next: PostextConfig = before.config;
      const paths: string[] = [];
      const checkTop = (path: string) => {
        const top = parsePath(path)[0];
        if (!top || !('key' in top)) throw new ToolError(`"${path}" is not a setting path.`);
        if (!(CONFIG_KEYS as readonly string[]).includes(top.key)) {
          throw new ToolError(`"${top.key}" is not a section of the configuration. The sections: ${CONFIG_KEYS.join(', ')}.`);
        }
      };
      if (patch) {
        for (const path of patchPaths(patch)) {
          checkTop(path);
          paths.push(path);
        }
        next = mergePatch(next, patch);
      }
      for (const change of changes) {
        checkTop(change.path);
        next = setAtPath(next, change.path, change.value === null ? undefined : change.value);
        paths.push(change.path);
      }
      const changed = paths
        .map((path) => ({ path, from: getAtPath(before.config, path) ?? null, to: getAtPath(next, path) ?? null }))
        .filter((c) => !same(c.from, c.to));
      if (changed.length === 0) return { changed: [], note: 'Every setting already had that value.' };

      // A name the engine does not know is read as nothing at all: say so
      // rather than let the change pass for one.
      const notes: string[] = [];
      const known = await effectiveConfig(signal).catch(() => null);
      if (known) {
        for (const { path, to } of changed) {
          if (to === null) continue;
          const steps = parsePath(path);
          const last = steps[steps.length - 1]!;
          if (!('key' in last) || steps.length < 2) continue;
          const parentPath = path.slice(0, path.length - last.key.length - 1);
          const parent = getAtPath(known, parentPath);
          if (isRecord(parent) && !(last.key in parent) && Object.keys(parent).length > 0) {
            notes.push(`${path}: "${last.key}" is not among the settings the engine resolves under ${parentPath} (${Object.keys(parent).join(', ')}). It is stored, but check the name.`);
          }
        }
      }
      const warningsBefore = new Set(collectConfigWarnings(before.config).map((w) => JSON.stringify(w)));
      const warnings = collectConfigWarnings(next).filter((w) => !warningsBefore.has(JSON.stringify(w)));
      const pagesBefore = bookPagesSummary(host, before);
      await dispatchAndWait(host, { type: 'SET_CONFIG', payload: next });
      const answer: Record<string, unknown> = {
        changed,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      };
      if (args.wait === false) return { ...answer, laidOut: false };
      const laidOut = await whenSettled(host, { signal });
      const pagesAfter = bookPagesSummary(host);
      return {
        ...answer,
        laidOut,
        pagesBefore: pagesBefore.pages,
        pagesAfter: pagesAfter.pages,
        chapters: pagesAfter.chapters.map((c, i) => ({ ...c, ...(pagesBefore.chapters[i] && pagesBefore.chapters[i]!.pages !== c.pages ? { pagesBefore: pagesBefore.chapters[i]!.pages } : {}) })),
      };
    },
  };

  const findSetting: WebMcpTool = {
    name: 'sandbox_find_setting',
    title: 'Sandbox: find a design setting',
    description: 'Find where a design setting lives from a few words ("orphans", "margin", "drop cap", "baseline grid"): the configuration paths whose names match, with their current effective values, and the sections of the Design panel that mention the words, with the top-level configuration keys each one edits. The words are matched against the setting names (English, camelCase) and against the panel in the language of the interface.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'One or more words describing the setting.' } },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const tokens = tokenize(args.query as string);
      if (tokens.length === 0) throw new ToolError('Give at least one word to look for.');
      const effective = await effectiveConfig(signal);
      const all: string[] = [];
      leafPaths(effective, '', 6, all);
      const paths = all
        .filter((path) => {
          // `minWordLength` answers to "word length": camelCase is split.
          const words = path.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
          return tokens.every((t) => words.includes(t) || path.toLowerCase().includes(t));
        })
        .slice(0, 60)
        .map((path) => ({ path, effective: getAtPath(effective, path) ?? null }));
      const index = buildSectionSearchIndex(s.labels, s.config, s.resources);
      const sections = planSettingsSearch(index, tokens, false, s.config).flatMap((group) => group.sections.map((id) => {
        const entry = SETTINGS_SECTIONS.find((e) => e.id === id)!;
        const groupEntry = SETTINGS_GROUPS.find((g) => g.id === group.id)!;
        return { section: s.labels[entry.labelKey] as string, group: s.labels[groupEntry.labelKey] as string, settingsGroup: group.id, configKeys: entry.configKeys };
      })).slice(0, 12);
      return {
        paths,
        sections,
        ...(paths.length === 0 && sections.length === 0 ? { note: 'Nothing matched. Try one word, in English for setting names, or read a section whole with sandbox_get_config.' } : {}),
      };
    },
  };

  const resetBook: WebMcpTool = {
    name: 'sandbox_reset_to_original',
    title: 'Sandbox: put the original back',
    description: "Put back what the book started from — the sample it is, or the sample a project was made from: its design settings only (config), its text and resources (document), its resources only, or all of it. The reader's edits to that part are discarded and cannot be recovered.",
    inputSchema: {
      type: 'object',
      properties: { part: { type: 'string', enum: ['config', 'document', 'resources', 'all'], description: 'What to put back.' } },
      required: ['part'],
      additionalProperties: false,
    },
    annotations: { consequentialHint: true },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      if (s.activeProjectId !== null) {
        const source = s.projects.find((p) => p.id === s.activeProjectId)?.sourcePresetId;
        if (!source || !s.presetSummaries.some((p) => p.id === source && p.available)) {
          throw new ToolError('This project was not made from a sample that is still available, so there is no original to put back.');
        }
      }
      await store.reloadPreset(args.part as 'config' | 'document' | 'resources' | 'all');
      const laidOut = await whenSettled(host, { signal });
      return { reset: args.part, laidOut, book: bookPagesSummary(host) };
    },
  };

  return [getConfig, setConfig, findSetting, resetBook];
}
