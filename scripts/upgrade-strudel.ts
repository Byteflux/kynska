// Moves Kynska to another Strudel release in one step, then proves it:
//   node scripts/upgrade-strudel.ts [version] [--tags-commit <sha>|main|none]
// 1. checks npm has the version for every pinned package and finds the release's commit,
// 2. writes strudel.json (tags from Strudel main unless told otherwise),
// 3. installs the packages at exactly that version (and Mondo's at the versions that release uses),
// 4. rebuilds the docs and runs the type check, the tests and the three sweeps.
// It leaves the changes in place for review, and exits 1 if any step failed.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PIN_FILE, ROOT } from '../src/paths.ts';
import { fetchCommit } from '../src/reference/build.ts';
import { readPin } from '../src/reference/pin.ts';
import { hasVersion, latestVersion, mainCommit, PINNED_PACKAGES, releaseCommit } from '../src/reference/upstream.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'tags-commit': { type: 'string', default: 'main' } },
});

const step = (n: number, text: string) => console.log(`\n[${n}] ${text}`);

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const pin = await readPin();
const version = positionals[0] ?? (await latestVersion('@strudel/core'));
step(1, `Strudel ${pin.version} -> ${version}`);
const missing = [];
for (const pkg of PINNED_PACKAGES) if (!(await hasVersion(pkg, version))) missing.push(pkg);
if (missing.length) {
  console.error(`npm has no ${version} of: ${missing.join(', ')}. Not upgrading.`);
  process.exit(1);
}
const commit = await releaseCommit(pin.repository, version);
if (!commit) {
  console.error(`No tag @strudel/core@${version} in ${pin.repository}. Not upgrading.`);
  process.exit(1);
}
// Mondo's packages carry their own version numbers; take them from the release's source.
const source = await fetchCommit(pin.repository, commit);
const mondoPackages: string[] = [];
for (const dir of ['mondough', 'mondo']) {
  const { name, version: v } = JSON.parse(await readFile(join(source, 'packages', dir, 'package.json'), 'utf8')) as { name: string; version: string };
  if (!(await hasVersion(name, v))) {
    console.error(`npm has no ${name}@${v}, which Strudel ${version} uses. Not upgrading.`);
    process.exit(1);
  }
  mondoPackages.push(`${name}@${v}`);
}
const tagsOption = values['tags-commit']!;
const tagsCommit = tagsOption === 'none' ? undefined : tagsOption === 'main' ? await mainCommit(pin.repository) : tagsOption;
console.log(`release commit ${commit}${tagsCommit ? `, tags from ${tagsCommit}` : ''}`);

step(2, 'strudel.json');
const next = { version, repository: pin.repository, tag: `@strudel/core@${version}`, commit, ...(tagsCommit ? { tagsCommit } : {}) };
await writeFile(PIN_FILE, `${JSON.stringify(next, null, 2)}\n`);

const installs = [...PINNED_PACKAGES.map((p) => `${p}@${version}`), ...mondoPackages];
step(3, `npm install ${installs.join(' ')}`);
if ((await run('npm', ['install', '--save-exact', ...installs])) !== 0) {
  console.error('npm install failed; strudel.json is updated, package.json may not be.');
  process.exit(1);
}

const checks: [string, string, string[]][] = [
  ['docs build', 'node', ['src/cli.ts', 'docs', 'build']],
  ['type check and tests', 'npm', ['run', '-s', 'check']],
  ['check on documented examples', 'node', ['scripts/check-examples.ts']],
  ['check on docs code blocks', 'node', ['scripts/check-docs.ts']],
  ['onset detection', 'node', ['scripts/score-onsets.ts']],
];
const results: [string, number][] = [];
for (const [i, [name, command, args]] of checks.entries()) {
  step(4 + i, name);
  results.push([name, await run(command, args)]);
}
console.log('\nSummary:');
for (const [name, code] of results) console.log(`  ${code === 0 ? 'ok  ' : 'FAIL'} ${name}`);
console.log('Review the changes (git diff) before committing.');
process.exit(results.every(([, code]) => code === 0) ? 0 : 1);
