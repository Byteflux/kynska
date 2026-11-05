// Production briefs use the same final render settings for both conditions.
// Briefs state what to deliver, never which kynska command to use: the
// tool-less baseline read "use form" as a Strudel function and called form().
import { HEAVY_LIMITING_DB } from '../src/audio/master.ts';
import type { RenderReport } from '../src/audio/report.ts';
import { formOf } from '../src/patterns/form.ts';
import { parseSections } from '../src/patterns/sections.ts';
import { ensureScope } from '../src/patterns/scope.ts';
import { evalRender, type RenderCosts } from './render.ts';
import { fraction, midiOf, near } from './score.ts';
import type { Run, Score } from './tasks.ts';

/** `premaster`: the code's own mix, before the scoring render masters it. */
export type ProductionRun = Run & { report: RenderReport; form: Awaited<ReturnType<typeof formOf>>; premaster?: { clippedSamples: number; limiterDb: number } };
export type ProduceCriterion = { name: string; pass: (run: ProductionRun, midi: (note: string) => number) => boolean };
export type ProduceTask = { id: string; kind: 'produce'; cycles: number; bpm: number; sections: string; master?: number; prompt: string; solution: string; criteria: ProduceCriterion[] };

const sound = (e: Run['events'][number]) => (e.value as { s?: string }).s;
export const productionCriteria = {
  duration: (seconds: number): ProduceCriterion => ({ name: `duration ${seconds.toFixed(2)} s ±10%`, pass: (r) => near(r.report.stats.duration, seconds, seconds * 0.1) }),
  tempo: (bpm: number): ProduceCriterion => ({ name: `tempo ${bpm} bpm`, pass: (r) => near(r.cps * 240, bpm, 0.01) }),
  loudness: (target: number): ProduceCriterion => ({ name: `loudness ${target} LUFS ±1`, pass: (r) => r.report.stats.loudnessLufs !== null && near(r.report.stats.loudnessLufs, target, 1) }),
  peak: (ceiling: number): ProduceCriterion => ({ name: `peak at most ${ceiling} dBFS`, pass: (r) => Number.isFinite(r.report.stats.peakDb) && r.report.stats.peakDb <= ceiling + 1e-5 }),
  unclipped: (): ProduceCriterion => ({ name: 'zero clipped samples', pass: (r) => r.report.stats.clippedSamples === 0 }),
  // Mastering lifts any mix to the target and holds its peaks, so on mastered
  // briefs these measure what the code did: a mix that does not clip, balanced
  // well enough that the limiter does not flatten it.
  mixUnclipped: (): ProduceCriterion => ({ name: 'zero clipped samples before mastering', pass: (r) => r.premaster?.clippedSamples === 0 }),
  limiting: (maxDb: number): ProduceCriterion => ({ name: `limiter takes at most ${maxDb} dB off peaks`, pass: (r) => r.premaster !== undefined && r.premaster.limiterDb <= maxDb }),
  sounds: (from: number, to: number, wanted: string[]): ProduceCriterion => ({
    name: `bars ${from + 1}-${to}: exactly ${wanted.join(', ')} in each bar`,
    pass: (r) => Array.from({ length: to - from }, (_, i) => {
      const actual = new Set(r.events.filter((e) => fraction(e.begin) >= from + i && fraction(e.begin) < from + i + 1).map(sound));
      return actual.size === wanted.length && wanted.every((s) => actual.has(s));
    }).every(Boolean),
  }),
  pitches: (s: string, options: { key?: number[]; range?: [number, number] }): ProduceCriterion => ({
    name: `${s} pitches ${options.key ? `in pitch classes ${options.key}` : `in MIDI range ${options.range}`}`,
    pass: (r, midi) => {
      const notes = r.events.filter((e) => sound(e) === s).map((e) => midiOf(e, midi));
      return notes.length > 0 && notes.every((n) => n !== undefined && Number.isFinite(n) && (!options.key || options.key.includes(((n % 12) + 12) % 12)) && (!options.range || (n >= options.range[0] && n <= options.range[1])));
    },
  }),
  layers: (count: number): ProduceCriterion => ({ name: `${count} audible layers`, pass: (r) => r.form.layers.filter((l) => l.events > 0).length === count }),
  contrast: (quiet: string, loud: string, db: number): ProduceCriterion => ({
    name: `${loud} at least ${db} LU louder than ${quiet}`,
    pass: (r) => {
      const a = r.report.sections?.find((s) => s.name === quiet)?.loudnessLufs;
      const b = r.report.sections?.find((s) => s.name === loud)?.loudnessLufs;
      return a != null && b != null && b - a >= db;
    },
  }),
};

