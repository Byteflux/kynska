import { describe, expect, it, vi } from 'vitest';
import { extractCode, readReply, reasoningOptions, retryAfterMs, runAgent, runTool } from '../evals/agent.ts';
import { eventF1 } from '../evals/score.ts';
import { describeTasks, scoreTask } from '../evals/tasks.ts';
import type { PatternEvent } from '../src/patterns/events.ts';
import { ReferenceIndex } from '../src/reference/lookup.ts';
import { smallReference } from './fixtures.ts';
import { produceTasks, productionCriteria as c, type ProduceCriterion, type ProductionRun } from '../evals/produce.ts';
import { emptyCosts, evalRender, offlineRenders, withRenderSlot } from '../evals/render.ts';
import { summarize, type Row } from '../evals/summary.ts';
import { reportRender } from '../src/audio/report.ts';
import { access } from 'node:fs/promises';

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

  it('keeps the baseline tool-less even if a reply contains a tool call', async () => {
    const network = vi.fn(async () => Response.json({ usage: { total_tokens: 12 }, choices: [{ message: { content: 's("bd")', tool_calls: [{ id: 'r', function: { name: 'kynska', arguments: '{"command":"render"}' } }] } }] }));
    vi.stubGlobal('fetch', network);
    try {
      const result = await runAgent('brief', 'baseline', { baseUrl: 'https://mock.invalid', apiKey: 'mock', model: 'mock' }, new ReferenceIndex(smallReference));
      expect(result).toMatchObject({ code: 's("bd")', turns: 1, toolCalls: 0, tokens: 12, renderCalls: 0, renderSeconds: 0 });
      expect(JSON.parse((network.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).tools).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('counts a draft render, tool calls, turns and tokens with a mocked model', async () => {
    const code = 'setcpm(60)\nnote("c3").s("sine")';
    const network = vi.fn()
      .mockResolvedValueOnce(Response.json({ usage: { total_tokens: 20 }, choices: [{ message: { content: '', tool_calls: [{ id: 'r', function: { name: 'kynska', arguments: JSON.stringify({ command: 'render', code, cycles: 1 }) } }] } }] }))
      .mockResolvedValueOnce(Response.json({ usage: { total_tokens: 30 }, choices: [{ message: { content: code } }] }));
    vi.stubGlobal('fetch', network);
    try {
      const result = await runAgent('brief', 'kynska', { baseUrl: 'https://mock.invalid', apiKey: 'mock', model: 'mock' }, new ReferenceIndex(smallReference));
      expect(result).toMatchObject({ code, turns: 2, toolCalls: 1, tokens: 50, renderCalls: 1, renderSeconds: 1 });
      expect(JSON.stringify(result.transcript)).toContain('Wrote /tmp/');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('waits out a rate limit as the API asks, without spending an attempt or counting it as run time', async () => {
    const limited = () => new Response('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': '0' } });
    const network = vi.fn()
      .mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(Response.json({ usage: { total_tokens: 5 }, choices: [{ message: { content: 's("bd")' } }] }));
    vi.stubGlobal('fetch', network);
    try {
      const result = await runAgent('brief', 'baseline', { baseUrl: 'https://mock.invalid', apiKey: 'mock', model: 'mock' }, new ReferenceIndex(smallReference));
      expect(result).toMatchObject({ code: 's("bd")', tokens: 5, rateLimitedSeconds: 0 });
      expect(network).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(retryAfterMs('34', 0)).toBe(34_000);
    expect(retryAfterMs(null, 0)).toBe(5000);
    expect(retryAfterMs('soon', 30_000)).toBe(30_000);
    expect(retryAfterMs(null, 600_000)).toBe(60_000);
  });

  // Regression: the server sometimes returned an empty reply with tokens spent
  // (a stripped tool call), which ended a kynska run with no answer.
  it('asks again after an empty reply, counting its tokens', async () => {
    const network = vi.fn()
      .mockResolvedValueOnce(Response.json({ usage: { total_tokens: 225 }, choices: [{ finish_reason: 'stop', message: { content: '' } }] }))
      .mockResolvedValueOnce(Response.json({ usage: { total_tokens: 200 }, choices: [{ finish_reason: 'stop', message: { content: '```js\ns("bd")\n```' } }] }));
    vi.stubGlobal('fetch', network);
    try {
      const result = await runAgent('brief', 'baseline', { baseUrl: 'https://mock.invalid', apiKey: 'mock', model: 'mock' }, new ReferenceIndex(smallReference));
      expect(result).toMatchObject({ code: 's("bd")', tokens: 425 });
      expect(network).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 10000);

  it('sends reasoning effort and a reasoning budget only when set', () => {
    expect(reasoningOptions({})).toEqual({});
    expect(reasoningOptions({ effort: 'medium', reasoningTokens: 16000 })).toEqual({ reasoning_effort: 'medium', reasoning: { max_tokens: 16000 } });
    expect(reasoningOptions({ reasoningTokens: 8000 })).toEqual({ reasoning: { max_tokens: 8000 } });
  });

  it('reads a streamed reply: content, a tool call in pieces, finish reason and usage', async () => {
    const events = [
      { choices: [{ delta: { reasoning_content: 'thinking' } }] },
      { choices: [{ delta: { content: 'Here' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'kynska', arguments: '{"comm' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"check"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { total_tokens: 42 } },
    ];
    const text = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`;
    // Split mid-line, as the network does.
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 50)); c.enqueue(bytes.slice(50)); c.close(); } });
    const reply = await readReply(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    expect(reply).toMatchObject({ finish_reason: 'tool_calls', usage: { total_tokens: 42 }, message: { content: 'Here', tool_calls: [{ id: 'c1', function: { name: 'kynska', arguments: '{"command":"check"}' } }] } });
  });

  it('retains usage when a reply spends every token without answering', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ usage: { total_tokens: 77 }, choices: [{ finish_reason: 'length', message: { content: '' } }] })));
    const costs = { ...emptyCosts(), turns: 0, toolCalls: 0, tokens: 0 };
    try {
      await expect(runAgent('brief', 'baseline', { baseUrl: 'https://mock.invalid', apiKey: 'mock', model: 'mock' }, new ReferenceIndex(smallReference), costs)).rejects.toThrow('before any answer');
      expect(costs).toMatchObject({ turns: 1, tokens: 77 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function productionRun(): ProductionRun {
  const events = [ev('0', '1/4', { s: 'sine', note: 'c3' }), ev('1', '5/4', { s: 'sine', note: 'c4' })];
  const report = reportRender({ channels: [new Float32Array(48000)], sampleRate: 48000, cps: .5, from: 0, cycles: 2, events, errors: [], warnings: [] });
  report.stats = { ...report.stats, duration: 4, peakDb: -1, loudnessLufs: -14, clippedSamples: 0 };
  report.sections = [
    { name: 'quiet', from: 0, to: 1, peakDb: -12, rmsDb: -20, loudnessLufs: -20, silentShare: 0 },
    { name: 'loud', from: 1, to: 2, peakDb: -1, rmsDb: -14, loudnessLufs: -14, silentShare: 0 },
  ];
  return { cps: .5, events, report, form: { cps: .5, cycles: 2, layers: [{ name: 'all', sounds: ['sine'], events: 2, cycles: '0-1' }] }, premaster: { clippedSamples: 0, limiterDb: 6 } };
}

describe('production criteria', () => {
  const cases: [string, ProduceCriterion, (r: ProductionRun) => void][] = [
    ['duration', c.duration(4), (r) => { r.report.stats.duration = 4.401; }],
    ['tempo', c.tempo(120), (r) => { r.cps = .6; }],
    ['loudness', c.loudness(-14), (r) => { r.report.stats.loudnessLufs = -15.01; }],
    ['peak', c.peak(-1), (r) => { r.report.stats.peakDb = -.99; }],
    ['clipping', c.unclipped(), (r) => { r.report.stats.clippedSamples = 1; }],
    ['clipping before mastering', c.mixUnclipped(), (r) => { r.premaster!.clippedSamples = 1; }],
    ['limiting', c.limiting(6), (r) => { r.premaster!.limiterDb = 6.01; }],
    ['sounds in every bar', c.sounds(0, 2, ['sine']), (r) => { r.events.pop(); }],
    ['key', c.pitches('sine', { key: [0, 3, 7] }), (r) => { r.events[0].value = { s: 'sine', note: 'cs3' }; }],
    ['range including endpoints', c.pitches('sine', { range: [48, 60] }), (r) => { r.events[1].value = { s: 'sine', note: 61 }; }],
    ['layers', c.layers(1), (r) => { r.form.layers = []; }],
    ['section contrast', c.contrast('quiet', 'loud', 6), (r) => { r.report.sections![1].loudnessLufs = -14.01; }],
  ];
  const midi = (note: string) => ({ c3: 48, c4: 60, cs3: 49 })[note]!;
  it.each(cases)('%s passes and fails independently', (_, criterion, fail) => {
    const run = productionRun();
    expect(criterion.pass(run, midi)).toBe(true);
    fail(run);
    expect(criterion.pass(run, midi)).toBe(false);
  });

  it('does not accept missing pitches, extra sounds or unmeasurable loudness', () => {
    const run = productionRun();
    expect(c.pitches('bass', { range: [0, 127] }).pass(run, midi)).toBe(false);
    run.events.push(ev('0', '1/4', { s: 'sd' }));
    expect(c.sounds(0, 2, ['sine']).pass(run, midi)).toBe(false);
    run.report.stats.loudnessLufs = null;
    expect(c.loudness(-14).pass(run, midi)).toBe(false);
    run.report.sections = [];
    expect(c.contrast('quiet', 'loud', 6).pass(run, midi)).toBe(false);
    run.premaster = undefined;
    expect(c.mixUnclipped().pass(run, midi)).toBe(false);
    expect(c.limiting(6).pass(run, midi)).toBe(false);
  });
});

describe('produce tasks', () => {
  // Regression: eval renders were always offline, so a fresh checkout or CI
  // runner with no sound cache rendered the drum briefs silent and scored 0.
  it('renders may download sounds unless KYNSKA_EVAL_OFFLINE=1', () => {
    expect(offlineRenders({})).toBe(false);
    expect(offlineRenders({ KYNSKA_EVAL_OFFLINE: '0' })).toBe(false);
    expect(offlineRenders({ KYNSKA_EVAL_OFFLINE: '1' })).toBe(true);
  });

  it.each(produceTasks.map((t) => [t.id, t] as const))('%s: oracle meets every criterion', async (_, task) => {
    const costs = emptyCosts();
    expect(await scoreTask(task, task.solution, costs)).toMatchObject({ score: 1 });
    expect(costs.renderCalls).toBe(1);
    expect(costs.renderSeconds).toBeCloseTo(task.cycles * 240 / task.bpm, 3);
  }, 20000);

  // Regression: the scoring render masters these briefs, which hid a mix that
  // clips; an unbalanced mix must now lose points.
  it('a mastered brief marks down a mix that clips and needs heavy limiting', async () => {
    const task = produceTasks.find((t) => t.id === 'produce/mastered-beat')!;
    const result = await scoreTask(task, task.solution.replace(/\.gain\([^)]*\)/g, ''));
    expect(result.score).toBeLessThan(1);
    expect(result.detail).toContain('zero clipped samples before mastering');
    expect(result.detail).toContain('limiter takes at most 6 dB off peaks');
  }, 20000);

  it('invalid code, unknown sounds and silent audio score zero', async () => {
    for (const code of ['nonsense(', 's("no_such_eval_sound")', 'note("c3").s("sine").gain(0)']) {
      expect(await scoreTask(produceTasks[0], code)).toMatchObject({ score: 0 });
    }
  }, 10000);
});

describe('eval rendering', () => {
  it('returns CLI reports for drafts, layers, sections and mastering; removes its temp WAV', async () => {
    const costs = emptyCosts();
    const result = await evalRender('setcpm(60)\n$: note("c3").s("sine")\n$: note("g4").s("triangle")', { sections: 'a=1,b=1', from: 1, to: 2, layers: true, master: -18, tail: .1 }, costs);
    expect(result.text).toContain('Wrote /tmp/');
    expect(result.text).toContain('By section:');
    expect(result.text).toContain('Layers, each rendered alone:');
    expect(result.text).toContain('Master');
    expect(result.text).toContain('Before mastering: 0 clipped samples');
    expect(result.premaster).toMatchObject({ clippedSamples: 0 });
    expect(result.report.stats.loudnessLufs).toBeCloseTo(-18, 0);
    expect(result.report.from).toBe(1);
    expect(costs.renderCalls).toBe(1);
    expect(costs.renderSeconds).toBeCloseTo(3.3, 3);
    await expect(access(result.report.file!)).rejects.toThrow();
  }, 10000);

  it('rejects over 32 seconds including tails with a clear tool error', async () => {
    const costs = emptyCosts();
    const ref = new ReferenceIndex(smallReference);
    expect(await runTool({ command: 'render', code: 'setcpm(60)\nnote("c3").s("sine")', cycles: 32, tail: .1 }, ref, costs)).toMatch(/error:.*32\.1 s is longer than the 32 s limit/);
    expect(costs).toEqual({ renderCalls: 1, renderSeconds: 0 });
    expect(await runTool({ command: 'render', code: 'note("c3")', to: 2, cycles: 1 }, ref)).toContain('give to or cycles');
  });

  it('admits only two render jobs and releases a slot on failure', async () => {
    let active = 0;
    let max = 0;
    const release: (() => void)[] = [];
    const jobs = Array.from({ length: 4 }, (_, i) => withRenderSlot(async () => {
      active++;
      max = Math.max(max, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active--;
      if (i === 0) throw new Error('expected');
    }).catch(() => {}));
    expect(release).toHaveLength(2);
    release.shift()!();
    release.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(release).toHaveLength(2);
    release.forEach((resolve) => resolve());
    await Promise.all(jobs);
    expect(max).toBe(2);
  });
});

describe('eval summary', () => {
  it('groups repeats by condition and kind with spread, costs and missing answers', () => {
    const row: Row = { task: 'produce/test', kind: 'produce', condition: 'baseline', repeat: 1, score: 1, detail: '', code: 'code', failedToAnswer: false, turns: 1, toolCalls: 0, tokens: 100, seconds: 2, renderCalls: 1, renderSeconds: 16 };
    const text = summarize([row, { ...row, repeat: 2, score: 0, code: '', failedToAnswer: true, tokens: 200 }, { ...row, condition: 'kynska' }], ['baseline', 'kynska']);
    expect(text).toContain('| baseline | produce | 2 | 0.500 | 0.000–1.000 | 1 | 1.0 | 0.0 | 150.0 | 2.0 | 1.0 | 16.0 | 1 | 0 |');
    expect(text).toContain('| kynska | produce | 1 | 1.000 | 1.000–1.000 |');
  });

  it('counts replies cut off by the token cap among the failures to answer', () => {
    const row: Row = { task: 'a', kind: 'produce', condition: 'baseline', repeat: 1, score: 0, detail: 'agent failed', code: '', failedToAnswer: true, turns: 1, toolCalls: 0, tokens: 0, seconds: 0, renderCalls: 0, renderSeconds: 0 };
    const rows = [{ ...row, error: 'reply cut off at 16384 tokens before any answer' }, { ...row, error: '500 upstream error' }];
    expect(summarize(rows, ['baseline'])).toMatch(/\| 2 \| 1 \|\n/);
  });

  it('measures spread between repeat means rather than between different tasks', () => {
    const row: Row = { task: 'a', kind: 'produce', condition: 'baseline', repeat: 1, score: 0, detail: '', code: 'code', failedToAnswer: false, turns: 0, toolCalls: 0, tokens: 0, seconds: 0, renderCalls: 0, renderSeconds: 0 };
    const rows = [row, { ...row, task: 'b', score: 1 }, { ...row, repeat: 2 }, { ...row, task: 'b', repeat: 2, score: 1 }];
    expect(summarize(rows, ['baseline'])).toContain('| baseline | produce | 4 | 0.500 | 0.500–0.500 |');
  });
});
