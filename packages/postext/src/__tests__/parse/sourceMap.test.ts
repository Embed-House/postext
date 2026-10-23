import { describe, it, expect } from 'vitest';
// @ts-expect-error -- a Node built-in: the package compiles without @types/node.
import { existsSync as exists, readdirSync as readDir, readFileSync as readFile } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { parseMarkdown } from '../../parse/index.js';
import type { ContentBlock } from '../../parse/index.js';

// A block's `sourceMap` points every character of its text at its own
// source character (#1215), after citations, cross-references, maths and
// code spans holding role syntax as everywhere else.

/** Placeholders: the character stands for markup in the source. */
const PLACEHOLDER = new RegExp('[\\uE000-\\uF8FF\\uFFFC\\u2028\\u2063\\u2064\\t]');
/** What a placeholder's entry may point at: the first character of its
 *  markup (`[@k]`, `@k`, `-@k`, `:ref{`, `\ref{`, `$`, `[^n]`, `:chip[`,
 *  a tab, a verse's hemistich `|`, a `\\` break). */
const MARKUP_START = new Set(['[', '@', '-', ':', '\\', '$', '\t', '|']);

/** Why `block`'s map is wrong, or undefined. */
function mapProblem(markdown: string, block: ContentBlock): string | undefined {
  const { text, sourceMap: map } = block;
  if (map.length !== text.length) return `map ${map.length} for text ${text.length}`;
  for (let i = 0; i < text.length; i++) {
    const at = map[i]!;
    if (i > 0 && at < map[i - 1]!) return `entry ${i} goes back (${map[i - 1]} → ${at})`;
    const c = text[i]!;
    const s = markdown[at];
    if (c === s) continue;
    // A space joining two lines, or collapsing a run of whitespace.
    if (c === ' ' && s !== undefined && /\s/.test(s)) continue;
    // The tie of `Eq.~\eqref{…}`.
    if (c === ' ' && s === '~') continue;
    if (PLACEHOLDER.test(c) && s !== undefined && MARKUP_START.has(s)) continue;
    return `entry ${i} (${JSON.stringify(c)}) points at ${JSON.stringify(s)} (${at})`;
  }
  return undefined;
}

const existsSync = exists as (path: URL) => boolean;
const readdirSync = readDir as (path: URL) => string[];
const readFileSync = readFile as (path: URL) => Uint8Array;

function expectMapped(markdown: string): ContentBlock {
  const [block] = parseMarkdown(markdown);
  expect(mapProblem(markdown, block!)).toBeUndefined();
  return block!;
}

describe('sourceMap after citations', () => {
  it('maps a bracketed citation to its `[` and the text after it to its own characters', () => {
    const b = expectMapped('See [@knuth] after.');
    expect(b.sourceMap).toEqual([0, 1, 2, 3, 4, 12, 13, 14, 15, 16, 17, 18]);
  });

  it('maps a narrative citation, one with a locator and one without the author', () => {
    expectMapped('A cite @knuth after.');
    expectMapped('As @knuth [p. 33] says, and [-@lamport, chap. 2] too.');
    expectMapped('Two [see @a, p. 1; @b] then @c.\nA second line [@d].');
  });

  it('keeps the space before a citation (it is no tab)', () => {
    const b = expectMapped('Text [@a] and\ttab.');
    expect(b.text.length).toBe(b.sourceMap.length);
  });
});

describe('sourceMap after cross-references', () => {
  it('maps `@sec:id` and `[@fig:id]` to their markup', () => {
    expectMapped('As @sec:battery shows, the array (see [@fig:sun]) works.');
    expectMapped('Eq.~\\eqref{eq:one} and \\ref{eq:two} hold.');
  });
});

describe('sourceMap after maths', () => {
  it('maps a formula after a reference to its own `$`', () => {
    const md = ':ref{id="runs" style="full"} plots the ratio to $T_0$, against $\\theta_0$.';
    const b = expectMapped(md);
    const maths = b.spans.filter((s) => s.math).map((s) => s.math!.sourceStart);
    expect(maths).toEqual([md.indexOf('$T_0$'), md.indexOf('$\\theta_0$')]);
  });
});

describe('sourceMap after code spans holding role syntax', () => {
  it('maps the text of `` `:smallcaps[…]` `` and the text after it', () => {
    const b = expectMapped('Use `:smallcaps[…]` sets small caps here.');
    expect(b.text).toBe('Use :smallcaps[…] sets small caps here.');
  });

  it('maps `` `:mark[…]` `` in code and a real mark after it', () => {
    expectMapped('Write `:mark[x]{style="a"}` for :mark[this]{style="a"} text.');
  });
});

const PUBLIC = new URL('../../../../../apps/web/public/', import.meta.url);

/** The chapters of every bundle of the guide and the Cookbook, each text
 *  once. */
function publishedChapters(): Array<{ name: string; markdown: string }> {
  const files = [new URL('bundles/postext-guide.postext', PUBLIC)];
  const cookbook = new URL('cookbook/', PUBLIC);
  for (const recipe of existsSync(cookbook) ? readdirSync(cookbook) : []) {
    const dir = new URL(`${recipe}/`, cookbook);
    for (const locale of readdirSync(dir)) {
      const file = new URL(`${locale}/${recipe}.postext`, dir);
      if (existsSync(file)) files.push(file);
    }
  }
  const seen = new Set<string>();
  const out: Array<{ name: string; markdown: string }> = [];
  for (const file of files) {
    for (const [path, data] of Object.entries(unzipSync(readFileSync(file)))) {
      if (!path.startsWith('chapters/') || !path.endsWith('.md')) continue;
      const markdown = strFromU8(data);
      if (seen.has(markdown)) continue;
      seen.add(markdown);
      out.push({ name: `${file.href.slice(PUBLIC.href.length)} ${path}`, markdown });
    }
  }
  return out;
}

describe('sourceMap of the guide and the Cookbook', () => {
  it('points every character of every block at its source', () => {
    const chapters = publishedChapters();
    expect(chapters.length).toBeGreaterThan(100);
    const problems: string[] = [];
    for (const { name, markdown } of chapters) {
      for (const block of parseMarkdown(markdown)) {
        const problem = mapProblem(markdown, block);
        if (problem) problems.push(`${name} (${block.type} at ${block.sourceStart}): ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);
});