const c = productionCriteria;
const C_MINOR = [0, 2, 3, 5, 7, 8, 10];
const D_DORIAN = [0, 2, 4, 5, 7, 9, 11];

const briefs: Omit<ProduceTask, 'kind' | 'criteria'>[] = [
  {
    id: 'produce/intro-band', cycles: 8, bpm: 120, sections: 'intro=2,band=6',
    prompt: 'Make 8 bars at 120 bpm. Bars 1-2: kick bd only. Bars 3-8: bd, sd, a sawtooth bass and a triangle melody in every bar. Both pitched parts must stay in C natural minor. Use four labelled layers.',
    solution: 'setcpm(120/4)\n$: s("bd*4").bank("RolandTR909").gain(.25)\n$: s("~ sd ~ sd").bank("RolandTR909").gain(.2).mask("<0 0 1 1 1 1 1 1>")\n$: note("c2 eb2 g2 bb2").s("sawtooth").gain(.08).mask("<0 0 1 1 1 1 1 1>")\n$: note("c4 eb4 g4 bb4").s("triangle").gain(.12).mask("<0 0 1 1 1 1 1 1>")',
  },
  {
    id: 'produce/mastered-beat', cycles: 8, bpm: 128, sections: 'beat=8', master: -14,
    prompt: 'Make an 8-bar beat at 128 bpm: bd, sd and hh in every bar, three labelled layers. Deliver at -14 LUFS with peaks no higher than -1 dBFS.',
    solution: 'setcpm(128/4)\n$: s("bd*4").bank("RolandTR909").gain(.4)\n$: s("~ sd ~ sd").bank("RolandTR909").gain(.3)\n$: s("hh*8").bank("RolandTR909").gain(.15)',
  },
  {
    id: 'produce/breakdown', cycles: 12, bpm: 144, sections: 'A=4,break=4,return=4',
    prompt: 'Make 12 bars at 144 bpm, three labelled layers. Bars 1-4 and 9-12 have bd, hh and a sine bass. Bars 5-8 have only the sine bass. Keep the bass between C2 and C3 inclusive.',
    solution: 'setcpm(144/4)\n$: s("bd*4").bank("RolandTR909").gain(.3).mask("<1 1 1 1 0 0 0 0 1 1 1 1>")\n$: s("hh*8").bank("RolandTR909").gain(.1).mask("<1 1 1 1 0 0 0 0 1 1 1 1>")\n$: note("c2 g2 c3 g2").s("sine").gain(.15)',
  },
  {
    id: 'produce/bass-drums', cycles: 8, bpm: 100, sections: 'groove=8',
    prompt: 'Make 8 bars at 100 bpm, with bd, sd and a triangle bass in every bar. Bass notes must stay between E1 and E2 inclusive. Use three labelled layers.',
    solution: 'setcpm(100/4)\n$: s("bd ~ bd ~").bank("RolandTR909").gain(.3)\n$: s("~ sd ~ sd").bank("RolandTR909").gain(.2)\n$: note("e1 b1 d2 e2").s("triangle").gain(.15)',
  },
  {
    id: 'produce/quiet-loud', cycles: 8, bpm: 120, sections: 'quiet=4,loud=4',
    prompt: 'Make 8 bars at 120 bpm. A single labelled sine melody plays every bar in D dorian, with no other sounds. Bars 5-8 must measure at least 6 LU louder than bars 1-4. Keep peaks under -3 dBFS.',
    solution: 'setcpm(120/4)\n$: note("d4 f4 a4 b4").s("sine").gain("<.06 .06 .06 .06 .3 .3 .3 .3>")',
  },
  {
    id: 'produce/mastered-arrangement', cycles: 16, bpm: 160, sections: 'intro=4,body=8,outro=4', master: -18,
    prompt: 'Make 16 bars at 160 bpm with three labelled layers. Bars 1-4: hh only. Bars 5-12: hh, bd and a sawtooth bass in every bar. Bars 13-16: hh and bass, no bd. Bass stays in A natural minor. Deliver at -18 LUFS with peaks no higher than -1 dBFS.',
    solution: 'setcpm(160/4)\n$: s("hh*8").bank("RolandTR909").gain(.12)\n$: s("bd*4").bank("RolandTR909").gain(.3).mask("<0 0 0 0 1 1 1 1 1 1 1 1 0 0 0 0>")\n$: note("a1 c2 e2 g2").s("sawtooth").gain(.1).mask("<0 0 0 0 1 1 1 1 1 1 1 1 1 1 1 1>")',
  },
];

