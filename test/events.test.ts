import { describe, expect, it } from 'vitest';
import { queryEvents } from '../src/patterns/events.ts';

const timings = (events: { begin: string; end: string }[]) => events.map((e) => [e.begin, e.end]);

describe('queryEvents', () => {
  it('splits a cycle evenly between mini-notation steps', async () => {
    const events = await queryEvents('note("c3 e3 g3 b3")');
    expect(timings(events)).toEqual([
      ['0', '1/4'],
      ['1/4', '1/2'],
      ['1/2', '3/4'],
      ['3/4', '1'],
    ]);
    expect(events.map((e) => e.value)).toEqual([{ note: 'c3' }, { note: 'e3' }, { note: 'g3' }, { note: 'b3' }]);
  });

  it('places euclidean rhythms on the expected steps', async () => {
    const events = await queryEvents('s("bd(3,8)")');
    expect(events.map((e) => e.begin)).toEqual(['0', '3/8', '3/4']);
  });

  it('stacks layers and counts every onset over several cycles', async () => {
    const events = await queryEvents('s("bd*2, hh*4")', 2);
    expect(events.filter((e) => (e.value as { s: string }).s === 'bd')).toHaveLength(4);
    expect(events.filter((e) => (e.value as { s: string }).s === 'hh')).toHaveLength(8);
  });

  it('keeps chained controls on each event', async () => {
    const [event] = await queryEvents('note("c3").s("sawtooth").lpf(800)');
    expect(event.value).toEqual({ note: 'c3', s: 'sawtooth', cutoff: 800 });
  });

  it('ignores output-only methods such as visuals', async () => {
    const events = await queryEvents('s("bd sd")._pianoroll()');
    expect(events).toHaveLength(2);
  });

  it('counts an event that spans cycles once, at its onset', async () => {
    const events = await queryEvents('note("c3").slow(2)', 2);
    expect(timings(events)).toEqual([['0', '2']]);
  });

  it('rejects code that calls an unknown function', async () => {
    await expect(queryEvents('nonsense("bd")')).rejects.toThrow();
  });
});
