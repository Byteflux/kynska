// Tidal notation (`await initTidal()` then tidal`...`), as on strudel.cc. The
// @strudel/tidal on npm is older than Strudel 1.2.6 (0.1.0, built for core
// 1.1.0), so the package is loaded from the pinned Strudel source in .cache/,
// with its Haskell parser (web-tree-sitter plus the tree-sitter-haskell grammar,
// fetched once from npm into .cache/tidal/).
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { CACHE_DIR } from '../paths.ts';

/** The grammar build hs2js expects (its package.json pins ^0.23.1); npm ships it prebuilt. */
const GRAMMAR = { name: 'tree-sitter-haskell', version: '0.23.1', file: 'package/tree-sitter-haskell.wasm' };

/** One file out of a tar archive. */
export function untar(tar: Buffer, wanted: string): Buffer | undefined {
  const field = (from: number, to: number) => tar.toString('utf8', from, to).replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const name = field(offset, offset + 100);
    if (!name) break;
    const prefix = field(offset + 345, offset + 500);
    const size = parseInt(field(offset + 124, offset + 136).trim() || '0', 8);
    const body = offset + 512;
    if ((prefix ? `${prefix}/${name}` : name) === wanted) return tar.subarray(body, body + size);
    offset = body + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

/** A directory with tree-sitter.wasm and tree-sitter-haskell.wasm side by side, as hs2js expects. */
async function grammarDir(): Promise<string> {
  const dir = join(CACHE_DIR, 'tidal');
  const haskell = join(dir, 'tree-sitter-haskell.wasm');
  const runtime = join(dir, 'tree-sitter.wasm');
  await mkdir(dir, { recursive: true });
  if (!existsSync(haskell)) {
    const url = `https://registry.npmjs.org/${GRAMMAR.name}/-/${GRAMMAR.name}-${GRAMMAR.version}.tgz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`could not download the Haskell grammar for Tidal: ${response.status} ${url}`);
    const wasm = untar(gunzipSync(Buffer.from(await response.arrayBuffer())), GRAMMAR.file);
    if (!wasm) throw new Error(`${url} has no ${GRAMMAR.file}`);
    await writeFile(haskell, wasm);
  }
  if (!existsSync(runtime)) {
    const pkg = createRequire(import.meta.url).resolve('web-tree-sitter/package.json');
    await copyFile(join(dirname(pkg), 'tree-sitter.wasm'), runtime);
  }
  return dir;
}

let loading: Promise<any> | undefined;

function loadTidal(): Promise<any> {
  loading ??= (async () => {
    // Imported here, not at the top: the reference build imports the pattern scope.
    const { readPin } = await import('../reference/pin.ts');
    const { fetchStrudel } = await import('../reference/build.ts');
    const source = await fetchStrudel(await readPin());
    const hs2js = pathToFileURL(join(source, 'packages', 'hs2js', 'src', 'index.mjs')).href;
    registerHooks({
      resolve: (specifier, context, next) => (specifier === 'hs2js' ? { url: hs2js, shortCircuit: true } : next(specifier, context)),
    });
    (await import(hs2js)).setBase(`${await grammarDir()}/`);
    // tidal() looks Haskell names up on `window` and initTidal() defines d1..d9
    // there. A stand-in that inherits the global scope (where Strudel's functions
    // are) and has no-op event methods, for code that sees `window` and assumes a
    // browser (Strudel's keyboard input, superdough's messages).
    if (!('window' in globalThis)) {
      const window = Object.create(globalThis);
      window.addEventListener = () => {};
      window.removeEventListener = () => {};
      (globalThis as any).window = window;
    }
    return import(pathToFileURL(join(source, 'packages', 'tidal', 'tidal.mjs')).href);
  })();
  return loading;
}

let tidalModule: any;

/** strudel.cc's initTidal(): loads the Haskell parser. Await it before using tidal`...`. */
export async function initTidal(): Promise<unknown> {
  tidalModule = await loadTidal();
  return tidalModule.initTidal();
}

/** strudel.cc's tidal`...`: a pattern written in Tidal notation. */
export function tidalFunction(code: string | string[], offset = 0): unknown {
  if (!tidalModule) throw new Error('Tidal notation needs `await initTidal()` first, as on strudel.cc.');
  return tidalModule.tidal(code, offset);
}
