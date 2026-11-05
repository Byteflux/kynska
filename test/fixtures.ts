import type { Reference, ReferenceEntry } from '../src/reference/types.ts';

const pin = { version: '1.2.6', commit: 'd198910a86fcaecd658ef528bfa6d7884e93490b', repository: 'https://codeberg.org/uzu/strudel.git' };

export function entry(name: string, extra: Partial<ReferenceEntry> = {}): ReferenceEntry {
  return {
    name,
    synonyms: [],
    tags: [],
    module: 'core/controls',
    description: `Does ${name}.`,
    params: [],
    examples: [],
    callable: { global: true, method: true },
    source: { path: 'packages/core/controls.mjs', line: 1, url: `https://example.invalid/${name}` },
    ...extra,
  };
}

/** A small reference: enough names to exercise lookups, suggestions and checks. */
export const smallReference: Reference = {
  schema: 1,
  strudel: pin,
  functions: [
    entry('lpf', {
      synonyms: ['cutoff', 'ctf', 'lp'],
      params: [{ name: 'frequency', types: ['number', 'Pattern'], description: 'audible between 0 and 20000', optional: false }],
      examples: ['s("bd*4").lpf(800)'],
    }),
    entry('note'),
    entry('s', { synonyms: ['sound'] }),
    entry('gain'),
    entry('fast', { module: 'core/pattern', tags: ['temporal'] }),
    entry('stack', { module: 'core/pattern', callable: { global: true, method: true } }),
    entry('fscope', { module: 'webaudio/scope', callable: { global: false, method: false } }),
  ],
};
