// End to end: the CLI run from its sources on a small book of loose
// Markdown (default fonts, no network). With POSTEXT_BIN set, the same
// runs against a built executable.
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAIN = resolve(import.meta.dir, '..', 'main.ts');
const cmd = process.env.POSTEXT_BIN ? [resolve(process.env.POSTEXT_BIN)] : [process.execPath, MAIN];

function run(args: string[], cwd: string) {
  const r = Bun.spawnSync([...cmd, ...args], { cwd, env: { ...process.env, NO_COLOR: '1', POSTEXT_CACHE_DIR: join(cwd, '.cache') } });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function book(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postext-cli-'));
  mkdirSync(join(dir, 'ch'));
  writeFileSync(join(dir, 'ch', '01.md'), '---\ntitle: Test book\nauthor: A. Writer\n---\n\n# One\n\nSome *text* with **weight** and a formula $a^2 + b^2 = c^2$.\n');
  writeFileSync(join(dir, 'ch', '02.md'), '# Two\n\nMore text.\n\n- a\n- b\n');
  return dir;
}

describe('postext cli', () => {
  it('prints the help with no arguments', () => {
    const r = run([], tmpdir());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage');
    for (const c of ['pdf', 'html', 'epub', 'image', 'images', 'pack', 'unpack', 'import-docx']) expect(r.stdout).toContain(c);
  });

  it('exits 2 on wrong usage', () => {
    expect(run(['pfd'], tmpdir()).code).toBe(2);
    expect(run(['pdf', '--bogus'], tmpdir()).code).toBe(2);
    expect(run(['pdf'], tmpdir()).code).toBe(2);
  });

  it('writes a PDF, HTML, EPUB, page images and Word from one layout', () => {
    const dir = book();
    const r = run(['build', 'ch', '--pdf', 'out/b.pdf', '--html', 'out/b.html', '--epub', 'out/b.epub', '--images', 'out/p', '--dpi', '30', '--docx', 'out/b.docx', '--offline', '--json'], dir);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.ok).toBe(true);
    expect(report.pages).toBeGreaterThan(0);
    expect(readFileSync(join(dir, 'out/b.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    expect(readFileSync(join(dir, 'out/b.html'), 'utf8')).toContain('<!doctype html>');
    expect(readFileSync(join(dir, 'out/b.epub')).subarray(0, 2).toString()).toBe('PK');
    expect(readFileSync(join(dir, 'out/b.docx')).subarray(0, 2).toString()).toBe('PK');
    expect(existsSync(join(dir, 'out/p/page-001.png'))).toBe(true);
  }, 60_000);

  // #771: a raster inside an SVG picture, as `pdftocairo -svg` writes it.
  it('paints the rasters an SVG picture holds in the page images', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postext-cli-'));
    mkdirSync(join(dir, 'res'));
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const square = createCanvas(4, 4);
    const sq = square.getContext('2d');
    sq.fillStyle = '#dc1e1e';
    sq.fillRect(0, 0, 4, 4);
    const red = `data:image/png;base64,${(await square.encode('png')).toString('base64')}`;
    const open = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="60" height="60" viewBox="0 0 60 60">';
    writeFileSync(join(dir, 'res', 'a-href.svg'), `${open}<image href="${red}" width="60" height="60"/></svg>`);
    writeFileSync(join(dir, 'res', 'c-defs-use.svg'), `${open}<defs><image id="s" width="60" height="60" xlink:href="${red}"/></defs><use xlink:href="#s"/></svg>`);
    writeFileSync(join(dir, 'book.md'), '# Pictures\n\n::resource{id="a-href"}\n\n::resource{id="c-defs-use"}\n');
    expect(run(['pack', 'book.md', '--resources', 'res', '-o', 'b.postext', '-q', '--offline'], dir).code).toBe(0);
    expect(run(['images', 'b.postext', '-o', 'pages', '--dpi', '72', '-q', '--offline'], dir).code).toBe(0);
    const page = await loadImage(readFileSync(join(dir, 'pages', 'page-001.png')));
    const canvas = createCanvas(page.width, page.height);
    canvas.getContext('2d').drawImage(page, 0, 0);
    const { data } = canvas.getContext('2d').getImageData(0, 0, page.width, page.height);
    let reds = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) reds++;
    // Two squares of 60 × 60 px at 72 dpi or more; none before #771.
    expect(reds).toBeGreaterThan(2 * 50 * 50);
  }, 60_000);

  it('packs, unpacks and reads the bundle back', () => {
    const dir = book();
    expect(run(['pack', 'ch', '--name', 'Test', '-o', 'b.postext', '-q'], dir).code).toBe(0);
    const first = readFileSync(join(dir, 'b.postext'));
    expect(run(['pack', 'ch', '--name', 'Test', '-o', 'c.postext', '-q'], dir).code).toBe(0);
    expect(Buffer.compare(first, readFileSync(join(dir, 'c.postext')))).toBe(0);
    expect(run(['unpack', 'b.postext', '-o', 'u', '-q'], dir).code).toBe(0);
    expect(existsSync(join(dir, 'u', 'preset.json'))).toBe(true);
    const info = JSON.parse(run(['info', 'u', '--json', '--offline'], dir).stdout);
    expect(info.chapters).toHaveLength(2);
    expect(info.book.name).toBe('Test');
  }, 60_000);

  it('round-trips the Markdown through Word', () => {
    const dir = book();
    expect(run(['docx', 'ch', '-o', 'b.docx', '-q'], dir).code).toBe(0);
    expect(run(['import-docx', 'b.docx', '-o', 'back', '-q'], dir).code).toBe(0);
    const again = readFileSync(join(dir, 'back', 'chapters', '02-two.md'), 'utf8');
    expect(again).toContain('More text.');
  }, 60_000);

  // #932: the character spacing of Word's styles goes on the book's styles that set none.
  it('brings the character spacing of Word styles onto the book\'s styles that set none', () => {
    const dir = book();
    writeFileSync(join(dir, 'ch', '03.md'), '# Three\n\n:::paragraphs{style="firma"}\nSigned\n:::\n');
    const styled = { paragraphStyles: [{ id: 'firma', name: 'Firma', letterSpacing: { value: 0.05, unit: 'em' } }], headings: { levels: [{ level: 1, letterSpacing: { value: 0.02, unit: 'em' } }] } };
    writeFileSync(join(dir, 'styled.json'), JSON.stringify(styled));
    writeFileSync(join(dir, 'bare.json'), JSON.stringify({ paragraphStyles: [{ id: 'firma', name: 'Firma' }] }));
    expect(run(['docx', 'ch', '-o', 'b.docx', '--config', 'styled.json', '-q'], dir).code).toBe(0);
    const r = run(['import-docx', 'b.docx', '--config', 'bare.json', '-o', 'back', '--json'], dir);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).styleTracking.applied.sort()).toEqual(['Firma 0.05 em', 'heading 1 0.02 em']);
    const back = (JSON.parse(readFileSync(join(dir, 'back', 'preset.json'), 'utf8')) as { config: typeof styled }).config;
    expect(back.paragraphStyles[0]!.letterSpacing).toEqual({ value: 0.05, unit: 'em' });
    expect(back.headings.levels[0]).toEqual({ level: 1, letterSpacing: { value: 0.02, unit: 'em' } });
  }, 60_000);

  it('renders one page to stdout', () => {
    const dir = book();
    const r = Bun.spawnSync([...cmd, 'image', 'ch', '--page', '#1', '-o', '-', '--dpi', '20', '--offline', '-q'], { cwd: dir, env: { ...process.env, POSTEXT_CACHE_DIR: join(dir, '.cache') } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.subarray(1, 4).toString()).toBe('PNG');
  }, 60_000);

  // #695: `preset.json`'s `start` says where a book that is part of a longer
  // one starts; every command lays the book out from there.
  it('lays a book out from where its preset.json says it starts', () => {
    const dir = book();
    expect(run(['pack', 'ch', '--name', 'Test', '-o', 'b.postext', '-q'], dir).code).toBe(0);
    expect(run(['unpack', 'b.postext', '-o', 'u', '-q'], dir).code).toBe(0);
    const pages = (input: string, ...more: string[]) => {
      const report = JSON.parse(run(['info', input, '--pages', '--json', '--offline', ...more], dir).stdout);
      return { start: report.book.start, chapters: report.chapters.map((c: { pages?: number }) => c.pages) };
    };
    const plain = pages('u');
    expect(plain.start).toBeUndefined();
    // One page before the book: page 1 is a verso, and the chapter, which
    // opens on a recto, leaves it blank.
    const path = join(dir, 'u', 'preset.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...manifest, start: { pageIndexOffset: 1, pageNumbering: { startAt: 58 }, headings: { h1: 3 } } }));
    const started = pages('u');
    expect(started.start).toEqual({ pageIndexOffset: 1, pageNumbering: { startAt: 58 }, headings: { h1: 3, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 } });
    expect(started.chapters[0]).toBe(plain.chapters[0] + 1);
    expect(started.chapters[1]).toBe(plain.chapters[1]);
    // Packed again, the bundle carries it.
    expect(run(['pack', 'u', '-o', 's.postext', '-q'], dir).code).toBe(0);
    expect(pages('s.postext')).toEqual(started);
    const text = run(['info', 's.postext', '--offline'], dir).stdout;
    expect(text).toContain('starts after 1 page (page 1 is a verso), numbered from 58, after chapter 3');
    expect(run(['check', 's.postext', '--offline', '-q'], dir).code).toBe(0);
    // A selection that leaves the first chapter out starts at page 1.
    expect(pages('s.postext', '--chapters', '2').chapters).toEqual(pages('b.postext', '--chapters', '2').chapters);
  }, 60_000);

  // #891: each edition of a bundle in several languages under its own title.
  it('names the edition read with its localized title', () => {
    const dir = book();
    expect(run(['pack', 'ch', '--name', 'Geografía', '-o', 'b.postext', '-q'], dir).code).toBe(0);
    expect(run(['unpack', 'b.postext', '-o', 'u', '-q'], dir).code).toBe(0);
    const path = join(dir, 'u', 'preset.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...manifest, locale: 'es', description: 'Libro', localized: { ca: { name: 'Geografia', description: 'Llibre' }, en: { name: 'Geography' } } }));
    expect(run(['pack', 'u', '-o', 's.postext', '-q'], dir).code).toBe(0);
    const meta = (input: string, locale: string) => {
      const { book: b } = JSON.parse(run(['info', input, '--locale', locale, '--json', '--offline'], dir).stdout);
      return [b.name, b.description];
    };
    for (const input of ['u', 's.postext']) {
      expect(meta(input, 'ca')).toEqual(['Geografia', 'Llibre']);
      expect(meta(input, 'en')).toEqual(['Geography', 'Libro']);
      expect(meta(input, 'es')).toEqual(['Geografía', 'Libro']);
    }
    expect(run(['info', 's.postext', '--locale', 'ca', '--offline'], dir).stdout.split('\n')[0]).toBe('Geografia — Llibre');
  }, 60_000);

  // #696: a comic line may name its own face (`font=`). The book's fonts
  // are the configuration's and the ones its text names.
  it('resolves the face a comic line names in the text alone', () => {
    const dir = book();
    const families = () => JSON.parse(run(['info', 'ch', '--json', '--offline'], dir).stdout).fonts.map((f: { family: string }) => f.family);
    expect(families()).not.toContain('Dela Gothic One');
    writeFileSync(join(dir, 'ch', '03.md'), ':::page{split="*"}\n::panel\nrival{shout}: MEEEN!\nsfx{at="74% 30%" font="Dela Gothic One" vertical}: ドン\n:::\n');
    const withComic = families();
    expect(withComic).toContain('Dela Gothic One');
    // The lettering faces of a comic page were asked for already.
    expect(withComic).toContain('Comic Neue');
    // The same words outside a comic page name nothing.
    writeFileSync(join(dir, 'ch', '03.md'), '# Three\n\nA line that says font="Dela Gothic One".\n');
    expect(families()).not.toContain('Dela Gothic One');
  }, 60_000);

  // #741: a bold weight the configuration names is asked of the family, and
  // a weight the family ships that the set does not hold is reported (the
  // canvas measured the text with another face of the family).
  it('reports a weight the family ships when another face stood in for it', () => {
    const dir = book();
    const embeddedFace = (weight: number | string) => readFileSync(resolve(import.meta.dir, '..', '..', 'fonts', `OpenSans-${weight}.ttf`));
    mkdirSync(join(dir, 'fd'));
    for (const face of [400, '400i', 700]) writeFileSync(join(dir, 'fd', `OpenSans-${face}.ttf`), embeddedFace(face));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ bodyText: { fontFamily: 'Open Sans', boldFontWeight: 600 }, headings: { fontFamily: 'Open Sans' } }));
    const check = () => JSON.parse(run(['check', 'ch', '--config', 'config.json', '--font-dir', 'fd', '--offline', '--json'], dir).stdout) as { warnings: { kind: string; message: string }[] };
    // The folder holds 400, its italic and 700, and nothing says the family has more: a
    // weight a family does not ship is set in its nearest face on purpose.
    expect(check().warnings.filter((w) => w.kind === 'fontFallback')).toEqual([]);
    // The cache's record says the family ships a 600.
    mkdirSync(join(dir, '.cache', 'fonts', 'open-sans'), { recursive: true });
    writeFileSync(join(dir, '.cache', 'fonts', 'open-sans', 'meta.json'), JSON.stringify({ available: true, weights: [300, 400, 600, 700, 800], styles: ['normal', 'italic'], checkedAt: Date.now(), v: 2 }));
    const fallbacks = check().warnings.filter((w) => w.kind === 'fontFallback');
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.message).toContain('Open Sans 600');
    expect(fallbacks[0]!.message).toContain('set in its 700');
    // With the file in the folder the face is there and nothing is said.
    writeFileSync(join(dir, 'fd', 'OpenSans-600.ttf'), embeddedFace(600));
    expect(check().warnings.filter((w) => w.kind === 'fontFallback')).toEqual([]);
  }, 60_000);

  it('raises no fallback for a bold a one-weight family does not ship', () => {
    const dir = book();
    mkdirSync(join(dir, 'fd'));
    writeFileSync(join(dir, 'fd', 'OpenSans-400.ttf'), readFileSync(resolve(import.meta.dir, '..', '..', 'fonts', 'OpenSans-400.ttf')));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ bodyText: { fontFamily: 'Open Sans' }, headings: { fontFamily: 'Open Sans' } }));
    mkdirSync(join(dir, '.cache', 'fonts', 'open-sans'), { recursive: true });
    writeFileSync(join(dir, '.cache', 'fonts', 'open-sans', 'meta.json'), JSON.stringify({ available: true, weights: [400], styles: ['normal'], checkedAt: Date.now(), v: 2 }));
    const report = JSON.parse(run(['check', 'ch', '--config', 'config.json', '--font-dir', 'fd', '--offline', '--json'], dir).stdout) as { warnings: { kind: string }[] };
    expect(report.warnings.filter((w) => w.kind === 'fontFallback')).toEqual([]);
  }, 60_000);

  // #782: a rebuild lays out again only the chapters a change reaches and
  // paints only their pages; a changed picture lays out everything.
  it('rebuilds only what a change reaches in --watch', async () => {
    const dir = book();
    mkdirSync(join(dir, 'res'));
    const square = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${fill}"/></svg>`;
    writeFileSync(join(dir, 'res', 'sq.svg'), square('#c00'));
    writeFileSync(join(dir, 'ch', '03.md'), '# Three\n\n::resource{id="sq"}\n');
    const proc = Bun.spawn([...cmd, 'build', 'ch', '--resources', 'res', '--images', 'out', '--dpi', '20', '--offline', '--watch'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1', POSTEXT_CACHE_DIR: join(dir, '.cache') }, stderr: 'pipe', stdout: 'ignore',
    });
    const reader = proc.stderr.getReader();
    let log = '';
    /** The log from now until a line matching `re`. */
    const until = async (re: RegExp): Promise<string> => {
      const from = log.length;
      const deadline = Date.now() + 30_000;
      while (!re.test(log.slice(from))) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${re}:\n${log}`);
        const { value, done } = await reader.read();
        if (done) throw new Error(`exited:\n${log}`);
        log += new TextDecoder().decode(value);
      }
      return log.slice(from);
    };
    try {
      const first = await until(/watching/);
      expect(first).toMatch(/wrote \d+ PNG images/);
      const pages = readdirSync(join(dir, 'out')).sort();
      const stamp = () => pages.map((p) => statSync(join(dir, 'out', p)).mtimeMs);
      const before = stamp();
      writeFileSync(join(dir, 'ch', '02.md'), '# Two\n\nOther text.\n\n- a\n- b\n');
      const edit = await until(/rebuilt in/);
      expect(edit).toContain('1 of 3 chapters laid out');
      // Chapter two's pages only.
      const [, written, unchanged] = /wrote (\d+) PNG images .*, (\d+) unchanged/.exec(edit) ?? [];
      expect(Number(written) + Number(unchanged)).toBe(pages.length);
      expect(Number(unchanged)).toBeGreaterThan(0);
      // The first chapter's page is left as it was.
      expect(stamp()[0]).toBe(before[0]);
      const last = join(dir, 'out', pages[pages.length - 1]!);
      const red = readFileSync(last);
      writeFileSync(join(dir, 'res', 'sq.svg'), square('#00c'));
      const picture = await until(/rebuilt in/);
      expect(picture).not.toContain('chapters laid out');
      expect(picture).toMatch(new RegExp(`wrote ${pages.length} PNG images`));
      // The picture is drawn anew.
      expect(readFileSync(last).equals(red)).toBe(false);
    } finally {
      proc.kill('SIGINT');
      await proc.exited;
    }
  }, 90_000);

  // #939: a JSON report longer than the pipe's 64 KiB buffer reaches a reader
  // that starts late whole (the process used to exit with the pipe still full).
  it('writes a long --json report to a pipe without cutting it', async () => {
    const dir = book();
    writeFileSync(join(dir, 'ch', '03.md'), `# Three\n\n${Array.from({ length: 600 }, (_, i) => `::resource{id="nowhere${i}"}\n`).join('\n')}`);
    // A real OS pipe with a reader that starts late (`sleep`), as a Python
    // subprocess.run is.
    const proc = Bun.spawn(['sh', '-c', '"$@" | { sleep 3; cat; }', 'sh', ...cmd, 'check', 'ch', '--offline', '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1', POSTEXT_CACHE_DIR: join(dir, '.cache') }, stdout: 'pipe', stderr: 'ignore',
    });
    const text = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(text.length).toBeGreaterThan(70_000);
    const report = JSON.parse(text);
    expect(report.warnings.filter((w: { kind: string }) => w.kind === 'unknownResourceId').length).toBe(600);
    expect(report.exitCode).toBe(0);
  }, 60_000);

  it('check --strict fails on warnings with exit code 3', () => {
    const dir = book();
    writeFileSync(join(dir, 'ch', '03.md'), '# Three\n\n::resource{id="nowhere"}\n');
    const r = run(['check', 'ch', '--strict', '--offline', '--json'], dir);
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout).warnings.some((w: { kind: string }) => w.kind === 'unknownResourceId')).toBe(true);
    expect(run(['check', 'ch', '--offline', '-q'], dir).code).toBe(0);
  }, 60_000);

  // #856: a composed page whose first box grows reports it, in words and in --json.
  it('check reports the reflow log of a composed page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postext-cli-'));
    mkdirSync(join(dir, 'ch'));
    const mm = (value: number) => ({ value, unit: 'mm' });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      pageTemplates: [{
        id: 'boxes',
        frames: [{ name: 'a', minHeight: mm(10) }, { name: 'b', minHeight: mm(10) }],
        groups: [{ name: 'g', frames: ['a', 'b'], gap: mm(5) }],
      }],
    }));
    const text = 'Money lets us swap our work for the things we need, because everybody accepts what it is worth. '.repeat(12);
    writeFileSync(join(dir, 'ch', '01.md'), `::::page{template="boxes"}\n:::frame{slot="a"}\n${text}\n:::\n\n:::frame{slot="b"}\nB.\n:::\n::::\n`);
    const r = run(['check', 'ch', '--config', 'config.json', '--offline', '--json'], dir);
    expect(r.code).toBe(0);
    const reflow = JSON.parse(r.stdout).reflow as { template: string; events: { frame: string; kind: string; cause?: string }[]; lines: string[] }[];
    expect(reflow).toHaveLength(1);
    expect(reflow[0]!.template).toBe('boxes');
    expect(reflow[0]!.events.map((e) => `${e.frame} ${e.kind}`)).toEqual(['a grew', 'b moved']);
    expect(reflow[0]!.events[1]!.cause).toBe('a');
    expect(reflow[0]!.lines[0]).toMatch(/^a grew [\d.]+ mm$/);
    expect(r.stderr).toMatch(/reflow p\. \S+ \(boxes\): a grew [\d.]+ mm; b moved down [\d.]+ mm/);
  }, 60_000);

  // #1087: a `when` / `unless` on an attribute no page fence sets is a note.
  it('check notes a decoration condition no page of the book meets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postext-cli-'));
    mkdirSync(join(dir, 'ch'));
    const mm = (value: number) => ({ value, unit: 'mm' });
    const folio = { kind: 'text', id: 'folio', content: '{pageNumber}', placement: { anchor: { to: 'page', edge: 'bottom-center' }, offset: { y: mm(-8) } } };
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      pageTemplates: [{
        id: 'shell',
        frames: [{ name: 'texto', flow: true }],
        decoration: { elements: [{ ...folio, when: 'folio' }, { ...folio, id: 'band', unless: 'appendix' }] },
      }],
    }));
    writeFileSync(join(dir, 'ch', '01.md'), '::::page{template="shell" frontmatter}\nFront.\n::::\n\n::::page{template="shell" folio}\nBody.\n::::\n');
    const r = run(['check', 'ch', '--config', 'config.json', '--offline', '--json'], dir);
    expect(r.code).toBe(0);
    const notes = (JSON.parse(r.stdout).warnings as { kind: string; severity: string; data?: Record<string, unknown> }[]).filter((x) => x.kind === 'conditionNeverMet');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('info');
    expect(notes[0]!.data).toEqual({ path: 'pageTemplates[0].decoration.elements[1].unless', condition: 'unless', attribute: 'appendix' });
  }, 60_000);

  // #1124: a colour pair `contrast.allow` accepts is listed as accepted,
  // as a note, and is no warning for --strict.
  it('check lists an allowed contrast pair as accepted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postext-cli-'));
    mkdirSync(join(dir, 'ch'));
    const ochre = { hex: '#b7820f', model: 'hex' };
    const write = (allow: unknown[] | undefined) => writeFileSync(join(dir, 'config.json'), JSON.stringify({ bodyText: { color: ochre }, ...(allow ? { contrast: { allow } } : {}) }));
    writeFileSync(join(dir, 'ch', '01.md'), 'Ochre text on paper.\n');
    type Row = { kind: string; severity: string; message: string; data?: Record<string, unknown> };
    const contrastRows = () => {
      const r = run(['check', 'ch', '--config', 'config.json', '--offline', '--json'], dir);
      return (JSON.parse(r.stdout).warnings as Row[]).filter((x) => x.kind === 'contrast.lowContrast');
    };
    write(undefined);
    expect(contrastRows().map((x) => x.severity)).toEqual(['warning']);
    write([{ fg: '#b7820f', bg: '#ffffff', reason: 'The publisher\'s ochre' }]);
    const rows = contrastRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.severity).toBe('info');
    expect(rows[0]!.message).toMatch(/^accepted \(The publisher's ochre\): #b7820f on #ffffff/);
    expect(rows[0]!.data).toEqual({ accepted: { reason: 'The publisher\'s ochre', fg: '#b7820f', bg: '#ffffff' } });
    expect(run(['check', 'ch', '--config', 'config.json', '--strict', '--offline', '-q'], dir).code).toBe(0);
  }, 60_000);

  // #858: a frame whose text still does not fit names the steps tried and
  // the proposals, in words and, with their values, in --json.
  it('check prints frameOverflow with its proposals', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postext-cli-'));
    mkdirSync(join(dir, 'ch'));
    const mm = (value: number) => ({ value, unit: 'mm' });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      locale: 'en',
      pageTemplates: [{ id: 'small', frames: [{ name: 'a', flow: true, width: mm(60), height: mm(20) }] }],
    }));
    const text = 'Money lets us swap our work for the things we need, because everybody accepts what it is worth. '.repeat(8);
    writeFileSync(join(dir, 'ch', '01.md'), `::::page{template="small"}\n${text}\n::::\n`);
    const r = run(['check', 'ch', '--config', 'config.json', '--offline', '--json'], dir);
    const w = (JSON.parse(r.stdout).warnings as { kind: string; message: string; data?: Record<string, unknown> }[]).find((x) => x.kind === 'frameOverflow')!;
    expect(w.data).toMatchObject({ template: 'small', frame: 'a', locale: 'en', scale: 0.9, stepsTried: ['free', 'shrinkText'] });
    const kinds = (w.data!.proposals as { kind: string }[]).map((p) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(['allowShrink', 'raiseMax', 'continueNextPage', 'shortenText']));
    const raise = (w.data!.proposals as { kind: string; path?: string; value?: { value: number } }[]).find((p) => p.kind === 'raiseMax')!;
    expect(raise.path).toBe('/pageTemplates/0/frames/0/maxHeight');
    expect(raise.value!.value).toBeGreaterThan(20);
    expect(w.message).toContain('to fit: ');
    expect(r.stderr).toMatch(/frameOverflow.*Frame "a" of template "small" \(en\) is [\d.]+ mm short of its content after free space, text down to 90 %/);
  }, 60_000);

  // #1053: a caption under a picture frame, a tab under a cut-out photo, a
  // note past its card and text past the trim (the engine's fixture), in
  // words and, with the frames and fixes, in --json.
  it('check prints frameCovered and frameOutsideArea with their fixes', () => {
    const fixture = resolve(import.meta.dir, '..', '..', '..', 'postext', 'src', '__tests__', 'composed', 'fixtures', 'overlap');
    const r = run(['check', join(fixture, 'overlap.md'), '--config', join(fixture, 'config.json'), '--resources', join(fixture, 'res'), '--offline', '--json'], tmpdir());
    expect(r.code).toBe(0);
    type W = { kind: string; message: string; page?: string; data?: Record<string, unknown> };
    const ws = JSON.parse(r.stdout).warnings as W[];
    const covered = ws.filter((w) => w.kind === 'frameCovered').map((w) => `${w.data!.frame}<${w.data!.coveredBy}`).sort();
    expect(covered).toEqual(['card<cutout', 'figure<photo']);
    const caption = ws.find((w) => w.kind === 'frameCovered' && w.data!.frame === 'figure')!;
    expect(caption.data).toMatchObject({ template: 'overlaps', fenceIndex: 0, locale: 'en', coveredByPath: '/pageTemplates/0/frames/1' });
    expect(caption.data!.text).toMatch(/^Rainfall/);
    // Every move off the caption takes the photo out of the figure it is
    // anchored inside, so none is offered (#1075); the cut-out over the card
    // has a clear move.
    expect((caption.data!.proposals as { kind: string }[]).map((p) => p.kind)).not.toContain('move');
    const card = ws.find((w) => w.kind === 'frameCovered' && w.data!.frame === 'card')!;
    expect((card.data!.proposals as { kind: string }[]).map((p) => p.kind)).toContain('move');
    expect(caption.page).toBe('1');
    const past = ws.filter((w) => w.kind === 'frameOutsideArea').map((w) => `${w.data!.frame}>${w.data!.past}`).sort();
    expect(past).toEqual(['note>frame', 'strap>trim']);
    expect(r.stderr).toMatch(/frameCovered.*Frame "card" of template "overlaps" \(en\) lies under frame "cutout"/);
    expect(r.stderr).toMatch(/frameOutsideArea.*Frame "note" of template "overlaps" \(en\) runs [\d.]+ mm past the frame "card" it is anchored inside/);
  }, 60_000);

  // #943: a magazine kept as one chapter file per article. A story jumps from
  // its file into a page fence of a later file; the CLI lays the book out
  // chapter by chapter and hands the rest to the chapter that has the page.
  it('lays out a story that jumps into a page of a later chapter file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postext-cli-'));
    mkdirSync(join(dir, 'ch'));
    const mm = (value: number) => ({ value, unit: 'mm' });
    const top = { anchor: { to: 'container', edge: 'top-left' } };
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      locale: 'en',
      pageTemplates: [
        { id: 'article', frames: [{ name: 'body', flow: true, width: mm(120), height: mm(60), placement: top, overflow: { continueIn: 'page:{attr.next}', mark: 'Continued on page {page}' }, fit: { shrinkText: false } }] },
        { id: 'jump', frames: [{ name: 'head', flow: true, width: mm(120), height: mm(30), placement: top }, { name: 'rest', width: mm(120), placement: { anchor: { to: '#head', edge: 'below' }, offset: { y: mm(10) } } }] },
      ],
    }));
    const text = 'Money lets us swap our work for the things we need, because everybody accepts what it is worth. '.repeat(40);
    writeFileSync(join(dir, 'ch', '01.md'), `::::page{template="article" next="p9"}\n${text}\n::::\n`);
    writeFileSync(join(dir, 'ch', '02.md'), 'A chapter between.\n');
    writeFileSync(join(dir, 'ch', '03.md'), '::::page{template="jump" id="p9"}\nThe page the story goes on in.\n::::\n');
    const r = run(['check', 'ch', '--config', 'config.json', '--offline', '--json'], dir);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout) as { pages: number; warnings: { kind: string }[] };
    expect(report.warnings.filter((w) => w.kind === 'continueTargetMissing' || w.kind === 'frameOverflow')).toEqual([]);
    // One page for the article, one between, one for the page with the rest.
    expect(report.pages).toBe(3);
    // A name no later file has warns, and the rest goes on the next page.
    writeFileSync(join(dir, 'ch', '01.md'), `::::page{template="article" next="nowhere"}\n${text}\n::::\n`);
    const lost = JSON.parse(run(['check', 'ch', '--config', 'config.json', '--offline', '--json'], dir).stdout) as { pages: number; warnings: { kind: string; data?: { target: string } }[] };
    expect(lost.warnings.find((w) => w.kind === 'continueTargetMissing')!.data!.target).toBe('nowhere');
    expect(lost.pages).toBeGreaterThan(3);
  }, 60_000);
});
