import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The WOFF2 decoder module the build writes into dist, written into src
 *  for the tests (src/woff2Binding.js, ignored by git). */
export default function setup(): void {
  execFileSync(process.execPath, [fileURLToPath(new URL('./scripts/woff2-binding.mjs', import.meta.url)), 'src']);
}
