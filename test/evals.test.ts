import { describe, expect, it } from 'vitest';
import { extractCode, runTool } from '../evals/agent.ts';
import { eventF1 } from '../evals/score.ts';
import { describeTasks, scoreTask } from '../evals/tasks.ts';
import type { PatternEvent } from '../src/patterns/events.ts';
import { ReferenceIndex } from '../src/reference/lookup.ts';
import { smallReference } from './fixtures.ts';

const ev = (begin: string, end: string, value: Record<string, unknown>): PatternEvent => ({ begin, end, value, show: '' });

describe('eventF1', () => {
  it('is 1 for the same events in any order', () => {
    const a = [ev('0', '1/2', { s: 'bd' }), ev('1/2', '1', { s: 'sd' })];
    expect(eventF1(a, [...a].reverse()).f1).toBe(1);
  });

  it('counts missing and extra events', () => {
    const expected = [ev('0', '1/2', { s: 'bd' }), ev('1/2', '1', { s: 'sd' })];
    const actual = [ev('0', '1/2', { s: 'bd' }), ev('1/2', '1', { s: 'cp' }), ev('1/2', '1', { s: 'hh' })];
    expect(eventF1(expected, actual)).toEqual({ precision: 1 / 3, recall: 1 / 2, f1: 0.4 });
  });
});

describe('describe tasks', () => {
  it.each(describeTasks.map((t) => [t.id, t] as const))('%s: its solution meets every criterion', async (_, task) => {
    expect(await scoreTask(task, task.solution)).toMatchObject({ score: 1 });
  });

  it('a plausible wrong answer scores below 1', async () => {
    const backbeat = describeTasks.find((t) => t.id === 'describe/backbeat')!;
    // Kick on every beat and snare on 1 and 3: the classic mix-up.
    const score = await scoreTask(backbeat, 's("bd*4, sd ~ sd ~, hh*8")');
    expect(score.score).toBeLessThan(1);
    expect(score.detail).toMatch(/kick on 1 and 3|snare on 2 and 4/);
  });

  it('code that does not evaluate scores 0', async () => {
    expect(await scoreTask(describeTasks[0], 'nonsense(')).toMatchObject({ score: 0, detail: 'did not evaluate' });
  });
});

describe('agent helpers', () => {
  it('takes the last code block of a reply', () => {
    expect(extractCode('First:\n```js\ns("bd")\n```\nBetter:\n```js\ns("bd*2")\n```')).toBe('s("bd*2")');
  });

  it('runs kynska commands as the tool', async () => {
    const reference = new ReferenceIndex(smallReference);
    expect(await runTool({ command: 'events', code: 's("bd sd")' }, reference)).toContain('[ 0/1 → 1/2 | s:bd ]');
    expect(await runTool({ command: 'check', code: 's("bd").lpff(2)' }, reference)).toMatch(/unknown-method.*Did you mean `lpf`/);
    expect(await runTool({ command: 'lookup', name: 'cutoff' }, reference)).toContain('## lpf');
    expect(await runTool({ command: 'read', file: '../../etc/passwd' }, reference)).toMatch(/^error:/);
  });
});
