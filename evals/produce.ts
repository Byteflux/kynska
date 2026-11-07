// Production briefs use the same final render settings for both conditions.
// Briefs state what to deliver, never which kynska command to use: the
// tool-less baseline read "use form" as a Strudel function and called form().
import { HEAVY_LIMITING_DB } from '../src/audio/master.ts';
import type { RenderReport } from '../src/audio/report.ts';
import { formOf } from '../src/patterns/form.ts';
import { harmonyOf, type HarmonyReport } from '../src/patterns/harmony.ts';
import { parseSections } from '../src/patterns/sections.ts';
import { ensureScope } from '../src/patterns/scope.ts';
import { evalRender, type RenderCosts } from './render.ts';
import { fraction, midiOf, near } from './score.ts';
import type { Run, Score } from './tasks.ts';

/** `premaster`: the code's own mix, before the scoring render masters it. */
export type ProductionRun = Run & { report: RenderReport; form: Awaited<ReturnType<typeof formOf>>; harmony?: HarmonyReport; premaster?: { clippedSamples: number; limiterDb: number } };
export type ProduceCriterion = { name: string; pass: (run: ProductionRun, midi: (note: string) => number) => boolean };
/**
 * `tempoRange`: a genre brief, which names the genre but not the tempo, so the
 * tempo is scored against the genre's range and the brief gives its length in
 * bars, not seconds; `bpm` is then the known solution's tempo.
 */
export type ProduceTask = { id: string; kind: 'produce'; cycles: number; bpm: number; tempoRange?: [number, number]; sections: string; master?: number; prompt: string; solution: string; criteria: ProduceCriterion[] };

