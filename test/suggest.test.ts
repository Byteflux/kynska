import { describe, expect, it } from 'vitest';
import { editDistance, suggest } from '../src/text/suggest.ts';

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('lpf', 'lpff')).toBe(1);
    expect(editDistance('note', 'nots')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('counts a swap of neighbouring letters as one edit', () => {
    expect(editDistance('gian', 'gain')).toBe(1);
  });
});

describe('suggest', () => {
  const names = ['lpf', 'lp', 'hpf', 'gain', 'note', 'n', 'fast', 'fastGap'];

  it('offers close names, closest first', () => {
    expect(suggest('lpff', names)).toEqual(['lpf', 'lp']);
    expect(suggest('gian', names)).toEqual(['gain']);
  });

  it('matches a different case first', () => {
    expect(suggest('Fast', names)[0]).toBe('fast');
  });

  it('offers longer names sharing a prefix', () => {
    expect(suggest('fastG', names)).toContain('fastGap');
  });

  it('offers nothing for an unrelated name', () => {
    expect(suggest('zzzzzz', names)).toEqual([]);
  });
});
