// Runs Strudel from source at the pinned commit on main, as strudel.cc does:
// links each package Kynska loads into node_modules from the fetched checkout.
// npm has only releases, which fall behind main by hundreds of commits.
//  - Most packages run as their source: each package.json's "main" is index.mjs.
//  - superdough imports its audio worklets through a Vite plugin
//    ("./worklets.mjs?audioworklet"), so it is built once per commit with its own
//    Vite config, as Strudel's npm release is, and the build is linked.
// Their third-party dependencies are Kynska's own (package.json, at the versions
// Strudel's lockfile resolves); a package resolves them by walking up from the
// checkout in .cache/ to Kynska's node_modules.
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from '../paths.ts';
import { fetchStrudel } from './source.ts';
import type { StrudelPin } from './pin.ts';

/** The packages Kynska loads, by npm name, and their folder in Strudel's packages/. */
export const STRUDEL_PACKAGES: Record<string, string> = {
  '@strudel/core': 'core',
  '@strudel/mini': 'mini',
  '@strudel/tonal': 'tonal',
  '@strudel/transpiler': 'transpiler',
  '@strudel/xen': 'xen',
  '@strudel/mondo': 'mondough',
  mondolang: 'mondo',
  superdough: 'superdough',
};

/** superdough's Vite build needs this workspace package, which is not on npm. */
const WORKLET_PLUGIN = 'vite-plugin-bundle-audioworklet';

type PackageJson = { name: string; version: string; dependencies?: Record<string, string> };
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as PackageJson;

async function link(modules: string, name: string, target: string) {
  const at = join(modules, name);
  await rm(at, { recursive: true, force: true });
  await mkdir(dirname(at), { recursive: true });
  await symlink(target, at, 'dir');
}

/** superdough built as its npm release is, into its own package folder beside the checkout's packages. */
async function buildSuperdough(source: string): Promise<string> {
  const dir = join(source, 'packages', 'superdough');
  const out = join(source, 'kynska-build', 'superdough');
  if (existsSync(join(out, 'index.mjs')) && existsSync(join(out, 'package.json'))) return out;
  // Strudel's config predates Vite's native config loader; the notice about it is not Kynska's to act on.
  process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= 'true';
  const { build } = await import('vite');
  await build({ root: dir, configFile: join(dir, 'vite.config.js'), logLevel: 'warn', build: { outDir: out, emptyOutDir: true } });
  const pkg = await readJson(join(dir, 'package.json'));
  await writeFile(join(out, 'package.json'), `${JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', main: 'index.mjs', dependencies: pkg.dependencies }, null, 2)}\n`);
  return out;
}

/** Third-party dependencies of the linked packages that Kynska's node_modules lacks, with the range each asks for. */
export async function missingDependencies(source: string, root = ROOT): Promise<string[]> {
  const missing: string[] = [];
  for (const dir of Object.values(STRUDEL_PACKAGES)) {
    const pkg = await readJson(join(source, 'packages', dir, 'package.json'));
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      if (range.startsWith('workspace:') || name in STRUDEL_PACKAGES) continue;
      if (!existsSync(join(root, 'node_modules', name, 'package.json'))) missing.push(`${name}@${range} (for ${pkg.name})`);
    }
  }
  return [...new Set(missing)];
}

export async function linkStrudel(pin: StrudelPin, root = ROOT): Promise<{ source: string; linked: string[] }> {
  const source = await fetchStrudel(pin);
  const modules = join(root, 'node_modules');
  const missing = await missingDependencies(source, root);
  if (missing.length) {
    throw new Error(`Strudel ${pin.commit.slice(0, 7)} needs packages Kynska does not install: ${missing.join(', ')}. Add them to package.json at the versions in Strudel's pnpm-lock.yaml.`);
  }
  await link(modules, WORKLET_PLUGIN, join(source, 'packages', WORKLET_PLUGIN));
  for (const [name, dir] of Object.entries(STRUDEL_PACKAGES)) {
    if (name !== 'superdough') await link(modules, name, join(source, 'packages', dir));
  }
  await link(modules, 'superdough', await buildSuperdough(source));
  return { source, linked: Object.keys(STRUDEL_PACKAGES) };
}

/**
 * Throws unless @strudel/core in node_modules is linked from the pinned commit:
 * after `npm install <package>` npm may remove the links, and after a pin change
 * they point at the old commit.
 */
export function assertLinked(pin: StrudelPin, root = ROOT): void {
  const at = join(root, 'node_modules', '@strudel', 'core');
  let real: string | undefined;
  try {
    real = realpathSync(at);
  } catch {
    // not there
  }
  if (!real?.includes(pin.commit)) {
    const where = real ? `points at ${real}` : 'is missing';
    throw new Error(`Strudel is not linked from the pinned commit ${pin.commit.slice(0, 7)} (node_modules/@strudel/core ${where}). Run: npm run link-strudel`);
  }
}
