// Builds out/reference.json: fetch Strudel at the pinned commit, read its JSDoc
// with Kynska's own plugin, and keep the user-facing functions.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CACHE_DIR, REFERENCE_FILE } from '../paths.ts';
import { ensureScope } from '../patterns/scope.ts';
import { browserOnlyNames } from './browser-names.ts';
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

/** A shallow checkout of one commit, fetched by its SHA and reused when already present. */
export async function fetchCommit(repository: string, commit: string, cacheDir = CACHE_DIR): Promise<string> {
  const dir = join(cacheDir, 'strudel', commit);
  if ((await headOf(dir)) === commit) return dir;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await run('git', ['-C', dir, 'init', '--quiet']);
  await run('git', ['-C', dir, 'fetch', '--quiet', '--depth', '1', repository, commit]);
  await run('git', ['-C', dir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD']);
  const head = await headOf(dir);
  if (head !== commit) throw new Error(`fetched ${head} from ${repository}, expected ${commit}`);
  return dir;
}

/** A shallow checkout of Strudel at the pinned release commit. */
export function fetchStrudel(pin: StrudelPin, cacheDir = CACHE_DIR): Promise<string> {
  return fetchCommit(pin.repository, pin.commit, cacheDir);
}

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
  const installed = createRequire(import.meta.url)('@strudel/core/package.json').version as string;
  if (installed !== pin.version) {
    throw new Error(`strudel.json pins ${pin.version} but @strudel/core ${installed} is installed; keep them in step`);
  }
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
  if (pin.tagsCommit && pin.tagsCommit !== pin.commit) {
    // Function categories from a later commit, matched by name; the rest of
    // each entry stays as the pinned release documents it.
    const later = await readDoclets(await fetchCommit(pin.repository, pin.tagsCommit));
    const tagsByName = new Map<string, string[]>();
    for (const d of later) {
      if (d.undocumented || !d.kynskaTags?.length) continue;
      for (const key of [d.name, d.longname]) if (key && !tagsByName.has(key)) tagsByName.set(key, [...new Set(d.kynskaTags)]);
    }
    let filled = 0;
    for (const entry of reference.functions) {
      if (entry.tags.length) continue;
      const tags = tagsByName.get(entry.longname) ?? tagsByName.get(entry.name);
      if (tags) {
        entry.tags = tags;
        filled++;
      }
    }
    if (filled) reference.strudel.tagsFrom = pin.tagsCommit;
  }
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(reference, null, 2)}\n`);
  return reference;
}

export function referenceExists(file = REFERENCE_FILE): boolean {
  return existsSync(file);
}
