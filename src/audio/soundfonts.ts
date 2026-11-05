// General MIDI soundfont instruments (gm_piano, gm_acoustic_bass, ...), as on
// strudel.cc. npm's @strudel/soundfonts 1.2.6 pins an older @strudel/core, so
// its loader and instrument list are loaded from the pinned Strudel source in
// .cache/, against the superdough Kynska renders with (see webaudio-shim.ts).
import { registerHooks } from 'node:module';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseExpressionAt, type Node } from 'acorn';

type AnyNode = Node & Record<string, any>;

/** Where strudel.cc's soundfont loader fetches instruments from. */
export const SOUNDFONT_HOST = /^https:\/\/felixroos\.github\.io\/webaudiofontdata\//;

/**
 * Whether what the loader would eval from an instrument file is plain data. The
 * loader splits the file at its first "={" and evals "{" plus the rest, so that
 * part must be one object of object, array, string and number literals, followed
 * only by ";", whitespace or comments. Anything else (calls, functions,
 * identifiers as values) is refused.
 */
export function isPlainData(source: string): boolean {
  const at = source.indexOf('={');
  if (at < 0) return false;
  const evaluated = `{${source.slice(at + 2)}`;
  let node: AnyNode;
  try {
    node = parseExpressionAt(evaluated, 0, { ecmaVersion: 'latest' }) as AnyNode;
  } catch {
    return false;
  }
  const rest = evaluated
    .slice(node.end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  if (!/^[\s;]*$/.test(rest)) return false;
  const data = (n: AnyNode | null): boolean => {
    if (!n) return false;
    switch (n.type) {
      case 'Literal':
        return !(n.value instanceof RegExp);
      case 'UnaryExpression':
        return (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number';
      case 'TemplateLiteral':
        return n.expressions.length === 0;
      case 'ArrayExpression':
        return n.elements.every(data);
      case 'ObjectExpression':
        return n.properties.every(
          (p: AnyNode) => p.type === 'Property' && !p.computed && p.kind === 'init' && !p.method && (p.key.type === 'Identifier' || p.key.type === 'Literal') && data(p.value),
        );
      default:
        return false;
    }
  };
  return node.type === 'ObjectExpression' && data(node);
}

let registered: Promise<void> | undefined;

/** Registers the gm_* instruments with superdough. Needs the pinned Strudel source (fetched if missing). */
export function registerSoundfonts(): Promise<void> {
  registered ??= (async () => {
    const { readPin } = await import('../reference/pin.ts');
    const { fetchStrudel } = await import('../reference/build.ts');
    const source = await fetchStrudel(await readPin());
    const dir = join(source, 'packages', 'soundfonts');
    const shim = new URL('./webaudio-shim.ts', import.meta.url).href;
    registerHooks({
      resolve: (specifier, context, next) =>
        specifier === '@strudel/webaudio' && context.parentURL?.includes(`${sep}packages${sep}soundfonts${sep}`.replaceAll(sep, '/'))
          ? { url: shim, shortCircuit: true }
          : next(specifier, context),
    });
    const loader = await import(pathToFileURL(join(dir, 'fontloader.mjs')).href);
    loader.registerSoundfonts();
  })();
  return registered;
}
