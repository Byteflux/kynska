import { describe, expect, it } from 'vitest';
import { formatHarmony, harmonyOf, rankKeys } from '../src/patterns/harmony.ts';
import { parseSections } from '../src/patterns/sections.ts';

// A boom-bap loop in D minor: Dm9 Gm9 Bb^7 A7, a swung bass on the roots whose
// last note rings 1/24 cycle into the next bar, and a pentatonic melody.
const BEAT = `setcpm(90/4)
kick: s("bd ~ ~ bd ~ ~ bd ~").swing(4)
bass: note("<d2 g1 bb1 a1>").struct("x@10 x@6").s("gm_electric_bass_finger").swing(4)
keys: chord("<Dm9 Gm9 Bb^7 A7>").voicing().s("gm_epiano1")
melody: n("<[0 ~ 1 ~ 3 ~ 2 1] [~ 2 ~ 4 3 ~ ~ ~] [1 ~ 3 4 3 ~ 1 ~] [3 ~ ~ 2 ~ ~ 3 ~]>").scale("D4:minor:pentatonic").s("gm_vibraphone").swing(4)`;

describe('harmony', () => {
  it('ranks keys by how the note durations fit Krumhansl and Kessler profiles', () => {
    const cMajorScale = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
    cMajorScale[0] = 3; // a tonic heard most
    expect(rankKeys(cMajorScale)[0].name).toBe('C major');
    const aMinor = [1, 0, 1, 0, 1, 1, 0, 1, 0, 3, 0, 1];
    aMinor[4] = 2;
    expect(rankKeys(aMinor)[0].name).toBe('A minor');
  });

  it('reads the key, the out-of-key note, the chords over their roots and no clashes in a boom-bap loop', async () => {
    const report = await harmonyOf(BEAT, 8, parseSections('verse=4,hook=4'));
    for (const s of report.sections) {
      expect(s.key?.name).toBe('D minor');
      expect(s.changedFrom).toBeUndefined();
      // C# only, in the keys, on the A7 bars: the raised 7th of D minor.
      expect(s.outside.map((o) => o.name)).toEqual(['C#']);
      expect(s.outside[0].layers).toEqual(['3 keys: line 4']);
      expect(s.outside[0].why).toMatch(/raised 7th/);
      // The bass's last note of the bar before rings into the chord but is not its bass.
      expect(s.chords.map((c) => c.name)).toEqual(['Dm9', 'Gm9', 'Bb^7', 'A7']);
    }
    expect(report.sections[1].chords[0].position).toBe('bar 5');
    expect(report.chordLayers).toEqual(['3 keys: line 4']);
    // One bass note per bar is on the beat (the second is swung off it), every one a chord root.
    expect(report.fits.find((f) => f.layer.startsWith('2 bass'))).toMatchObject({ onBeat: 8, inChord: 8 });
    expect(report.clashes).toEqual([]);
    const text = formatHarmony(report);
    expect(text).toContain('verse  D minor');
    expect(text).toContain('Dm9 (bar 1) | Gm9 (bar 2) | Bb^7 (bar 3) | A7 (bar 4)');
    expect(text).toContain('Clashes (a note a minor 2nd or 9th above a note another layer holds, and not in the chord): none.');
  });

  it('reports a wrong note held over a chord as one clash, by bar and beat', async () => {
    const wrong = `keys: chord("Dm9").voicing().s("gm_epiano1")
melody: note("eb5 f5 a5 d5").s("gm_vibraphone")`;
    const report = await harmonyOf(wrong, 1);
    expect(report.clashes).toHaveLength(1);
    expect(report.clashes[0]).toMatchObject({ position: 'bar 1', note: 'Eb5', layer: '2 melody: line 2', beats: 1 });
    expect(report.clashes[0].over.map((o) => o.note)).toContain('D4');
    expect(formatHarmony(report)).toMatch(/bar 1: Eb5 \(2 melody: line 2\) over D4 \(1 keys: line 1\), 1 beat\b/);
  });

  it('lets a short note off the beat pass, and does not count a note the chord already holds', async () => {
    const passing = `keys: chord("Dm9").voicing().s("gm_epiano1")
melody: note("[d5 eb5] f5 a5 e5").s("gm_vibraphone")`;
    const report = await harmonyOf(passing, 1);
    // Eb5 starts off the beat and lasts half a beat over D4: a passing note, counted, not listed.
    expect(report.clashes).toEqual([]);
    expect(report.passing).toBe(1);
  });

  it('finds a change to the relative major between sections', async () => {
    // i iv V i in D minor, then I IV V I in F major.
    const piece = `bass: note("<d2 g1 a1 d2 f2 bb1 c2 f2>").s("sawtooth")
keys: chord("<Dm Gm A7 Dm F Bb C7 F>").voicing().s("gm_epiano1")`;
    const report = await harmonyOf(piece, 8, parseSections('verse=4,hook=4'));
    expect(report.sections.map((s) => s.key?.name)).toEqual(['D minor', 'F major']);
    expect(report.sections[1].changedFrom).toMatchObject({ key: 'D minor', notesChanged: 0, relation: 'relative major' });
    expect(formatHarmony(report)).toContain('changes key from D minor, relative major, 0 scale notes changed');
  });

  it('explains a borrowed note in a major key, and names no chords without a chord layer', async () => {
    const piece = `melody: note("<[c4 e4 g4 e4] [f4 a4 c5 a4] [g4 b4 d5 b4] [f4 ab4 c5 ab4]>").s("triangle")`;
    const report = await harmonyOf(piece, 4);
    expect(report.sections[0].key?.name).toBe('C major');
    expect(report.sections[0].outside).toEqual([expect.objectContaining({ name: 'Ab', bars: [4], why: expect.stringMatching(/parallel minor/) })]);
    expect(report.chordLayers).toEqual([]);
    expect(formatHarmony(report)).toContain('Chords: none named');
  });
});
