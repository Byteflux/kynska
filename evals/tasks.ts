// Eval tasks, scored in code from the events a candidate's code produces.
//  - transcribe: Strudel's own documented examples, given as their events; write
//    code that produces exactly those events. Score: event F1.
//  - describe: a musical brief in words; score: the share of its criteria met.
//  - produce: a production brief, scored on rendered audio and events.
import { createHash } from 'node:crypto';
import { ensureScope } from '../src/patterns/scope.ts';
import { runPattern, type PatternEvent } from '../src/patterns/events.ts';
import type { Reference } from '../src/reference/types.ts';
import { fraction, midiOf, near, onsetsOf, sameTimes } from './score.ts';
import { scoreProduction, type ProduceTask } from './produce.ts';
import type { RenderCosts } from './render.ts';
export { produceTasks } from './produce.ts';

export type Run = { events: PatternEvent[]; cps: number };
export type Criterion = { name: string; pass: (run: Run, noteToMidi: (n: string) => number) => boolean };

export type Task =
  | ProduceTask
  | { id: string; kind: 'transcribe'; cycles: number; prompt: string; expected: PatternEvent[]; solution: string }
  | { id: string; kind: 'describe'; cycles: number; prompt: string; criteria: Criterion[]; solution: string };

/**
 * Code a transcription task cannot fairly ask for: randomness, input devices, other
 * notations, loading. Each name matches as a word prefix, so `rand` covers `rand2`
 * and `randcat`; names that only end in one (`brand`, `undegradeBy`) are listed too.
 */
