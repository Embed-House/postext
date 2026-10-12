/**
 * Which Chrome the capture and the Sandbox check run on (#746).
 *
 * A recipe's pages are what a reader's browser lays out, so they are
 * captured on a current Chrome. Chrome shapes text otherwise from one
 * release to another: since a canvas has a language (`ctx.lang`, 136), a
 * run of digits is shaped in a script and a language where it had none, and
 * Google's cuts of the Noto CJK families set other digits and another
 * ellipsis under each (`locl`: 1 is 471 units wide in Noto Serif SC with no
 * script, 550 as Latin text of a language the font has no forms for); and
 * Fira Sans lost the kerning of a digit before a full stop, a comma or a
 * hyphen between 131 and 152. The recipes captured on Chrome 131 laid out
 * on 152 and 154 with ten editions broken at other words and eleven set to
 * other widths, on every machine: the Chrome for Testing in Puppeteer's
 * cache is whichever was installed once, and nothing said it was two years
 * old.
 *
 * Run by Node's type stripping: erasable TypeScript, relative `.ts` imports.
 */
import fs from "node:fs";

/** The oldest Chrome a capture or a Sandbox check runs on: the oldest
 *  release the editions were compared on and found alike (152, the macOS
 *  runner's, and 154). */
export const OLDEST_CHROME = 152;

/** Where a Chrome that updates itself is installed, by platform. */
const INSTALLED: Record<string, string[]> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
};

/** "131.0.6778.204" → 131; NaN for what is not a version. */
export function chromeMajor(version: string): number {
  return Number(/^(\d+)\./.exec(version.trim())?.[1] ?? NaN);
}

/** Whether `version` is older than {@link OLDEST_CHROME}. A version that
 *  does not read as one is not judged. */
export function chromeTooOld(version: string): boolean {
  const major = chromeMajor(version);
  return Number.isFinite(major) && major < OLDEST_CHROME;
}

/** What to do about a Chrome that is too old, or about none. */
export const CHROME_HELP =
  "install a current Chrome for Testing with `npx @puppeteer/browsers install chrome@stable`, or set COOKBOOK_CHROME to a Chrome " +
  `${OLDEST_CHROME} or newer`;

/** Why a run on Chrome `version` is refused. */
export function tooOldMessage(version: string, file: string): string {
  return `Chrome ${version} (${file}) is older than ${OLDEST_CHROME}, and lays text out as no current browser does ` +
    `(digits and their punctuation are shaped otherwise since a canvas has a language): ${CHROME_HELP}.`;
}

export interface ChromeChoice {
  file: string;
  /** Known before launch only for a Chrome for Testing (its folder says). */
  version?: string;
  from: "COOKBOOK_CHROME" | "puppeteer" | "installed";
}

/**
 * The Chrome to launch: COOKBOOK_CHROME when set; else the newest Chrome
 * for Testing in Puppeteer's cache when it is {@link OLDEST_CHROME} or
 * newer; else the Chrome installed on the machine, which keeps itself
 * current. Null when there is none: an old cached one is not a choice.
 * `cached` is newest first.
 */
export function pickChrome(
  { env, cached, installed }: { env?: string; cached: readonly { file: string; version: string }[]; installed: readonly string[] },
): ChromeChoice | null {
  if (env) return { file: env, from: "COOKBOOK_CHROME" };
  const newest = cached[0];
  if (newest && !chromeTooOld(newest.version)) return { file: newest.file, version: newest.version, from: "puppeteer" };
  const own = installed[0];
  if (own) return { file: own, from: "installed" };
  return null;
}

/** The installed Chromes of this machine that exist. */
export function installedChromes(platform: string = process.platform): string[] {
  return (INSTALLED[platform] ?? []).filter((file) => fs.existsSync(file));
}