const sound = (e: Run['events'][number]) => (e.value as { s?: string }).s;
const pcOf = (n: number) => ((Math.round(n) % 12) + 12) % 12;
const bars = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
/** Pitch classes of the pitched events starting in bar `bar` (zero-based), optionally of one sound. */
function pitchClassesIn(r: ProductionRun, midi: (note: string) => number, bar: number, s?: string): number[] {
  return r.events
    .filter((e) => fraction(e.begin) >= bar - 1e-9 && fraction(e.begin) < bar + 1 - 1e-9 && (s === undefined || sound(e) === s))
    .map((e) => midiOf(e, midi))
    .filter((n): n is number => n !== undefined && Number.isFinite(n))
    .map(pcOf);
}
/** Position within the beat, 0 to 1, for 4 beats per cycle. */
const inBeat = (t: number) => ((t * 4) % 1 + 1) % 1;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
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
  tempoRange: (lo: number, hi: number): ProduceCriterion => ({ name: `tempo ${lo} to ${hi} bpm`, pass: (r) => r.cps * 240 >= lo - 0.01 && r.cps * 240 <= hi + 0.01 }),
  /** In every bar, `s` starts exactly at these positions in the bar (fractions of a cycle). */
  onlyAt: (s: string, cycles: number, positions: number[]): ProduceCriterion => ({
    name: `${s} at ${positions.map((p) => `${p * 4 + 1}`).join(' and ')} of every bar, and nowhere else`,
    pass: (r) => bars(0, cycles).every((bar) => {
      const at = r.events.filter((e) => sound(e) === s && Math.floor(fraction(e.begin) + 1e-9) === bar).map((e) => fraction(e.begin) - bar).sort((a, b) => a - b);
      return at.length === positions.length && at.every((t, i) => near(t, positions[i]));
    }),
  }),
  /** `s` plays eighths in every bar: four on the beats, four off them at `lo` to `hi` of the beat (straight is 0.5). */
  swungEighths: (s: string, cycles: number, lo: number, hi: number): ProduceCriterion => ({
    name: `${s} swung eighths: off-beats at ${lo} to ${hi} of the beat`,
    pass: (r) => bars(0, cycles).every((bar) => {
      const at = r.events.filter((e) => sound(e) === s && Math.floor(fraction(e.begin) + 1e-9) === bar).map((e) => inBeat(fraction(e.begin)));
      const on = at.filter((p) => near(p, 0) || near(p, 1));
      const off = at.filter((p) => !near(p, 0) && !near(p, 1));
      return at.length === 8 && on.length === 4 && off.every((p) => p >= lo - 1e-9 && p <= hi + 1e-9);
    }),
  }),
  /** Every pitched note in a minor key: some tonic whose natural minor, with its raised 6th and 7th, holds them all. */
  minorKey: (cycles: number): ProduceCriterion => ({
    name: 'pitched notes in one minor key (natural, harmonic or melodic minor)',
    pass: (r, midi) => {
      const pcs = new Set(bars(0, cycles).flatMap((b) => pitchClassesIn(r, midi, b)));
      return pcs.size >= 3 && Array.from({ length: 12 }, (_, t) => new Set([0, 2, 3, 5, 7, 8, 9, 10, 11].map((i) => (i + t) % 12))).some((key) => [...pcs].every((p) => key.has(p)));
    },
  }),
  /** Bars from-to (zero-based, end exclusive) use only these pitch classes, and, if given, each bar includes `must`. */
  inScale: (from: number, to: number, pcs: number[], must: number[] = []): ProduceCriterion => ({
    name: `bars ${from + 1}-${to}: notes only from ${pcs.map((p) => NAMES[p]).join(' ')}${must.length ? `, with ${must.map((p) => NAMES[p]).join(' and ')} in each bar` : ''}`,
    pass: (r, midi) => bars(from, to).every((b) => {
      const got = pitchClassesIn(r, midi, b);
      return got.length > 0 && got.every((p) => pcs.includes(p)) && must.every((p) => got.includes(p));
    }),
  }),
  /** In bar `bar`, sound `s` plays every pitch class of `chord` and none outside it; the fifth may be left out, as Strudel's voicings often do. */
  chordIn: (bar: number, s: string, chord: string, pcs: number[]): ProduceCriterion => ({
    name: `bar ${bar + 1}: ${chord} in ${s}`,
    pass: (r, midi) => {
      const got = new Set(pitchClassesIn(r, midi, bar, s));
      const fifth = (pcs[0] + 7) % 12;
      return pcs.every((p) => got.has(p) || (p === fifth && pcs.length > 3)) && [...got].every((p) => pcs.includes(p));
    },
  }),
  /** Sound `s` starts a note on every beat of every bar. */
  everyBeat: (s: string, cycles: number): ProduceCriterion => ({
    name: `${s} on every beat`,
    pass: (r) => bars(0, cycles * 4).every((beat) => r.events.some((e) => sound(e) === s && near(fraction(e.begin), beat / 4))),
  }),
  /** Of `s`'s notes on the beat, at least `share` are pitch classes the `chord` sound holds at that moment. */
  chordTonesOnBeat: (s: string, chord: string, share: number): ProduceCriterion => ({
    name: `${s} plays notes of the ${chord} chord on at least ${Math.round(share * 100)}% of beats`,
    pass: (r, midi) => {
      const onBeat = r.events.filter((e) => sound(e) === s && (near(inBeat(fraction(e.begin)), 0) || near(inBeat(fraction(e.begin)), 1)));
      if (!onBeat.length) return false;
      const fits = onBeat.filter((e) => {
        const t = fraction(e.begin);
        const held = r.events.filter((c) => sound(c) === chord && fraction(c.begin) <= t + 1e-9 && fraction(c.end) > t + 1e-9).map((c) => midiOf(c, midi)).filter((n): n is number => n !== undefined).map(pcOf);
        const p = midiOf(e, midi);
        return p !== undefined && held.includes(pcOf(p));
      });
      return fits.length / onBeat.length >= share - 1e-9;
    },
  }),
  /** kynska harmony lists no clashes. */
  noClashes: (): ProduceCriterion => ({ name: 'no clashes (a note a minor 2nd or 9th above a note another layer holds, not in the chord)', pass: (r) => r.harmony !== undefined && r.harmony.clashes.length === 0 }),
  /** kynska harmony names these keys for the brief's sections, in order. */
  keys: (names: string[]): ProduceCriterion => ({ name: `sections in ${names.join(', then ')}`, pass: (r) => r.harmony !== undefined && names.every((n, i) => r.harmony!.sections[i]?.key?.name === n) }),
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
  // Theory and genre briefs: they name a genre or a musical idea, not the notes,
  // so they score what an agent knows and checks about keys, chords and style.
  {
    id: 'produce/boom-bap', cycles: 8, bpm: 90, tempoRange: [85, 95], sections: 'loop=8',
    prompt: 'Make 8 bars of a boom-bap hip-hop beat at a typical boom-bap tempo, in five labelled layers: bd, sd, hh, a sawtooth bass and triangle chords. The drums follow the style\'s conventions: the snare on its usual beats and nowhere else, and hh in swung eighth notes. The bass and chords stay in one minor key.',
    solution: 'setcpm(90/4)\nkick: s("bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~").bank("RolandTR909").gain(.3).swing(4)\nsnare: s("~ sd ~ sd").bank("RolandTR909").gain(.2).swing(4)\nhats: s("hh*8").bank("RolandTR909").gain("[.1 .06]*4").swing(4)\nbass: note("<d2 g1 bb1 a1>").struct("x@10 x@6").s("sawtooth").lpf(600).gain(.12).swing(4)\nkeys: chord("<Dm9 Gm9 Bb^7 A7>").voicing().s("triangle").gain(.05)',
  },
  {
    id: 'produce/key-change', cycles: 8, bpm: 100, sections: 'first=4,second=4',
    prompt: 'Make 8 bars at 100 bpm in three labelled layers: triangle chords, a sawtooth bass and a sine melody, all three in every bar. Bars 1-4 are in C major. Bars 5-8 lift the whole piece a whole step up, into D major: every note in bars 5-8 belongs to D major, and the music must sound in D major, not just borrow its notes.',
    solution: 'setcpm(100/4)\nkeys: chord("<C Am F G D Bm G A>").voicing().s("triangle").gain(.05)\nbass: note("<c2 a1 f1 g1 d2 b1 g1 a1>").s("sawtooth").lpf(600).gain(.12)\nmelody: n("<[0 2 4 2] [5 0 2 0] [3 5 7 5] [4 6 8 6]>").scale("<C4:major!4 D4:major!4>").s("sine").gain(.1)',
  },
  {
    id: 'produce/melody-over-chords', cycles: 8, bpm: 90, sections: 'loop=8',
    prompt: 'Make 8 bars at 90 bpm in three labelled layers. Triangle chords play Dm7, G7, Cmaj7 and A7, one chord per bar, twice through. A sawtooth bass plays each chord\'s root. A sine melody starts a note on every beat, plays a note of the chord sounding on at least 75% of beats, and never clashes with the chords: no melody note a minor 2nd or minor 9th above a chord note that sounds with it, unless the chord also holds the melody note.',
    solution: 'setcpm(90/4)\nkeys: chord("<Dm7 G7 C^7 A7>").voicing().s("triangle").gain(.05)\nbass: note("<d2 g1 c2 a1>").s("sawtooth").lpf(500).gain(.12)\nmelody: note("<[f4 a4 c5 a4] [f4 g4 b4 d5] [e4 g4 b4 g4] [e4 g4 a4 c#5]>").s("sine").gain(.1)',
  },
  {
    id: 'produce/borrowed-chord', cycles: 8, bpm: 80, sections: 'loop=8',
    prompt: 'Make 8 bars at 80 bpm in two labelled layers, triangle chords and a sawtooth bass on the chord roots, one chord per bar. Bars 1-3 play I, vi and IV in C major; bar 4 plays the minor iv borrowed from C minor. Bars 5-8 repeat bars 1-4.',
    solution: 'setcpm(80/4)\nkeys: chord("<C Am F Fm>").voicing().s("triangle").gain(.06)\nbass: note("<c2 a1 f1 f1>").s("sawtooth").lpf(500).gain(.12)',
  },
];

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const D_MAJOR = [2, 4, 6, 7, 9, 11, 1];