const UNFAIR = /\b(rand|irand|brand|perlin|choose|wchoose|shuffle|scramble|sometimes|someCycles|degrade|undegrade|often|rarely|almostNever|almostAlways|samples|initTidal|mondo|midi|input|gamepad|slider|K\()/;

/** Whether a documented example can be a transcription task. */
export const isFairExample = (code: string) => !UNFAIR.test(code) && code.length < 300;

/** Up to `count` transcription tasks from the reference's examples, in a stable order. */
export async function transcribeTasks(reference: Reference, count: number, cycles = 2): Promise<Task[]> {
  const candidates = reference.functions
    .filter((f) => f.callable.global || f.callable.method)
    .flatMap((f) => f.examples.map((code, i) => ({ id: `transcribe/${f.name}-${i + 1}`, code })))
    .filter(({ code }) => isFairExample(code))
    .sort((a, b) => createHash('sha1').update(a.id).digest('hex').localeCompare(createHash('sha1').update(b.id).digest('hex')));
  const tasks: Task[] = [];
  for (const { id, code } of candidates) {
    if (tasks.length >= count) break;
    let run;
    try {
      run = await runPattern(code, cycles);
    } catch {
      continue;
    }
    if (run.events.length < 2 || run.events.length > 32 || run.messages.length) continue;
    const listing = run.events.map((e) => e.show).join('\n');
    tasks.push({
      id,
      kind: 'transcribe',
      cycles,
      expected: run.events,
      solution: code,
      prompt: `Write Strudel code that produces exactly these events over the first ${cycles} cycles (time positions are in cycles; values are the event's controls):\n\n${listing}\n\nReply with the code in one \`\`\`js block.`,
    });
  }
  return tasks;
}

const sounds = (run: Run) => new Set(run.events.map((e) => (e.value as { s?: string })?.s));
const perCycle = (run: Run, cycles: number) =>
  Array.from({ length: cycles }, (_, c) => run.events.filter((e) => Math.floor(fraction(e.begin) + 1e-9) === c));
const grid = (cycles: number, steps: number, offset = 0) =>
  Array.from({ length: cycles * steps }, (_, i) => i / steps + offset / steps);

/** Hand-written briefs, each with criteria checked on the events and a known solution. */
export const describeTasks: Task[] = [
  {
    id: 'describe/four-on-the-floor',
    kind: 'describe',
    cycles: 2,
    prompt:
      'At 128 bpm with 4 beats per cycle: a kick drum (bd) on every beat and closed hi-hats (hh) on the offbeats (halfway between beats). Nothing else.',
    solution: 'setcpm(128/4)\n$: s("bd*4")\n$: s("[~ hh]*4")',
    criteria: [
      { name: 'tempo 128 bpm', pass: (r) => near(r.cps, 128 / 4 / 60, 1e-3) },
      { name: 'kick on every beat', pass: (r) => sameTimes(onsetsOf(r.events, 'bd'), grid(2, 4)) },
      { name: 'hats on the offbeats', pass: (r) => sameTimes(onsetsOf(r.events, 'hh'), grid(2, 4, 0.5)) },
      { name: 'only kick and hats', pass: (r) => [...sounds(r)].every((s) => s === 'bd' || s === 'hh') },
    ],
  },
  {
    id: 'describe/backbeat',
    kind: 'describe',
    cycles: 2,
    prompt:
      'A rock backbeat with 4 beats per cycle: kick (bd) on beats 1 and 3, snare (sd) on beats 2 and 4, and closed hi-hats (hh) on every eighth note.',
    solution: '$: s("bd ~ bd ~")\n$: s("~ sd ~ sd")\n$: s("hh*8")',
    criteria: [
      { name: 'kick on 1 and 3', pass: (r) => sameTimes(onsetsOf(r.events, 'bd'), grid(2, 2)) },
      { name: 'snare on 2 and 4', pass: (r) => sameTimes(onsetsOf(r.events, 'sd'), grid(2, 2, 0.5)) },
      { name: 'hats on eighths', pass: (r) => sameTimes(onsetsOf(r.events, 'hh'), grid(2, 8)) },
    ],
  },
  {
    id: 'describe/arpeggio',
    kind: 'describe',
    cycles: 1,
    prompt: 'One cycle of eighth notes: a rising C minor arpeggio C4 Eb4 G4 C5, played twice.',
    solution: 'note("c4 eb4 g4 c5 c4 eb4 g4 c5")',
    criteria: [
      { name: 'eight notes, evenly spaced', pass: (r) => sameTimes(r.events.map((e) => fraction(e.begin)).sort((a, b) => a - b), grid(1, 8)) },
      {
        name: 'pitches C4 Eb4 G4 C5 twice',
        pass: (r, m) => {
          const pitches = [...r.events].sort((a, b) => fraction(a.begin) - fraction(b.begin)).map((e) => midiOf(e, m));
          return JSON.stringify(pitches) === JSON.stringify([60, 63, 67, 72, 60, 63, 67, 72]);
        },
      },
    ],
  },
  {
    id: 'describe/progression',
    kind: 'describe',
    cycles: 4,
    prompt: 'Block chords, one per cycle, each held for the whole cycle: Cm7, Fm7, Bb7, Ebmaj7. Any voicing.',
    solution: 'chord("<Cm7 Fm7 Bb7 Eb^7>").voicing()',
    criteria: [
      ...[
        ['Cm7', [0, 3, 7, 10]],
        ['Fm7', [5, 8, 0, 3]],
        ['Bb7', [10, 2, 5, 8]],
        ['Ebmaj7', [3, 7, 10, 2]],
      ].map(([name, classes], cycle) => ({
        name: `cycle ${cycle + 1} is ${name}`,
        pass: (r: Run, m: (n: string) => number) => {
          const notes = perCycle(r, 4)[cycle as number];
          const pcs = new Set(notes.map((e) => midiOf(e, m)).filter((x): x is number => x !== undefined).map((x) => ((x % 12) + 12) % 12));
          const wanted = new Set(classes as number[]);
          return notes.length >= 3 && [...wanted].every((p) => pcs.has(p)) && [...pcs].every((p) => wanted.has(p));
        },
      })),
      {
        name: 'each chord sounds together for the whole cycle',
        pass: (r) => r.events.every((e) => near(fraction(e.begin) % 1, 0) && near(fraction(e.end) - fraction(e.begin), 1)),
      },
    ],
  },
  {
    id: 'describe/bassline',
    kind: 'describe',
    cycles: 4,
    prompt: 'A bass line of steady eighth notes on one root per cycle: C2, then F2, then Bb1, then Eb2.',
    solution: 'note("<c2 f2 bb1 eb2>").ply(8)',
    criteria: [
      { name: 'eighth notes throughout', pass: (r) => sameTimes(r.events.map((e) => fraction(e.begin)).sort((a, b) => a - b), grid(4, 8)) },
      {
        name: 'roots C2 F2 Bb1 Eb2, one per cycle',
        pass: (r, m) => perCycle(r, 4).every((notes, c) => notes.length > 0 && notes.every((e) => midiOf(e, m) === [36, 41, 34, 39][c])),
      },
    ],
  },
  {
    id: 'describe/euclid',
    kind: 'describe',
    cycles: 1,
    prompt: 'A euclidean rhythm: a kick (bd) with 3 hits spread as evenly as possible over 8 steps, and a rimshot (rim) with 5 hits over 8 steps.',
    solution: '$: s("bd(3,8)")\n$: s("rim(5,8)")',
    criteria: [
      { name: 'kick E(3,8)', pass: (r) => sameTimes(onsetsOf(r.events, 'bd'), [0, 3 / 8, 6 / 8]) },
      { name: 'rim E(5,8)', pass: (r) => sameTimes(onsetsOf(r.events, 'rim'), [0, 2 / 8, 3 / 8, 5 / 8, 6 / 8]) },
    ],
  },
  {
    id: 'describe/fill',
    kind: 'describe',
    cycles: 4,
    prompt: 'Closed hi-hats (hh) on eighth notes, except every 4th cycle (the last of each 4), where they double to sixteenth notes.',
    solution: 's("hh*8").lastOf(4, x => x.fast(2))',
    criteria: [
      { name: '8, 8, 8 then 16 hats per cycle', pass: (r) => JSON.stringify(perCycle(r, 4).map((c) => c.length)) === '[8,8,8,16]' },
      { name: 'evenly spaced in each cycle', pass: (r) => perCycle(r, 4).every((c) => sameTimes(c.map((e) => fraction(e.begin) % 1).sort((a, b) => a - b), grid(1, c.length))) },
    ],
  },
  {
    id: 'describe/dorian',
    kind: 'describe',
    cycles: 1,
    prompt: 'At 90 bpm with 4 beats per cycle, one note per beat: scale degrees 1, 3, 5 and 6 of D dorian starting from D4.',
    solution: 'setcpm(90/4)\nn("0 2 4 5").scale("D4:dorian")',
    criteria: [
      { name: 'tempo 90 bpm', pass: (r) => near(r.cps, 90 / 4 / 60, 1e-3) },
      { name: 'one note per beat', pass: (r) => sameTimes(r.events.map((e) => fraction(e.begin)).sort((a, b) => a - b), grid(1, 4)) },
      {
        name: 'D4 F4 A4 B4',
        pass: (r, m) => JSON.stringify([...r.events].sort((a, b) => fraction(a.begin) - fraction(b.begin)).map((e) => midiOf(e, m))) === '[62,65,69,71]',
      },
    ],
  },
];

export type Score = { score: number; detail: string; error?: string };

/** Scores candidate code for a task. Code that fails to evaluate scores 0. */
export async function scoreTask(task: Task, code: string, costs?: RenderCosts): Promise<Score> {
  if (task.kind === 'produce') return scoreProduction(task, code, costs);
  let run: Run;
  try {
    run = await runPattern(code, task.cycles);
  } catch (error) {
    return { score: 0, detail: 'did not evaluate', error: (error as Error).message };
  }
  if (task.kind === 'transcribe') {
    const { f1, precision, recall } = (await import('./score.ts')).eventF1(task.expected, run.events);
    return { score: f1, detail: `precision ${precision.toFixed(2)}, recall ${recall.toFixed(2)}` };
  }
  const { core } = await ensureScope();
  const results = task.criteria.map((c) => {
    try {
      return c.pass(run, core.noteToMidi);
    } catch {
      return false;
    }
  });
  const failed = task.criteria.filter((_, i) => !results[i]).map((c) => c.name);
  return {
    score: results.filter(Boolean).length / results.length,
    detail: failed.length ? `failed: ${failed.join('; ')}` : 'all criteria met',
  };
}
