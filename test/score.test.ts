import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareToReference, formatCompare } from '../src/patterns/compare.ts';
import { excerptMidi } from '../src/score/excerpt.ts';
import { readMidi, writeMidi, type WriteOptions } from '../src/score/midi.ts';
import { barMini, formatNotes, positionOf, readReferenceScore } from '../src/score/reference-score.ts';
import { strudelOf } from '../src/score/to-strudel.ts';

const TPQ = 480;
const q = (quarters: number) => Math.round(quarters * TPQ);
/** Notes as [pitch, start, length] in quarter notes. */
const notes = (list: [number, number, number][], channel = 0) => list.map(([pitch, start, length]) => ({ pitch, start: q(start), end: q(start + length), channel }));
const score = (options: WriteOptions, file = 'test.mid') => readReferenceScore(writeMidi({ ticksPerQuarter: TPQ, ...options }), file);

// C major scale up in quarter notes over two 4/4 bars, and a bass on each bar, at
// 120 bpm: one bar per cycle at Strudel's default tempo.
const scale = () =>
  score({
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [
      { name: 'melody', notes: notes([60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => [p, i, 1])) },
      { name: 'bass', notes: notes([[36, 0, 4], [43, 4, 4]]) },
    ],
  });

describe('readMidi', () => {
  it('reads running status, note-on with velocity 0 as note-off, and names', () => {
    // Format 0, one track: tempo 120, name "lead", then notes C4 and D4 with running status.
    const track = [
      0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20,
      0, 0xff, 0x03, 4, ...Buffer.from('lead'),
      0, 0x90, 60, 100,
      0x83, 0x60, 60, 0, // 480 ticks later: running status, velocity 0 ends C4
      0, 62, 90,
      0x83, 0x60, 0x80, 62, 0,
      0, 0xff, 0x2f, 0,
    ];
    const bytes = Uint8Array.from([...Buffer.from('MThd'), 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, ...Buffer.from('MTrk'), 0, 0, 0, track.length, ...track]);
    const midi = readMidi(bytes);
    expect(midi.ticksPerQuarter).toBe(480);
    expect(midi.tempos).toEqual([{ tick: 0, bpm: 120 }]);
    expect(midi.tracks[0].name).toBe('lead');
    expect(midi.notes.map((n) => [n.pitch, n.start, n.end, n.velocity])).toEqual([
      [60, 0, 480, 100],
      [62, 480, 960, 90],
    ]);
  });

  it('ends overlapping notes of one pitch oldest first, and an unreleased note with its track', () => {
    const midi = readMidi(writeMidi({ tracks: [{ notes: [{ pitch: 60, start: 0, end: 960 }, { pitch: 60, start: 480, end: 1440 }] }] }));
    expect(midi.notes.map((n) => [n.start, n.end])).toEqual([
      [0, 960],
      [480, 1440],
    ]);
  });

  it('refuses what it cannot read', () => {
    expect(() => readMidi(Buffer.from('RIFF....WAVE'))).toThrow(/not a standard MIDI file/);
    const smpte = Uint8Array.from([...Buffer.from('MThd'), 0, 0, 0, 6, 0, 0, 0, 0, 0xe7, 0x28]);
    expect(() => readMidi(smpte)).toThrow(/SMPTE/);
  });

  it('round-trips what writeMidi writes', () => {
    const midi = readMidi(writeMidi({ ticksPerQuarter: 96, tempos: [{ tick: 0, bpm: 90 }], timeSignatures: [{ tick: 0, numerator: 6, denominator: 8 }], tracks: [{ name: 'a', programs: { 0: 40 }, notes: [{ pitch: 67, start: 48, end: 96 }] }] }));
    expect(midi.timeSignatures).toEqual([{ tick: 0, numerator: 6, denominator: 8 }]);
    expect(midi.tempos[0].bpm).toBeCloseTo(90, 3);
    expect(midi.tracks[1]).toMatchObject({ name: 'a', programs: { 0: 40 } });
    expect(midi.notes).toEqual([{ track: 1, channel: 0, pitch: 67, velocity: 80, start: 48, end: 96 }]);
  });
});

