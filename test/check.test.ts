import { describe, expect, it } from 'vitest';
import { checkCode, type Diagnostic } from '../src/patterns/check.ts';
import { ReferenceIndex } from '../src/reference/lookup.ts';
import { entry, smallReference } from './fixtures.ts';

const reference = new ReferenceIndex(smallReference);
const check = (code: string) => checkCode(code, { reference });
const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

describe('checkCode', () => {
  it('passes valid code and reports what it produces', async () => {
    const result = await check('$: s("bd*4")\n$: note("c3 e3").s("sawtooth").lpf(800)');
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.events).toBe(24);
    expect(result.cps).toBe(0.5);
  });

  it('reports a syntax error with its position', async () => {
    const result = await check('s("bd sd"\n');
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'syntax', line: 2, column: 1 })]);
  });

  it('reports every unknown method on a pattern, with suggestions', async () => {
    const result = await check('s("bd sd").lpff(800).gian(0.5)');
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'unknown-method', line: 1, column: 12, suggestions: ['lpf', 'lp'] }),
      expect.objectContaining({ code: 'unknown-method', line: 1, column: 22, suggestions: ['gain'] }),
    ]);
  });

  it('reports an unknown global function', async () => {
    const result = await check('nots("c3")');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'unknown-function', line: 1, column: 1, suggestions: expect.arrayContaining(['note']) }),
    ]);
  });

  it('checks methods on mini-notation strings', async () => {
    const result = await check('"c3 e3".note().lpff(2)');
    expect(codes(result.diagnostics)).toEqual(['unknown-method']);
  });

  it("leaves the code's own functions and JavaScript's alone", async () => {
    const result = await check('const up = (p) => p.fast(2)\nconst n = Math.floor(2.7)\nup(note("c3")).fast(n)');
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('catches at evaluation what static checks cannot see', async () => {
    const result = await check('const d = s("bd")\nd.lpff(2)');
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'evaluation', message: expect.stringMatching(/lpff/) })]);
  });

  it('reports bad mini-notation', async () => {
    const result = await check('s("bd(3,")');
    expect(codes(result.diagnostics)).toEqual(['evaluation']);
  });

  it("passes on Strudel's own warnings", async () => {
    const result = await check('note("c3").add(12)');
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === 'engine-warning')).toEqual([
      expect.objectContaining({ message: "Can't do arithmetic on control pattern." }),
    ]);
  });

  it('warns about a pattern that stays silent', async () => {
    const result = await check('s("~ ~")');
    expect(result.ok).toBe(true);
    expect(codes(result.diagnostics)).toEqual(['silent']);
  });

  it('warns about functions that exist but are not documented', async () => {
    const result = await check('s("bd").fast(2).slow(2).slow(2)');
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'undocumented', message: expect.stringMatching(/`slow`/) })]);
  });

  it('accepts browser-only functions with a warning and checks the rest', async () => {
    const result = await check('s("bd sd").fscope()');
    expect(result.ok).toBe(true);
    expect(codes(result.diagnostics)).toEqual(['browser-only']);
    expect(result.events).toBe(8);
  });

  it('still works without a reference, and says so', async () => {
    const result = await checkCode('s("bd").lpff(2)');
    expect(codes(result.diagnostics)).toEqual(['no-reference', 'unknown-method']);
    expect(result.diagnostics[1].suggestions).toContain('lpf');
  });

  it('treats functions defined with register() as known', async () => {
    const result = await check("register('vlpf', (freq, pat) => pat.lpf(freq))\ns(\"bd\").vlpf(800)");
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('does not check the code inside a browser-only call as Strudel', async () => {
    const ref = new ReferenceIndex({ ...smallReference, functions: [...smallReference.functions, entry('K', { callable: { global: false, method: false } })] });
    const result = await checkCode('s("bd").K(saw(sFreq).lag(0.1).out())', { reference: ref });
    expect(result.ok).toBe(true);
    expect(codes(result.diagnostics)).toEqual(['browser-only']);
  });

  it('stands in for browser-only signals used as values', async () => {
    const ref = new ReferenceIndex({
      ...smallReference,
      functions: [...smallReference.functions, entry('gravityTest', { callable: { global: false, method: false } })],
    });
    const result = await checkCode('n(gravityTest.segment(4).range(0, 7))', { reference: ref });
    expect(result.ok).toBe(true);
    // A stand-in is silent, so no silence warning either.
    expect(codes(result.diagnostics).filter((c) => c !== 'undocumented')).toEqual(['browser-only']);
  });

  it("ignores the code's own console output", async () => {
    const result = await check('console.log("hello")\ns("bd")');
    expect(result.diagnostics).toEqual([]);
  });

  it('does not mistake a documented name for a browser-only one when it runs headlessly', async () => {
    const ref = new ReferenceIndex({ ...smallReference, functions: [...smallReference.functions, entry('slow')] });
    const result = await checkCode('s("bd").slow(2)', { reference: ref });
    expect(result.diagnostics).toEqual([]);
  });
});
