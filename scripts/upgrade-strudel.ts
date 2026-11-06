// Moves Kynska to the newest commit on Strudel's main branch, which strudel.cc
// deploys on every push, or to a given commit, then proves it:
//   node scripts/upgrade-strudel.ts [commit] [--if-changed]
// 1. finds main's head (or takes the commit given), fetches it and reads its date,
// 2. writes strudel.json,
// 3. links Strudel's packages from that commit into node_modules (building superdough),
// 4. rebuilds the docs and runs the type check, the tests, the three sweeps and the oracle evals.
// It leaves the changes in place for review, and exits 1 if any step failed.
// --if-changed stops at step 1, exit 0, when strudel.json already pins main's head.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PIN_FILE, ROOT } from '../src/paths.ts';
import { linkStrudel } from '../src/reference/link.ts';
import { pinName, readPin, type StrudelPin } from '../src/reference/pin.ts';
import { commitDate, fetchCommit } from '../src/reference/source.ts';
import { branchCommit } from '../src/reference/upstream.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'if-changed': { type: 'boolean', default: false } } });

const step = (n: number, text: string) => console.log(`\n[${n}] ${text}`);

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const pin = await readPin();
const commit = positionals[0] ?? (await branchCommit(pin.repository, pin.branch));
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error(`No commit to move to: give a full SHA, or check that ${pin.repository} has a ${pin.branch} branch.`);
  process.exit(1);
}
step(1, `Strudel ${pinName(pin)} -> ${commit.slice(0, 7)}`);
if (commit === pin.commit) {
  console.log('Already pinned: unchanged.');
  if (values['if-changed']) process.exit(0);
}
const source = await fetchCommit(pin.repository, commit);
const next: StrudelPin = { repository: pin.repository, branch: pin.branch, commit, date: await commitDate(source) };

step(2, `strudel.json: ${pinName(next)}`);
await writeFile(PIN_FILE, `${JSON.stringify(next, null, 2)}\n`);

step(3, 'link the packages');
try {
  console.log(`linked ${(await linkStrudel(next)).linked.join(', ')}`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const checks: [string, string, string[]][] = [
  ['docs build', 'node', ['src/cli.ts', 'docs', 'build']],
  ['type check and tests', 'npm', ['run', '-s', 'check']],
  ['check on documented examples', 'node', ['scripts/check-examples.ts']],
  ['check on docs code blocks', 'node', ['scripts/check-docs.ts']],
  ['onset detection', 'node', ['scripts/score-onsets.ts']],
  ['oracle evals', 'node', ['evals/run.ts', '--agent', 'oracle']],
];
const results: [string, number][] = [];
for (const [i, [name, command, args]] of checks.entries()) {
  step(4 + i, name);
  results.push([name, await run(command, args)]);
}
console.log('\nSummary:');
for (const [name, code] of results) console.log(`  ${code === 0 ? 'ok  ' : 'FAIL'} ${name}`);
process.exit(results.every(([, code]) => code === 0) ? 0 : 1);
