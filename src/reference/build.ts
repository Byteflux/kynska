// Builds out/reference.json: fetch Strudel at the pinned commit, read its JSDoc
// with Kynska's own plugin, and keep the user-facing functions.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CACHE_DIR, REFERENCE_FILE } from '../paths.ts';
import { ensureScope } from '../patterns/scope.ts';
import { readPin, type StrudelPin } from './pin.ts';
import { toReference, type Doclet } from './transform.ts';
import type { Reference } from './types.ts';

const run = promisify(execFile);
const PLUGIN = fileURLToPath(new URL('./jsdoc-plugin.cjs', import.meta.url));
const JSDOC = createRequire(import.meta.url).resolve('jsdoc/jsdoc.js');

async function headOf(dir: string): Promise<string | undefined> {
  try {
    return (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
  } catch {
    return undefined;
  }
}

/** A shallow checkout of Strudel at the pinned commit, reused when already present. */
export async function fetchStrudel(pin: StrudelPin, cacheDir = CACHE_DIR): Promise<string> {
  const dir = join(cacheDir, 'strudel', pin.commit);
  if ((await headOf(dir)) === pin.commit) return dir;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  await run('git', ['clone', '--quiet', '--depth', '1', '--branch', pin.tag, '-c', 'advice.detachedHead=false', pin.repository, dir]);
  const head = await headOf(dir);
  if (head !== pin.commit) {
    throw new Error(`${pin.repository} tag ${pin.tag} is at ${head}, but strudel.json pins ${pin.commit}`);
  }
  return dir;
}

/** Runs `jsdoc -X` over Strudel's packages and returns every doclet. */
export async function readDoclets(sourceRoot: string, cacheDir = CACHE_DIR): Promise<Doclet[]> {
  const config = join(cacheDir, 'jsdoc.json');
  const output = join(cacheDir, 'doclets.json');
  await writeFile(
    config,
    JSON.stringify({
      source: {
        includePattern: '.+\\.(js(doc|x)?|mjs)$',
        excludePattern: 'node_modules|shift-parser|shift-reducer|shift-traverser|dist',
      },
      plugins: [PLUGIN],
      opts: { recurse: true },
    }),
  );
  const out = await open(output, 'w');
  try {
    await new Promise<void>((resolve, reject) => {
      const stderr: Buffer[] = [];
      const child = spawn(process.execPath, [JSDOC, '-X', '-c', config, join(sourceRoot, 'packages')], {
        stdio: ['ignore', out.fd, 'pipe'],
      });
      child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`jsdoc exited with ${code}: ${Buffer.concat(stderr).toString().trim()}`)),
      );
    });
  } finally {
    await out.close();
  }
  return JSON.parse(await readFile(output, 'utf8')) as Doclet[];
}

export async function buildReference(outFile = REFERENCE_FILE): Promise<Reference> {
  const pin = await readPin();
  const installed = createRequire(import.meta.url)('@strudel/core/package.json').version as string;
  if (installed !== pin.version) {
    throw new Error(`strudel.json pins ${pin.version} but @strudel/core ${installed} is installed; keep them in step`);
  }
  const sourceRoot = await fetchStrudel(pin);
  const doclets = await readDoclets(sourceRoot);
  const { strudelGlobals, patternMethods } = await ensureScope();
  const reference = toReference(doclets, {
    pin,
    sourceRoot,
    isGlobal: (name) => strudelGlobals.has(name),
    isMethod: (name) => patternMethods.has(name),
  });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(reference, null, 2)}\n`);
  return reference;
}

export function referenceExists(file = REFERENCE_FILE): boolean {
  return existsSync(file);
}
