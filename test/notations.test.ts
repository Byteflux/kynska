import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkCode } from '../src/patterns/check.ts';
import { languageOf } from '../src/patterns/evaluate.ts';
import { queryEvents } from '../src/patterns/events.ts';
import { untar } from '../src/patterns/tidal.ts';

const sounds = (events: { value: unknown }[]) => events.map((e) => (e.value as { s: string }).s);

describe('Mondo notation', () => {
  it('runs inline in JavaScript', async () => {
    expect(sounds(await queryEvents('mondo`s hh*4`'))).toEqual(['hh', 'hh', 'hh', 'hh']);
  });

  it('runs as a whole program in Mondo mode', async () => {
    const events = await queryEvents('s [bd hh]*2', 1, 'mondo');
    expect(sounds(events)).toEqual(['bd', 'hh', 'bd', 'hh']);
  });

  it('is checked by running it, without JavaScript checks', async () => {
    expect((await checkCode('(s hh*8)', { language: 'mondo' })).diagnostics.filter((d) => d.code !== 'no-reference')).toEqual([]);
    const broken = await checkCode('(s hh*8', { language: 'mondo' });
    expect(broken.ok).toBe(false);
    expect(broken.diagnostics.map((d) => d.code)).toContain('evaluation');
  });

  it('is the language of .mondo files', () => {
    expect(languageOf('song.mondo')).toBe('mondo');
    expect(languageOf('song.js')).toBe('js');
    expect(languageOf(undefined)).toBe('js');
  });
});

describe('Tidal notation', () => {
  // Loads Tidal from the pinned Strudel source and its parser from npm on the first run.
  it('runs after initTidal(), as on strudel.cc', async () => {
    const events = await queryEvents('await initTidal()\ntidal`s "bd hh*2" # speed 2`');
    expect(events.map((e) => e.value)).toEqual([
      { s: 'bd', speed: 2 },
      { s: 'hh', speed: 2 },
      { s: 'hh', speed: 2 },
    ]);
  }, 120_000);
});

describe('untar', () => {
  function tar(files: Record<string, string>): Buffer {
    const blocks: Buffer[] = [];
    for (const [name, content] of Object.entries(files)) {
      const header = Buffer.alloc(512);
      header.write(name, 0);
      header.write(`${Buffer.byteLength(content).toString(8).padStart(11, '0')}\0`, 124);
      const body = Buffer.alloc(Math.ceil(Buffer.byteLength(content) / 512) * 512);
      body.write(content);
      blocks.push(header, body);
    }
    return Buffer.concat([...blocks, Buffer.alloc(1024)]);
  }

  it('reads one file out of an archive', () => {
    const archive = tar({ 'package/a.txt': 'first', 'package/grammar.wasm': 'x'.repeat(700) });
    expect(untar(archive, 'package/grammar.wasm')?.toString()).toBe('x'.repeat(700));
    expect(untar(archive, 'package/a.txt')?.toString()).toBe('first');
    expect(untar(archive, 'package/none')).toBeUndefined();
    expect(gzipSync(archive).length).toBeGreaterThan(0);
  });
});