describe('reference scores', () => {
  it('makes one part per track and channel, drums on channel 10 with Strudel names', () => {
    const s = score({ tracks: [{ name: 'kit', notes: notes([[36, 0, 0.5], [42, 0.5, 0.5], [38, 1, 0.5]], 9) }, { name: 'keys', notes: [...notes([[60, 0, 1]], 0), ...notes([[48, 0, 1]], 1)] }] });
    expect(s.parts.map((p) => [p.name, p.drums])).toEqual([
      ['kit', true],
      ['keys ch 1', false],
      ['keys ch 2', false],
    ]);
    expect(s.parts[0].notes.map((n) => n.drum)).toEqual(['bd', 'hh', 'sd']);
  });

  it('places bars by the metre, including a change, and positions by bar and beat', () => {
    const s = score({ timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }, { tick: q(8), numerator: 6, denominator: 8 }], tracks: [{ notes: notes([[60, 0, 1], [60, 13.5, 0.5]]) }] });
    expect(s.bars.map((b) => [b.number, b.start, b.end, `${b.numerator}/${b.denominator}`])).toEqual([
      [1, 0, 4, '4/4'],
      [2, 4, 8, '4/4'],
      [3, 8, 11, '6/8'],
      [4, 11, 14, '6/8'],
    ]);
    // 6/8 counts eighths: 2.5 quarters into bar 4 is its 6th eighth.
    expect(positionOf(s, 13.5)).toEqual({ bar: 4, beat: 6 });
    expect(positionOf(s, 5.5)).toEqual({ bar: 2, beat: 2.5 });
  });

  it('writes a bar as mini-notation, with rests, held steps and chords', () => {
    const s = score({ tracks: [{ notes: notes([[60, 0.5, 0.5], [62, 1, 1], [64, 3, 1], [67, 3, 1]]) }] });
    expect(barMini(s.parts[0].notes, s.bars[0])).toBe('~ c4 d4@2 ~@2 [e4,g4]@2');
  });

  it('writes bars joined by a held note as one line, and overlapping voices with ","', () => {
    // Bar 1: c4 for 2 beats, then d4 held 4 beats into bar 2; bar 3: e4 held over g4 g4.
    const s = score({ tracks: [{ notes: notes([[60, 0, 2], [62, 2, 4], [64, 8, 4], [55, 8, 2], [55, 10, 2]]) }] });
    const text = formatNotes(s);
    expect(text).toMatch(/\n {2}bars 1-2: c4 d4@2 ~\n/);
    expect(text).toMatch(/\n {2}bar 3: e4, g3 g3\n?/);
    expect(text).toMatch(/setcpm\(120\/4\)/);
  });

  it('lists a bar too fine for mini-notation by beat', () => {
    // A 64th-note triplet run: more than 48 steps in one 4/4 bar.
    const s = score({ tracks: [{ notes: notes([[60, 0, 1 / 24], [62, 1 / 24, 1 / 24], [64, 3, 1]]) }] });
    expect(formatNotes(s)).toMatch(/bar 1: 1: c4 \(0\.042\), 1\.042: d4 \(0\.042\), 4: e4 \(1\)/);
  });

  it('says when a note sounds on from before the first bar shown', () => {
    const s = score({ tracks: [{ notes: notes([[67, 2, 4], [69, 6, 1]]) }] });
    expect(formatNotes(s, { bars: [2, 2] })).toMatch(/bar 2: ~@2 a4 ~ {2}\(still sounding from an earlier bar: g4 until beat 3\)/);
  });

  it('cuts an excerpt with the tempo in effect at its first bar', () => {
    const s = score({ tempos: [{ tick: 0, bpm: 100 }, { tick: q(2), bpm: 80 }], tracks: [{ name: 'm', notes: notes([[60, 0, 1], [62, 4, 1], [64, 8, 6]]) }] });
    const cut = readReferenceScore(excerptMidi(s, [2, 3]), 'cut.mid');
    expect(cut.bpm).toBeCloseTo(80, 3);
    expect(cut.parts[0].notes.map((n) => [n.pitch, n.start, n.end])).toEqual([
      [62, 0, 1],
      [64, 4, 8], // held past the last bar: cut short at its end
    ]);
  });
});

