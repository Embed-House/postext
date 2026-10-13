// Layout benchmark (#779): lays each book out
// the way `postext check` does (Skia measuring, chapter by chapter), a
// number of times, and prints the time of each run, the peak memory and a
// hash of the VDT, so that a change to the engine can be judged on speed
// and on output that must not move.
//
//   bun scripts/bench-layout.ts [--runs N] [--warm] [--json] <book> [<book> …]
//
// Each run lays the book out on a fresh measurement cache (cold) unless
// --warm, which reuses the first run's cache (what the Sandbox's worker
// sees after the first build).

import { createMeasurementCache, type MeasurementCache } from 'postext';
import { Options } from '../src/args';
import type { CommandContext } from '../src/context';
import { layOut } from '../src/layout';
import { Reporter } from '../src/log';
import { openBook } from '../src/session';
import { vdtHash } from './vdtHash';

const argv = process.argv.slice(2);
let runs = 3;
let warm = false;
let json = false;
const books: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === '--runs') runs = Number(argv[++i]);
  else if (a === '--warm') warm = true;
  else if (a === '--json') json = true;
  else books.push(a);
}

process.env.DISABLE_SYSTEM_FONTS_LOAD = '1';
await import('../src/env');

const r2 = (n: number) => Math.round(n * 100) / 100;

const results = [];
for (const path of books) {
  const opts = new Options({});
  const reporter = new Reporter('quiet', true);
  const ctx: CommandContext = { command: 'check', inputs: [path], opts, reporter };
  const { book, fonts } = await openBook(ctx);
  const times: number[] = [];
  let hash = '';
  let pages = 0;
  let cache: MeasurementCache | undefined;
  for (let i = 0; i < runs; i++) {
    if (!warm || !cache) cache = createMeasurementCache();
    const t0 = performance.now();
    const layout = await layOut(book, opts, reporter, cache, fonts);
    times.push(performance.now() - t0);
    const h = vdtHash(layout.docs);
    if (hash && h !== hash) process.stderr.write(`${book.name}: run ${i + 1} hash ${h} differs from ${hash}\n`);
    hash = h;
    pages = layout.pageCount;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const row = {
    book: book.name,
    pages,
    chapters: book.chapters.length,
    runs: times.map((t) => Math.round(t)),
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]!),
    msPerPage: r2(sorted[Math.floor(sorted.length / 2)]! / pages),
    rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
    hash,
  };
  results.push(row);
  if (!json) process.stdout.write(`${row.book}: ${row.pages} pp, median ${row.medianMs} ms (${row.msPerPage} ms/page) runs ${row.runs.join(' ')} rss ${row.rssMB} MB hash ${row.hash}\n`);
}
if (json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
