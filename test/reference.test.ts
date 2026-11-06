import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT as ROOT_DIR } from '../src/paths.ts';
import { browserOnlyNames, scopePackages } from '../src/reference/browser-names.ts';
import { assertLinked, missingDependencies, STRUDEL_PACKAGES } from '../src/reference/link.ts';
import { formatEntry, ReferenceIndex } from '../src/reference/lookup.ts';
import { pinName, readPin } from '../src/reference/pin.ts';
import { toReference, type Doclet } from '../src/reference/transform.ts';
import { smallReference } from './fixtures.ts';

const ROOT = '/src/strudel';
const pin = {
  repository: 'https://codeberg.org/uzu/strudel.git',
  branch: 'main',
  commit: '530e9630bfee3f1b7b770f3f243b338495934e9d',
  date: '2026-11-01T12:26:55+01:00',
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
    expect(ref.strudel).toEqual({ branch: 'main', commit: pin.commit, date: pin.date, repository: pin.repository });
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
  it('pins a commit on main, and the packages are linked from it', async () => {
    const pinned = await readPin();
    expect(pinned.branch).toBe('main');
    expect(pinName(pinned)).toMatch(/^main at [0-9a-f]{7} \(\d{4}-\d{2}-\d{2}\)$/);
    expect(() => assertLinked(pinned)).not.toThrow();
    for (const name of Object.keys(STRUDEL_PACKAGES)) expect(realpathSync(join(ROOT_DIR, 'node_modules', name))).toContain(pinned.commit);
  });

  it('says how to fix links that are missing or from another commit', () => {
    expect(() => assertLinked({ ...pin, commit: 'f'.repeat(40) })).toThrow(/not linked from the pinned commit fffffff .*Run: npm run link-strudel/);
  });

  it('installs every third-party package the linked Strudel packages import', async () => {
    const pinned = await readPin();
    expect(await missingDependencies(join(ROOT_DIR, '.cache', 'strudel', pinned.commit))).toEqual([]);
  });
});

// Regression: at Strudel main, strudel.cc's REPL names @strudel/webaudio through a
// namespace import, and @strudel/mqtt exports move and motor by destructuring;
// both went unseen, and check called registerSound and move unknown functions.
describe('browser-only names', () => {
  const util = `import * as strudelCore from '@strudel/core';
import * as strudelWebaudio from '@strudel/webaudio';
import * as notInScope from '@strudel/unused';
const { setVersionDefaults } = strudelWebaudio;
export function loadModules() {
  let modules = [
    strudelCore,
    import('@strudel/mqtt'),
    strudelWebaudio,
  ];
  return evalScope(...modules);
}
`;

  it('reads the packages strudel.cc puts in scope, imported inline or at the top', () => {
    expect(scopePackages(util).sort()).toEqual(['@strudel/core', '@strudel/mqtt', '@strudel/webaudio']);
  });

  it('finds destructured exports, prototype methods, and exports re-exported from another package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kynska-names-'));
    const write = async (file: string, text: string) => {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    };
    try {
      await write('website/src/repl/util.mjs', util);
      await write('packages/mqtt/package.json', '{"name":"@strudel/mqtt"}');
      await write('packages/mqtt/index.mjs', "export const { move, motor } = createParams('move', 'motor');\nPattern.prototype.robot = function () {};\n");
      await write('packages/webaudio/package.json', '{"name":"@strudel/webaudio"}');
      await write('packages/webaudio/index.mjs', "export * from 'superdough';\n");
      await write('packages/superdough/package.json', '{"name":"superdough"}');
      await write('packages/superdough/index.mjs', 'export const registerSound = () => {};\nexport function getAudioContext() {}\n');
      expect(await browserOnlyNames(root)).toEqual({
        getAudioContext: '@strudel/webaudio',
        motor: '@strudel/mqtt',
        move: '@strudel/mqtt',
        registerSound: '@strudel/webaudio',
        robot: '@strudel/mqtt',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