describe('compareToReference', () => {
  const melody = 'note("<[c4 d4 e4 f4] [g4 a4 b4 c5]>")';
  const bass = 'note("<c2 g2>")';

  it('matches a faithful piece note for note', async () => {
    const report = await compareToReference(`setcpm(120/4)\n$: ${melody}\n$: ${bass}`, scale());
    expect(report.same).toBe(true);
    expect(report.notes).toMatchObject({ reference: 10, matched: 10, f1: 1 });
    expect(report.tempo).toEqual({ piece: 120, reference: 120, matches: true });
  });

  it('checks the tempo apart from the notes, and gives the setcpm that fixes it', async () => {
    const slow = await compareToReference(`setcpm(90/4)\n$: ${melody}\n$: ${bass}`, scale());
    expect(slow.notes.f1).toBe(1);
    expect(slow.same).toBe(false);
    expect(formatCompare(slow, scale())).toMatch(/warning: wrong tempo, which fails the comparison: the piece plays 25% too slow, at 90 bpm where the reference has 120\. Fix: setcpm\(120\/4\)\./);
    // Regression: a pilot run answered with both bars in one cycle at the one-bar
    // tempo, reading the old warning as a remark about how beats are compared.
    const fast = await compareToReference(`setcpm(120/4)\n$: note("c4 d4 e4 f4 g4 a4 b4 c5")\n$: note("c2 g2")`, scale());
    expect(fast.notes.f1).toBe(1);
    const text = formatCompare(fast, scale());
    expect(text).toMatch(/plays 2 times too fast, at 240 bpm .* fits 2 bars into each cycle\. Fix: setcpm\(120\/8\), or keep setcpm\(120\/4\) and slow every layer by 2/);
    expect(text).toMatch(/and nothing else, but at the wrong tempo/);
  });

  it('places a wrong note by bar and beat', async () => {
    const report = await compareToReference(`$: note("<[c4 d4 e4 f4] [g4 a4 bb4 c5]>")\n$: ${bass}`, scale());
    expect(report.same).toBe(false);
    expect(report.differences).toEqual([{ kind: 'changed', bar: 2, beat: 3, text: expect.stringMatching(/~ bar 2 beat 3: b4 → a#4 {2}\(part 1 "melody"; 1 \$: line 1\)/) }]);
    expect(report.parts.map((p) => [p.name, p.found, p.notes])).toEqual([
      ['melody', 7, 8],
      ['bass', 2, 2],
    ]);
  });

  it('reports missing and extra notes, and an added part in one line', async () => {
    const report = await compareToReference(`$: note("<[c4 d4 e4 f4] [g4 a4 b4 ~]>")\n$: ${bass}\n$: s("hh*4")`, scale());
    expect(report.differences.map((d) => d.text)).toEqual([
      expect.stringMatching(/^\+ 3 \$: line 3: all 8 notes \(hh\) are extra/),
      expect.stringMatching(/^- bar 2 beat 4: c5 \(1 beats\) missing/),
    ]);
    expect(report.notes).toMatchObject({ matched: 9, piece: 17 });
  });

  it('finds where the reference starts in a piece with an intro', async () => {
    const report = await compareToReference(`$: arrange([2, silence], [2, ${melody}], [2, silence])\n$: arrange([2, silence], [2, ${bass}], [2, silence])`, scale());
    expect(report.offset).toBe(2);
    expect(report.same).toBe(true);
  });

  // Regression: in the pilot a half-wrong piece lined up slightly better a beat
  // later, and every difference was reported at the wrong place.
  it('keeps one bar per cycle from cycle 0 unless another alignment is clearly better', async () => {
    // Bar 1 right; bar 2 wrong in a way that happens to match better one beat later.
    const report = await compareToReference(`$: note("<[c4 d4 e4 f4] [~ g4 a4 b4]>")\n$: ${bass}`, scale());
    expect(report).toMatchObject({ offset: 0, quartersPerCycle: 4, realigned: false });
    const intro = await compareToReference(`$: arrange([2, silence], [2, ${melody}])\n$: arrange([2, silence], [2, ${bass}])`, scale());
    expect(intro).toMatchObject({ offset: 2, realigned: true });
    expect(formatCompare(intro, scale())).toMatch(/found by alignment/);
  });

  it('finds two bars per cycle', async () => {
    const report = await compareToReference(`setcpm(120/8)\n$: note("c4 d4 e4 f4 g4 a4 b4 c5")\n$: note("c2 g2")`, scale());
    expect(report.quartersPerCycle).toBe(8);
    expect(report.same).toBe(true);
  });

  it('warns about a piece an octave down, and matches it with transpose', async () => {
    const low = `$: note("<[c3 d3 e3 f3] [g3 a3 b3 c4]>")\n$: note("<c1 g1>")`;
    const report = await compareToReference(low, scale());
    expect(report.notes.matched).toBe(0);
    expect(report.detectedTranspose).toEqual({ semitones: -12, matched: 10 });
    expect(formatCompare(report, scale())).toMatch(/1 octave down\); if that is meant, compare with --transpose=-12/);
    expect((await compareToReference(low, scale(), { transpose: -12 })).same).toBe(true);
  });

  it('compares only the bars asked for', async () => {
    const report = await compareToReference(`$: note("<[c4 d4 e4 f4] [g4 g4 g4 g4]>")\n$: ${bass}`, scale(), { bars: [1, 1] });
    expect(report.same).toBe(true);
    expect(report.notes.reference).toBe(5);
  });

  it('matches drums by name, whatever the bank', async () => {
    const kit = score({ tracks: [{ name: 'kit', notes: notes([[36, 0, 0.25], [42, 1, 0.25], [38, 2, 0.25], [42, 3, 0.25]], 9) }] });
    const report = await compareToReference('s("bd hh sd hh").bank("RolandTR909")', kit);
    expect(report.same).toBe(true);
    const wrong = await compareToReference('s("bd hh cp hh")', kit);
    expect(wrong.differences.map((d) => d.text)).toEqual([expect.stringMatching(/~ bar 1 beat 3: sd → cp/)]);
  });

  // Regression: in the Office piece the piano riff doubled the melody's notes, and
  // the reference note went to whichever came first, calling the melody's own note extra.
  it('credits a doubled note to the layer that plays it at its length', async () => {
    const s = score({ tracks: [{ name: 'tune', notes: notes([[64, 0, 2], [62, 2, 2]]) }] });
    const report = await compareToReference('$: note("e4 ~ ~ ~")\n$: note("e4@2 d4@2")', s, { quartersPerCycle: 4 });
    expect(report.layers.map((l) => [l.name, l.matched])).toEqual([
      ['1 $: line 1', 0],
      ['2 $: line 2', 2],
    ]);
    expect(report.differences.map((d) => d.text)).toEqual([expect.stringMatching(/^\+ 1 \$: line 1: its one note \(e4\) is extra/)]);
  });

  it('counts a different note length apart, without failing the match', async () => {
    const report = await compareToReference(`$: note("<[c4 d4 e4 f4] [g4 a4 b4 c5]>").legato(1)\n$: note("<[c2 ~] g2>")`, scale());
    expect(report.same).toBe(true);
    expect(report.lengths.differ).toBe(1);
  });
});

// Every reference excerpt, played back exactly from Strudel, matches itself: the
// reader, the bars, the cycle length and the comparison agree on every note.
describe('reference excerpts', () => {
  const dir = join(import.meta.dirname, 'references');
  const files = readdirSync(dir).filter((f) => f.endsWith('.mid'));

  it('has public-domain sources listed for every file', () => {
    const sources = readFileSync(join(dir, 'SOURCES.md'), 'utf8');
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const f of files) expect(sources).toContain(`| ${f} |`);
  });

  it.each(files)('%s round-trips through Strudel', async (file) => {
    const s = readReferenceScore(readFileSync(join(dir, file)), file);
    const report = await compareToReference(strudelOf(s), s);
    expect(report.notes.f1).toBe(1);
    expect(report.offset).toBe(0);
  });

  it('reports a wrong note in bar 3 of a real piece at bar 3', async () => {
    const s = readReferenceScore(readFileSync(join(dir, 'menuet-k2.mid')), 'menuet-k2.mid');
    const target = s.parts[0].notes.find((n) => n.start >= s.bars[2].start)!;
    const changed = { ...s, parts: s.parts.map((p) => ({ ...p, notes: p.notes.map((n) => (n === target ? { ...n, pitch: n.pitch + 1 } : n)) })) };
    const report = await compareToReference(strudelOf(changed), s);
    expect(report.differences).toHaveLength(1);
    expect(report.differences[0]).toMatchObject({ kind: 'changed', bar: 3 });
  });
});
