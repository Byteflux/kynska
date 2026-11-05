// Names strudel.cc has in scope that Kynska cannot run headlessly: everything the
// browser-only packages export, register as pattern functions, or add to
// Pattern.prototype. Read statically from the pinned source; nothing is run.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse, type Node } from 'acorn';
import { simple } from 'acorn-walk';

/** Packages Kynska loads headlessly (see src/patterns/scope.ts). */
export const HEADLESS_PACKAGES = new Set(['@strudel/core', '@strudel/mini', '@strudel/tonal', '@strudel/xen', '@strudel/transpiler']);

type AnyNode = Node & Record<string, any>;

/** The @strudel/* packages strudel.cc's REPL puts in scope (website/src/repl/util.mjs). */
export function scopePackages(utilSource: string): string[] {
  return [...new Set([...utilSource.matchAll(/import\(\s*['"](@strudel\/[\w-]+)['"]\s*\)/g)].map((m) => m[1]))];
}

const dirsByRoot = new Map<string, Promise<Map<string, string>>>();

/** Package name -> directory, from each packages/*\/package.json (names and directories differ: @strudel/mondo is packages/mondough). */
function packageDirs(sourceRoot: string): Promise<Map<string, string>> {
  let dirs = dirsByRoot.get(sourceRoot);
  if (!dirs) {
    dirs = (async () => {
      const map = new Map<string, string>();
      const root = join(sourceRoot, 'packages');
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const manifest = join(root, entry.name, 'package.json');
        if (!entry.isDirectory() || !existsSync(manifest)) continue;
        const { name } = JSON.parse(await readFile(manifest, 'utf8')) as { name?: string };
        if (name) map.set(name, join(root, entry.name));
      }
      return map;
    })();
    dirsByRoot.set(sourceRoot, dirs);
  }
  return dirs;
}

async function packageDir(sourceRoot: string, specifier: string): Promise<string | undefined> {
  return (await packageDirs(sourceRoot)).get(specifier);
}

/** A package's source entry: index.mjs, or <directory>.mjs (hydra, mondough, tidal). */
function entryOf(dir: string): string {
  const named = join(dir, `${dir.split(/[\\/]/).pop()}.mjs`);
  return existsSync(join(dir, 'index.mjs')) ? join(dir, 'index.mjs') : named;
}

function parseModule(source: string): AnyNode | undefined {
  try {
    return parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as AnyNode;
  } catch {
    return undefined; // e.g. JSX; not part of the pattern language
  }
}

/** Exported names of a module, following `export * from` into the checkout. */
async function exportedNames(file: string, sourceRoot: string, seen: Set<string>): Promise<string[]> {
  if (seen.has(file) || !existsSync(file)) return [];
  seen.add(file);
  const ast = parseModule(await readFile(file, 'utf8'));
  if (!ast) return [];
  const names: string[] = [];
  for (const node of ast.body as AnyNode[]) {
    if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.id?.name) names.push(d.id.name);
      for (const v of d?.declarations ?? []) if (v.id?.name) names.push(v.id.name);
      for (const s of node.specifiers ?? []) names.push(s.exported.name ?? s.exported.value);
    } else if (node.type === 'ExportAllDeclaration' && !node.exported) {
      const target = String(node.source.value);
      let next: string | undefined;
      if (target.startsWith('.')) next = resolve(dirname(file), target);
      else {
        const dir = await packageDir(sourceRoot, target);
        if (dir) next = entryOf(dir);
      }
      if (next) names.push(...(await exportedNames(next, sourceRoot, seen)));
    }
  }
  return names;
}

/** register('name' | ['a', 'b'], ...) calls and Pattern.prototype.name = ... assignments. */
function patternFunctions(ast: AnyNode): string[] {
  const names: string[] = [];
  simple(ast, {
    CallExpression(n) {
      const node = n as AnyNode;
      if (node.callee.type !== 'Identifier' || !/^register/.test(node.callee.name)) return;
      const [first] = node.arguments;
      if (first?.type === 'Literal' && typeof first.value === 'string') names.push(first.value);
      if (first?.type === 'ArrayExpression') {
        for (const e of first.elements) if (e?.type === 'Literal' && typeof e.value === 'string') names.push(e.value);
      }
    },
    AssignmentExpression(n) {
      const left = (n as AnyNode).left;
      const object = left.type === 'MemberExpression' ? left.object : undefined;
      if (object?.type === 'MemberExpression' && object.object.name === 'Pattern' && object.property.name === 'prototype') {
        const name = left.computed ? left.property.value : left.property.name;
        if (typeof name === 'string') names.push(name);
      }
    },
  });
  return names;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test', 'tests', 'examples'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.m?js$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** name -> package, for every name the browser-only scope packages define. */
export async function browserOnlyNames(sourceRoot: string): Promise<Record<string, string>> {
  const util = await readFile(join(sourceRoot, 'website', 'src', 'repl', 'util.mjs'), 'utf8');
  const result: Record<string, string> = {};
  for (const pkg of scopePackages(util)) {
    if (HEADLESS_PACKAGES.has(pkg)) continue;
    const dir = await packageDir(sourceRoot, pkg);
    if (!dir) continue;
    const names = new Set(await exportedNames(entryOf(dir), sourceRoot, new Set()));
    for (const file of await sourceFiles(dir)) {
      const ast = parseModule(await readFile(file, 'utf8'));
      if (ast) for (const name of patternFunctions(ast)) names.add(name);
    }
    for (const name of names) if (!(name in result) && /^[A-Za-z_$][\w$]*$/.test(name)) result[name] = pkg;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