const extra: ProduceCriterion[][] = [
  [c.sounds(0, 2, ['bd']), c.sounds(2, 8, ['bd', 'sd', 'sawtooth', 'triangle']), c.pitches('sawtooth', { key: C_MINOR }), c.pitches('triangle', { key: C_MINOR }), c.layers(4)],
  [c.sounds(0, 8, ['bd', 'sd', 'hh']), c.layers(3)],
  [c.sounds(0, 4, ['bd', 'hh', 'sine']), c.sounds(4, 8, ['sine']), c.sounds(8, 12, ['bd', 'hh', 'sine']), c.pitches('sine', { range: [36, 48] }), c.layers(3)],
  [c.sounds(0, 8, ['bd', 'sd', 'triangle']), c.pitches('triangle', { range: [28, 40] }), c.layers(3)],
  [c.sounds(0, 8, ['sine']), c.pitches('sine', { key: D_DORIAN }), c.layers(1), c.contrast('quiet', 'loud', 6)],
  [c.sounds(0, 4, ['hh']), c.sounds(4, 12, ['hh', 'bd', 'sawtooth']), c.sounds(12, 16, ['hh', 'sawtooth']), c.pitches('sawtooth', { key: [0, 2, 4, 5, 7, 9, 11] }), c.layers(3)],
];

export const produceTasks: ProduceTask[] = briefs.map((brief, i) => ({
  ...brief, kind: 'produce',
  prompt: `${brief.prompt} Use .bank("RolandTR909") for drums (sample 0 is cached). One bar is one cycle of 4 beats; bar numbers start at 1. Duration must be within 10% of ${brief.cycles * 240 / brief.bpm} seconds, with zero clipped samples. ${brief.master === undefined ? `Peaks must stay at or below ${i === 4 ? -3 : -1} dBFS.` : `The final scoring render masters your mix to ${brief.master} LUFS with a -1 dBFS limiter ceiling. Before mastering your mix must have zero clipped samples, and it must be balanced so the limiter takes at most ${HEAVY_LIMITING_DB} dB off peaks.`} Sections, in bars: ${brief.sections.replace(/,/g, ', ')}. Reply with code in one \`\`\`js block.`,
  criteria: [c.duration(brief.cycles * 240 / brief.bpm), c.tempo(brief.bpm), c.peak(i === 4 ? -3 : -1), c.unclipped(), ...(brief.master === undefined ? [] : [c.loudness(brief.master), c.mixUnclipped(), c.limiting(HEAVY_LIMITING_DB)]), ...extra[i]],
}));

export async function scoreProduction(task: ProduceTask, code: string, costs?: RenderCosts): Promise<Score> {
  try {
    const { report, events, premaster } = await evalRender(code, { cycles: task.cycles, sections: task.sections, master: task.master }, costs);
    if (report.errors.length || !events.length || !Number.isFinite(report.stats.peakDb)) return { score: 0, detail: 'unplayable render', error: report.errors.join('; ') || 'silent or empty audio' };
    const form = await formOf(code, task.cycles, 'js', parseSections(task.sections));
    const { core } = await ensureScope();
    const run = { events, cps: report.cps, report, form, premaster };
    const failed = task.criteria.filter((criterion) => {
      try { return !criterion.pass(run, core.noteToMidi); } catch { return true; }
    });
    return { score: (task.criteria.length - failed.length) / task.criteria.length, detail: failed.length ? `failed: ${failed.map((c) => c.name).join('; ')}` : 'all criteria met' };
  } catch (error) {
    return { score: 0, detail: 'did not render', error: (error as Error).message };
  }
}
