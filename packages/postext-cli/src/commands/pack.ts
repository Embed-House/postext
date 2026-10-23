import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createBundle, isBundleManifest, mimeForFile, zipBundle } from 'postext/bundle';
import { CliError, UsageError } from '../args';
import type { CommandContext } from '../context';
import { inputKind, isProjectOnlyFile, looseBundleInput, readTree } from '../input';
import { byteLength, writeOut } from '../io';
import { COVER_PATH, firstPageCover } from '../outputs/cover';

/** Zip a book folder as it is, or loose Markdown through `createBundle`.
 *  A book that names no cover gets its first page as one (#1210), unless
 *  --no-auto-thumbnail. */
export default async function pack(ctx: CommandContext): Promise<void> {
  const { opts, reporter, inputs } = ctx;
  const autoCover = opts.flag('auto-thumbnail') !== false;
  if (inputs.length === 0) throw new UsageError('Give a book folder (with preset.json) or Markdown files to pack');
  const kind = inputKind(inputs);
  if (kind === 'bundle') throw new UsageError(`${inputs[0]} is packed already`);
  let bytes: Uint8Array;
  let name: string;
  if (kind === 'folder') {
    const dir = inputs[0]!;
    // The book's files, without the project's sources, scripts and notes.
    const files = new Map([...readTree(dir)].filter(([rel]) => !isProjectOnlyFile(rel)));
    const manifest = JSON.parse(new TextDecoder().decode(files.get('preset.json')!)) as unknown;
    if (!isBundleManifest(manifest)) throw new CliError(`${dir}/preset.json is not a postext manifest`);
    // A fixed date: the same folder always packs to the same bytes.
    const zip = () => zipBundle(Object.fromEntries(files), { mtime: new Date(1980, 0, 1) });
    bytes = zip();
    if (autoCover && !(manifest.thumbnail && files.has(manifest.thumbnail)) && !files.has(COVER_PATH)) {
      const cover = await firstPageCover(ctx, bytes);
      if (cover) {
        files.set(COVER_PATH, cover.data);
        files.set('preset.json', new TextEncoder().encode(`${JSON.stringify({ ...manifest, thumbnail: COVER_PATH }, null, 2)}\n`));
        bytes = zip();
      }
    }
    name = basename(resolve(dir));
  } else {
    const input = await looseBundleInput(inputs, opts);
    const thumbnail = opts.string('thumbnail');
    const create = (cover?: { data: Uint8Array; mime: string }) => createBundle({
      ...input,
      ...(opts.string('id') ? { id: opts.string('id') } : {}),
      ...(opts.string('description') ? { description: opts.string('description') } : {}),
      ...(cover ? { thumbnail: cover } : {}),
    });
    let created = await create(thumbnail ? { data: new Uint8Array(readFileSync(thumbnail)), mime: mimeForFile(thumbnail) } : undefined);
    if (!thumbnail && autoCover) {
      const cover = await firstPageCover(ctx, created.bytes);
      if (cover) created = await create(cover);
    }
    for (const w of created.warnings) reporter.warn({ kind: 'bundle', severity: 'warning', message: w });
    bytes = created.bytes;
    name = inputs.length === 1 ? basename(resolve(inputs[0]!)).replace(/\.[^.]*$/, '') : created.manifest.id;
  }
  const out = opts.string('out') ?? `${name}.postext`;
  await writeOut(out, bytes);
  reporter.output({ kind: 'postext', path: out, bytes: byteLength(bytes) });
}
