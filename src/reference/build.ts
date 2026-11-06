// Builds out/reference.json: fetch Strudel at the pinned commit, read its JSDoc
// with Kynska's own plugin, and keep the user-facing functions.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_DIR, REFERENCE_FILE } from '../paths.ts';
import { ensureScope } from '../patterns/scope.ts';
import { browserOnlyNames } from './browser-names.ts';
import { assertLinked } from './link.ts';
import { readPin } from './pin.ts';
import { fetchStrudel } from './source.ts';
import { toReference, type Doclet } from './transform.ts';
import type { Reference } from './types.ts';

const PLUGIN = fileURLToPath(new URL('./jsdoc-plugin.cjs', import.meta.url));
const JSDOC = createRequire(import.meta.url).resolve('jsdoc/jsdoc.js');

export { fetchCommit, fetchStrudel } from './source.ts';

/** Runs `jsdoc -X` over Strudel's packages and returns every doclet. */
export async function readDoclets(sourceRoot: string, cacheDir = CACHE_DIR): Promise<Doclet[]> {
  const id = basename(sourceRoot);
  const config = join(cacheDir, `jsdoc-${id}.json`);
  const output = join(cacheDir, `doclets-${id}.json`);
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
  // The reference documents the code the tools run: the packages linked from the pinned commit.
  assertLinked(pin);
  const sourceRoot = await fetchStrudel(pin);
  const doclets = await readDoclets(sourceRoot);
  const { strudelGlobals, patternMethods } = await ensureScope();
  const reference: Reference = {
    ...toReference(doclets, {
      pin,
      sourceRoot,
      isGlobal: (name) => strudelGlobals.has(name),
      isMethod: (name) => patternMethods.has(name),
    }),
    browserOnly: await browserOnlyNames(sourceRoot),
  };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(reference, null, 2)}\n`);
  return reference;
}

export function referenceExists(file = REFERENCE_FILE): boolean {
  return existsSync(file);
}