const extra: ProduceCriterion[][] = [
  [c.sounds(0, 2, ['bd']), c.sounds(2, 8, ['bd', 'sd', 'sawtooth', 'triangle']), c.pitches('sawtooth', { key: C_MINOR }), c.pitches('triangle', { key: C_MINOR }), c.layers(4)],
  [c.sounds(0, 8, ['bd', 'sd', 'hh']), c.layers(3)],
  [c.sounds(0, 4, ['bd', 'hh', 'sine']), c.sounds(4, 8, ['sine']), c.sounds(8, 12, ['bd', 'hh', 'sine']), c.pitches('sine', { range: [36, 48] }), c.layers(3)],
  [c.sounds(0, 8, ['bd', 'sd', 'triangle']), c.pitches('triangle', { range: [28, 40] }), c.layers(3)],
  [c.sounds(0, 8, ['sine']), c.pitches('sine', { key: D_DORIAN }), c.layers(1), c.contrast('quiet', 'loud', 6)],
  [c.sounds(0, 4, ['hh']), c.sounds(4, 12, ['hh', 'bd', 'sawtooth']), c.sounds(12, 16, ['hh', 'sawtooth']), c.pitches('sawtooth', { key: [0, 2, 4, 5, 7, 9, 11] }), c.layers(3)],
  [c.sounds(0, 8, ['bd', 'sd', 'hh', 'sawtooth', 'triangle']), c.onlyAt('sd', 8, [1 / 4, 3 / 4]), c.swungEighths('hh', 8, 0.55, 0.7), c.minorKey(8), c.layers(5)],
  [c.sounds(0, 8, ['triangle', 'sawtooth', 'sine']), c.inScale(0, 4, C_MAJOR), c.inScale(4, 8, D_MAJOR), c.keys(['C major', 'D major']), c.layers(3)],
  [
    c.sounds(0, 8, ['triangle', 'sawtooth', 'sine']),
    ...[['Dm7', [2, 5, 9, 0]], ['G7', [7, 11, 2, 5]], ['Cmaj7', [0, 4, 7, 11]], ['A7', [9, 1, 4, 7]]].flatMap(([name, pcs], i) => [i, i + 4].map((bar) => c.chordIn(bar, 'triangle', name as string, pcs as number[]))),
    c.everyBeat('sine', 8), c.chordTonesOnBeat('sine', 'triangle', 0.75), c.noClashes(), c.layers(3),
  ],
  [
    c.sounds(0, 8, ['triangle', 'sawtooth']),
    ...[['C', [0, 4, 7]], ['Am', [9, 0, 4]], ['F', [5, 9, 0]], ['Fm', [5, 8, 0]]].flatMap(([name, pcs], i) => [i, i + 4].map((bar) => c.chordIn(bar, 'triangle', name as string, pcs as number[]))),
    c.inScale(0, 3, C_MAJOR), c.inScale(4, 7, C_MAJOR), c.layers(2),
  ],
];

