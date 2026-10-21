// The hash Turbo gives a task of one or more packages, one hash for all of
// them: what their files, their dependencies' files and the lockfile are
// (#1118). CI keeps a marker under that hash once the task passed, and a
// later run with the same hash skips it.
//
//   node .github/scripts/turbo-hash.mjs <task> <package> [<package>…]

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [task, ...packages] = process.argv.slice(2);
if (!task || packages.length === 0) {
  console.error('usage: turbo-hash.mjs <task> <package> [<package>…]');
  process.exit(2);
}
const args = ['turbo', 'run', task, ...packages.map((p) => `--filter=${p}`), '--dry=json'];
const dry = JSON.parse(execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const hashes = packages.map((p) => {
  const found = dry.tasks.find((t) => t.taskId === `${p}#${task}`);
  if (!found) throw new Error(`no ${p}#${task} in turbo's dry run`);
  return `${p}#${task}=${found.hash}`;
});
console.log(createHash('sha256').update(hashes.join('\n')).digest('hex').slice(0, 24));
