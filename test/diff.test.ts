import { describe, expect, it } from 'vitest';
import { diffCode, diffEvents, formatDiff } from '../src/patterns/diff.ts';
import type { PatternEvent } from '../src/patterns/events.ts';

const ev = (begin: string, end: string, value: Record<string, unknown>): PatternEvent => ({
  begin,
  end,
  value,
  show: `[ ${begin} → ${end} | ${Object.entries(value).map(([k, v]) => `${k}:${v}`).join(' ')} ]`,
});

describe('diffEvents', () => {
  it('finds no difference between identical events, whatever their order or key order', () => {
    const a = [ev('0', '1/2', { s: 'bd', gain: 1 }), ev('1/2', '1', { s: 'sd' })];
    const b = [ev('1/2', '1', { s: 'sd' }), { ...ev('0', '1/2', { gain: 1, s: 'bd' }) }];
    const diff = diffEvents(a, b);
    expect(diff.same).toBe(true);
    expect(diff.unchanged).toBe(2);
  });

  it('pairs events with the same timing as changes', () => {
    const diff = diffEvents([ev('1/4', '1/2', { s: 'sd' })], [ev('1/4', '1/2', { s: 'cp' })]);
    expect(diff.changed).toEqual([{ before: ev('1/4', '1/2', { s: 'sd' }), after: ev('1/4', '1/2', { s: 'cp' }) }]);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
  });

  it('reports events only on one side as removed or added', () => {
    const diff = diffEvents([ev('0', '1', { s: 'bd' })], [ev('0', '1', { s: 'bd' }), ev('0', '1/2', { s: 'hh' })]);
    expect(diff.same).toBe(false);
    expect(diff.added).toEqual([ev('0', '1/2', { s: 'hh' })]);
    expect(diff.unchanged).toBe(1);
  });

  it('counts duplicates', () => {
    const one = ev('0', '1', { s: 'bd' });
    const diff = diffEvents([one, one], [one]);
    expect(diff.removed).toHaveLength(1);
    expect(diff.unchanged).toBe(1);
  });
});

describe('diffCode', () => {
  it('shows exactly what a change to the code changed', async () => {
    const diff = await diffCode('s("bd sd bd sd")', 's("bd cp bd sd")');
    expect(diff.changed.map((c) => [c.before.begin, (c.before.value as any).s, (c.after.value as any).s])).toEqual([['1/4', 'sd', 'cp']]);
    expect(diff.unchanged).toBe(3);
    expect(formatDiff(diff, 1)).toBe('~ 1/4 → 1/2  s:sd  →  s:cp\n1 changed, 0 removed, 0 added, 3 unchanged in 1 cycle.');
  });

  it('confirms a refactor kept the events the same', async () => {
    const diff = await diffCode('s("bd*2, hh*4")', 'stack(s("bd").fast(2), s("hh").fast(4))', 2);
    expect(diff.same).toBe(true);
    expect(formatDiff(diff, 2)).toBe('No differences in 2 cycles (12 events).');
  });
});