export const produceTasks: ProduceTask[] = briefs.map((brief, i) => ({
  ...brief, kind: 'produce',
  // The drum bank only where the brief has drums: told it in every brief, agents
  // added a drum layer to the chords-only ones, failing their sounds and layers.
  prompt: `${brief.prompt}${/\b(bd|sd|hh|drums?)\b/.test(brief.prompt) ? ' Use .bank("RolandTR909") for drums (sample 0 is cached).' : ''} One bar is one cycle of 4 beats; bar numbers start at 1. ${brief.tempoRange ? `The piece is ${brief.cycles} bars long` : `Duration must be within 10% of ${brief.cycles * 240 / brief.bpm} seconds`}, with zero clipped samples. ${brief.master === undefined ? `Peaks must stay at or below ${i === 4 ? -3 : -1} dBFS.` : `The final scoring render masters your mix to ${brief.master} LUFS with a -1 dBFS limiter ceiling. Before mastering your mix must have zero clipped samples, and it must be balanced so the limiter takes at most ${HEAVY_LIMITING_DB} dB off peaks.`} Sections, in bars: ${brief.sections.replace(/,/g, ', ')}. Reply with code in one \`\`\`js block.`,
  criteria: [...(brief.tempoRange ? [c.tempoRange(...brief.tempoRange)] : [c.duration(brief.cycles * 240 / brief.bpm), c.tempo(brief.bpm)]), c.peak(i === 4 ? -3 : -1), c.unclipped(), ...(brief.master === undefined ? [] : [c.loudness(brief.master), c.mixUnclipped(), c.limiting(HEAVY_LIMITING_DB)]), ...extra[i]],
}));

export async function scoreProduction(task: ProduceTask, code: string, costs?: RenderCosts): Promise<Score> {
  try {
    const { report, events, premaster } = await evalRender(code, { cycles: task.cycles, sections: task.sections, master: task.master }, costs);
    if (report.errors.length || !events.length || !Number.isFinite(report.stats.peakDb)) return { score: 0, detail: 'unplayable render', error: report.errors.join('; ') || 'silent or empty audio' };
    const form = await formOf(code, task.cycles, 'js', parseSections(task.sections));
    const harmony = await harmonyOf(code, task.cycles, parseSections(task.sections));
    const { core } = await ensureScope();
    const run = { events, cps: report.cps, report, form, harmony, premaster };
    const failed = task.criteria.filter((criterion) => {
      try { return !criterion.pass(run, core.noteToMidi); } catch { return true; }
    });
    return { score: (task.criteria.length - failed.length) / task.criteria.length, detail: failed.length ? `failed: ${failed.map((c) => c.name).join('; ')}` : 'all criteria met' };
  } catch (error) {
    return { score: 0, detail: 'did not render', error: (error as Error).message };
  }
}
