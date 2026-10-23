// The cover a bundle carries when it names none (#1210): the first page of
// its first chapter, laid out and painted here at a file manager's icon
// size, so Finder or Explorer can show the book as the file's icon.

import { createCanvas } from '@napi-rs/canvas';
import { Options } from '../args';
import type { CommandContext } from '../context';
import { resolveFonts } from '../fonts';
import { loadBundleBytes } from '../input';
import { layOut } from '../layout';
import { Reporter } from '../log';
import { bookPages, paintPage } from './images';

/** Long side of the cover, in pixels: what Finder asks a thumbnail
 *  extension for at its largest icon size. */
export const COVER_LONG_SIDE = 1024;

/** Where a generated cover goes in the bundle. */
export const COVER_PATH = 'thumbnail.jpg';

/** The first page of the book in `bytes` as a JPEG, trimmed of the
 *  crop-mark margin, {@link COVER_LONG_SIDE} pixels on its long side. Null,
 *  with a note, when it cannot be laid out or painted: a pack never fails
 *  over its cover. */
export async function firstPageCover(ctx: CommandContext, bytes: Uint8Array): Promise<{ data: Uint8Array; mime: string } | null> {
  const { opts, reporter } = ctx;
  // The layout's own warnings are `check`'s business, not a pack's.
  const quiet = new Reporter('quiet', true);
  try {
    const whole = await loadBundleBytes(bytes, opts);
    const book = { ...whole, chapters: whole.chapters.slice(0, 1) };
    const fonts = await resolveFonts(book, {
      fontDirs: opts.list('font-dir'),
      offline: opts.flag('offline') === true,
      ...(opts.string('cache-dir') ? { cacheDir: opts.string('cache-dir')! } : {}),
    }, quiet);
    const layout = await reporter.time('cover', () => layOut(book, new Options({}), quiet, undefined, fonts));
    const first = bookPages(layout)[0];
    if (!first) return null;
    const { doc, page } = first;
    const off = doc.trimOffset > 0 ? doc.trimOffset : 0;
    const w = page.width - 2 * off;
    const h = page.height - 2 * off;
    if (w <= 0 || h <= 0) return null;
    const scale = COVER_LONG_SIDE / Math.max(w, h);
    const painted = await paintPage(book, first, { format: 'jpeg', dpi: scale * (doc.config.page.dpi || 300), quality: 85, printPreview: false }, quiet);
    // On white (a page without a paper colour is transparent), cut to the
    // trimmed page.
    const out = createCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    const g = out.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(painted, off * scale, off * scale, w * scale, h * scale, 0, 0, out.width, out.height);
    return { data: new Uint8Array(await out.encode('jpeg', 85)), mime: 'image/jpeg' };
  } catch (err) {
    reporter.warn({ kind: 'cover', severity: 'info', message: `no cover painted from the first page: ${(err as Error).message}` });
    return null;
  }
}
