import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { formatEntry, ReferenceIndex } from '../src/reference/lookup.ts';
import { readPin } from '../src/reference/pin.ts';
import { toReference, type Doclet } from '../src/reference/transform.ts';
import { smallReference } from './fixtures.ts';

const ROOT = '/src/strudel';
const pin = {
  version: '1.2.6',
  repository: 'https://codeberg.org/uzu/strudel.git',
  tag: '@strudel/core@1.2.6',
  commit: 'd198910a86fcaecd658ef528bfa6d7884e93490b',
};

function doclet(name: string, extra: Partial<Doclet> = {}): Doclet {
  return {
    name,
    kind: 'member',
    scope: 'global',
    description: `Does ${name}.`,
    meta: { path: `${ROOT}/packages/core`, filename: 'controls.mjs', lineno: 10 },
    ...extra,
  };
}

const transform = (doclets: Doclet[]) =>
  toReference(doclets, {
    pin,
    sourceRoot: ROOT,
    isGlobal: (n) => n !== 'onlyMethod',
    isMethod: (n) => n !== 'onlyGlobal',
  });

describe('toReference', () => {
  it('keeps documented user-facing functions, sorted by name', () => {
    const ref = transform([doclet('note'), doclet('lpf'), doclet('fast', { kind: 'function', memberof: 'Pattern' })]);
    expect(ref.functions.map((f) => f.name)).toEqual(['fast', 'lpf', 'note']);
    expect(ref.strudel).toEqual({ version: '1.2.6', commit: pin.commit, repository: pin.repository });
  });

  it('drops internals: undocumented, underscored, engine classes, no description, other kinds', () => {
    const ref = transform([
      doclet('kept'),
      doclet('hidden', { undocumented: true }),
      doclet('_euclidRot'),
      doclet('attack', { memberof: 'DoughVoice' }),
      doclet('bare', { description: '' }),
      doclet('Pattern', { kind: 'class' }),
    ]);
    expect(ref.functions.map((f) => f.name)).toEqual(['kept']);
  });

  it('keeps the first definition of a name, in source order', () => {
    const ref = transform([
      doclet('note', { description: 'Later.', meta: { path: `${ROOT}/packages/core`, filename: 'controls.mjs', lineno: 90 } }),
      doclet('note', { description: 'Earlier.', meta: { path: `${ROOT}/packages/core`, filename: 'controls.mjs', lineno: 5 } }),
    ]);
    expect(ref.functions).toHaveLength(1);
    expect(ref.functions[0].description).toBe('Earlier.');
  });

  it('collects synonyms, @alias and tags', () => {
    const [f] = transform([
      doclet('setcpm', { kynskaSynonyms: ['cpm2'], alias: 'setCpm', kynskaTags: ['temporal', 'temporal', 'tempo'] }),
    ]).functions;
    expect(f.synonyms).toEqual(['cpm2', 'setCpm']);
    expect(f.tags).toEqual(['temporal', 'tempo']);
  });

  it('turns {@link} tags into code names', () => {
    const [f] = transform([doclet('scale', { description: 'See {@link Pattern#scaleTranspose} and {@link note}.' })]).functions;
    expect(f.description).toBe('See `scaleTranspose` and `note`.');
  });

  it('records module, source link, parameters and how it can be called', () => {
    const [f] = transform([
      doclet('onlyMethod', {
        params: [
          { name: 'freq', type: { names: ['number', 'Pattern'] }, description: 'Hz' },
          { name: 'q', optional: true, defaultvalue: 1 },
        ],
        examples: [' s("bd").onlyMethod(800) '],
      }),
    ]).functions;
    expect(f.module).toBe('core/controls');
    expect(f.source).toEqual({
      path: 'packages/core/controls.mjs',
      line: 10,
      url: `https://codeberg.org/uzu/strudel/src/commit/${pin.commit}/packages/core/controls.mjs#L10`,
    });
    expect(f.params).toEqual([
      { name: 'freq', types: ['number', 'Pattern'], description: 'Hz', optional: false },
      { name: 'q', types: [], description: '', optional: true, default: '1' },
    ]);
    expect(f.examples).toEqual(['s("bd").onlyMethod(800)']);
    expect(f.callable).toEqual({ global: false, method: true });
  });
});

describe('ReferenceIndex', () => {
  const index = new ReferenceIndex(smallReference);

  it('finds a function by name or synonym', () => {
    expect(index.find('lpf')?.name).toBe('lpf');
    expect(index.find('cutoff')?.name).toBe('lpf');
    expect(index.has('cutoff')).toBe(true);
  });

  it('falls back to a case-insensitive match, but has() is exact', () => {
    expect(index.find('LPF')?.name).toBe('lpf');
    expect(index.has('LPF')).toBe(false);
  });

  it('suggests names for a typo', () => {
    expect(index.suggest('lpff')).toEqual(['lpf', 'lp']);
  });

  it('lists functions by tag and module', () => {
    expect(index.withTag('temporal').map((e) => e.name)).toEqual(['fast']);
    expect(index.inModule('pattern').map((e) => e.name)).toEqual(['fast', 'stack']);
  });
});

describe('formatEntry', () => {
  const index = new ReferenceIndex(smallReference);

  it('shows how to call it, its parameters and examples', () => {
    const text = formatEntry(index.find('lpf')!);
    expect(text).toContain('pattern.lpf(frequency)  or  lpf(frequency)');
    expect(text).toContain('- `frequency` (number | Pattern): audible between 0 and 20000');
    expect(text).toContain('```js\ns("bd*4").lpf(800)\n```');
  });

  it('explains synonyms and case', () => {
    expect(formatEntry(index.find('cutoff')!, 'cutoff')).toContain('`cutoff` is another name for `lpf`.');
    expect(formatEntry(index.find('LPF')!, 'LPF')).toContain('Names are case-sensitive: write `lpf`, not `LPF`.');
  });

  it('marks browser-only functions', () => {
    expect(formatEntry(index.find('fscope')!)).toContain('Only available in the browser');
  });
});

describe('strudel.json', () => {
  it('pins the same Strudel version that is installed', async () => {
    const installed = createRequire(import.meta.url)('@strudel/core/package.json').version;
    expect((await readPin()).version).toBe(installed);
  });
});
