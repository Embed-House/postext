#!/usr/bin/env node
// Sync the repository's labels with .github/labels.json through the gh CLI.
// A label missing under its name but present under one of its `from` names
// is renamed, so the issues that carry it keep it. --prune deletes labels
// the catalogue does not list; --dry-run prints what would change.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const prune = args.has('--prune');
const catalogue = JSON.parse(
  readFileSync(fileURLToPath(new URL('../labels.json', import.meta.url)), 'utf8'),
).labels;

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });
const repo = gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner').trim();
const current = JSON.parse(gh('api', '--paginate', `repos/${repo}/labels?per_page=100`));
const byName = new Map(current.map((l) => [l.name.toLowerCase(), l]));

const run = (what, ...a) => {
  console.log(what);
  if (!dryRun) gh('api', ...a);
};
const path = (name) => `repos/${repo}/labels/${encodeURIComponent(name)}`;

for (const { name, color, description, from = [] } of catalogue) {
  const existing = byName.get(name.toLowerCase());
  const old = !existing && from.map((f) => byName.get(f.toLowerCase())).find(Boolean);
  if (old) {
    run(`rename  ${old.name} → ${name}`, '-X', 'PATCH', path(old.name),
      '-f', `new_name=${name}`, '-f', `color=${color}`, '-f', `description=${description}`);
    byName.delete(old.name.toLowerCase());
  } else if (!existing) {
    run(`create  ${name}`, '-X', 'POST', `repos/${repo}/labels`,
      '-f', `name=${name}`, '-f', `color=${color}`, '-f', `description=${description}`);
  } else if (existing.color.toLowerCase() !== color || (existing.description ?? '') !== description) {
    run(`update  ${name}`, '-X', 'PATCH', path(existing.name),
      '-f', `color=${color}`, '-f', `description=${description}`);
  }
  byName.delete(name.toLowerCase());
}

for (const l of byName.values()) {
  if (prune) run(`delete  ${l.name}`, '-X', 'DELETE', path(l.name));
  else console.log(`extra   ${l.name} (not in the catalogue; --prune deletes it)`);
}
