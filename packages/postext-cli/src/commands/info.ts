import type { BundleStart } from 'postext/bundle';
import type { CommandContext } from '../context';
import { writeStdout } from '../io';
import { layOut } from '../layout';
import { style } from '../log';
import { openBook } from '../session';

/** Where a book that is part of a longer one starts, in a line. */
function describeStart(start: BundleStart): string {
  const parts: string[] = [];
  const before = start.pageIndexOffset ?? 0;
  if (start.pageIndexOffset !== undefined) parts.push(`after ${before} page${before === 1 ? '' : 's'} (page 1 is a ${before % 2 ? 'verso' : 'recto'})`);
  const numbering = start.pageNumbering;
  if (numbering?.startAt !== undefined) parts.push(`numbered from ${numbering.startAt}${numbering.format ? ` (${numbering.format})` : ''}`);
  else if (numbering?.format) parts.push(`numbered in ${numbering.format}`);
  if (start.headings && start.headings.h1 > 0) parts.push(`after chapter ${start.headings.h1}`);
  if (start.part) parts.push(`in part ${[start.part.number, start.part.title].filter(Boolean).join(' ')}`);
  const counters = (['resourceCounters', 'resourceNumbers', 'statementCounters', 'footnoteNumber', 'lineNumber', 'afterPartPage'] as const).filter((key) => start[key] !== undefined);
  if (counters.length) parts.push(`with ${counters.join(', ')}`);
  return `starts ${parts.join(', ')}`;
}

export default async function info(ctx: CommandContext): Promise<void> {
  const { opts, reporter } = ctx;
  const { book, fonts } = await openBook(ctx);
  const layout = opts.flag('pages') ? await layOut(book, opts, reporter, undefined, fonts) : undefined;
  const kinds: Record<string, number> = {};
  for (const r of book.resources) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  const families = [...fonts.families].map((family) => {
    const faces = fonts.familyFaces(family);
    return {
      family,
      source: [...new Set(faces.map((f) => f.source))].join('+') || 'missing',
      variants: faces.map((f) => `${f.weight}${f.style === 'italic' ? 'i' : ''}`).sort(),
    };
  });
  const chapters = book.chapters.map((c, i) => ({
    title: c.title,
    ...(c.file ? { file: c.file } : {}),
    words: c.markdown.split(/\s+/).filter(Boolean).length,
    ...(layout && layout.chapters.includes(c) ? { pages: layout.docs[layout.chapters.indexOf(c)]!.pages.length } : {}),
    index: i + 1,
  }));
  const page = book.config.page;
  Object.assign(reporter.data, {
    book: {
      name: book.name,
      id: book.id,
      ...(book.description ? { description: book.description } : {}),
      kind: book.kind,
      locale: book.locale,
      ...(book.locales ? { locales: book.locales } : {}),
      ...(page?.sizePreset ? { pageSize: page.sizePreset } : {}),
      ...(book.start ? { start: book.start } : {}),
    },
    chapters,
    resources: { total: book.resources.length, ...kinds },
    fonts: families,
    files: book.files.size,
  });
  if (reporter.json) return;
  const out: string[] = [];
  out.push(`${style.bold(book.name)}${book.description ? ` — ${book.description}` : ''}`);
  out.push(`  ${book.kind}, id ${book.id}, locale ${book.locale}${book.locales ? ` (also ${book.locales.filter((l) => l !== book.locale).join(', ')})` : ''}`);
  if (book.start) out.push(`  ${describeStart(book.start)}`);
  if (layout) out.push(`  ${layout.pageCount} pages`);
  out.push('', style.bold(`Chapters (${chapters.length})`));
  for (const c of chapters) out.push(`  ${String(c.index).padStart(3)}  ${c.title}${style.dim(`  ${c.words} words${c.pages !== undefined ? `, ${c.pages} pages` : ''}${c.file ? `  ${c.file}` : ''}`)}`);
  out.push('', style.bold(`Resources (${book.resources.length})`) + (book.resources.length ? `  ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''));
  out.push('', style.bold('Fonts'));
  for (const f of families) {
    const tag = f.source.includes('fallback') ? style.yellow(f.source) : style.dim(f.source);
    out.push(`  ${f.family.padEnd(28)} ${tag}  ${style.dim(f.variants.join(' '))}`);
  }
  await writeStdout(`${out.join('\n')}\n`);
}
