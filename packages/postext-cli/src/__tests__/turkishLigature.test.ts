import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAIN = resolve(import.meta.dir, '..', 'main.ts');
const cmd = process.env.POSTEXT_BIN ? [resolve(process.env.POSTEXT_BIN)] : [process.execPath, MAIN];
const FIXTURE = resolve(import.meta.dir, 'fixtures', 'turkish-ligature');
const FI = 'ﬁ';

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('D17 yeniden üretim: Türkçe belgede fi ligatürü', () => {
  it.skipIf(!hasPdftotext)('a Turkish book prints fi apart, and its text reads as written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postext-d17-'));
    cpSync(FIXTURE, dir, { recursive: true });
    const r = Bun.spawnSync([...cmd, 'pdf', 'book.md', '--config', 'config.json', '-o', 'out.pdf', '--offline', '-q'], { cwd: dir, env: { ...process.env, NO_COLOR: '1', POSTEXT_CACHE_DIR: join(dir, '.cache') } });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(dir, 'out.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    const text = execFileSync('pdftotext', [join(dir, 'out.pdf'), '-'], { encoding: 'utf8' });
    expect(text).toContain('fikir fıkıh Hanefî fiil Afife');
    expect(text).not.toContain(FI);
  }, 60_000);
});
