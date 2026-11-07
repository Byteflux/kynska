// The harmony of a piece from its events, with no audio: the key of each section
// and the notes outside it, the chord at each change with the bass under it, how
// often each melodic layer lands on a chord tone on the beat, and clashes between
// layers. It makes the decisions in skills/strudel/theory.md checkable.
import { Chord } from '@tonaljs/tonal';
import { num } from '../score/reference-score.ts';
import { pieceNotes } from './compare.ts';
import type { Language } from './evaluate.ts';
import type { Section } from './sections.ts';

export type HarmonyOptions = {
  /** Beats per cycle, for bar and beat positions and what counts as on the beat. Default 4. */
  beatsPerCycle?: number;
  /** Overlaps shorter than this, in cycles, are not clashes. Default 1/16. */
  minOverlap?: number;
  language?: Language;
};

type Note = { layer: string; start: number; end: number; pitch: number };

export type KeyName = { tonic: number; mode: 'major' | 'minor'; name: string; r: number };
export type OutsideNote = { name: string; events: number; layers: string[]; bars: number[]; why?: string };
export type ChordChange = { at: number; position: string; name: string; bass: string; notes: string[] };
export type Clash = { at: number; position: string; note: string; layer: string; over: { note: string; layer: string }[]; beats: number };
export type SectionHarmony = Section & {
  key?: KeyName;
  next?: KeyName;
  /** The best key is barely ahead of the next: the section's notes fit both. */
  unclear?: boolean;
  /** The previous section's key, when this section changes key, and how many scale notes differ. */
  changedFrom?: { key: string; notesChanged: number; relation?: string };
  outside: OutsideNote[];
  chords: ChordChange[];
};
export type LayerFit = { layer: string; onBeat: number; inChord: number; examples: string[] };
export type HarmonyReport = {
  cycles: number;
  beatsPerCycle: number;
  sections: SectionHarmony[];
  chordLayers: string[];
  fits: LayerFit[];
  clashes: Clash[];
  passing: number;
};

// Krumhansl and Kessler's key profiles (1982): how well each of the 12 pitch
// classes, from the tonic up, was judged to fit a major or minor key. The key
// whose profile correlates best with a passage's note durations is its key
// (the Krumhansl–Schmuckler key-finding algorithm).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_TONICS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_TONICS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Below this lead in correlation over the next key, the key is reported as unclear. */
const CLEAR_MARGIN = 0.05;
const EPS = 1e-9;

const pc = (pitch: number) => ((Math.round(pitch) % 12) + 12) % 12;

function correlation(x: number[], y: number[]): number {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** The 24 keys, best first, for pitch-class weights (durations). */
export function rankKeys(weights: number[]): KeyName[] {
  const keys: KeyName[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = weights.map((_, i) => weights[(i + tonic) % 12]);
    keys.push({ tonic, mode: 'major', name: `${MAJOR_TONICS[tonic]} major`, r: correlation(rotated, MAJOR_PROFILE) });
    keys.push({ tonic, mode: 'minor', name: `${MINOR_TONICS[tonic]} minor`, r: correlation(rotated, MINOR_PROFILE) });
  }
  return keys.sort((a, b) => b.r - a.r);
}

const scaleOf = (key: KeyName) => (key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map((s) => (s + key.tonic) % 12);

/** Keys whose signature has flats (by their relative major: F, Bb, Eb, Ab, Db) spell with flats. */
function usesFlats(key: KeyName): boolean {
  const major = key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12;
  return [5, 10, 3, 8, 1].includes(major);
}

/** A pitch class's name in a key: flats in flat keys, sharps otherwise. */
function spell(p: number, key?: KeyName): string {
  if (!key) return SHARPS[p];
  const interval = (p - key.tonic + 12) % 12;
  // Altered degrees are spelled by what they alter: the raised 6th and 7th of minor
  // as sharps (C# in D minor), notes borrowed from the parallel minor as flats (Ab in C major).
  const raised = key.mode === 'minor' ? [4, 9, 11] : [1, 6];
  const lowered = key.mode === 'minor' ? [1, 6] : [3, 8, 10];
  if (raised.includes(interval)) return SHARPS[p];
  if (lowered.includes(interval)) return FLATS[p];
  return (usesFlats(key) ? FLATS : SHARPS)[p];
}

/** The chord a set of pitch classes makes over a bass, in Strudel's symbols ("Dm9", "Dm9/A"); undefined when it has no name. */
function nameChord(pcs: number[], bass: number, key?: KeyName): string | undefined {
  const names = [bass, ...pcs.filter((p) => p !== bass)].map((p) => spell(p, key));
  // Strudel's voicings often leave out the fifth (Dm7 plays D F C): name the chord
  // as if the fifth were there, preferring "G7" to tonal's "G7no5".
  const found = [...Chord.detect(names), ...Chord.detect(names, { assumePerfectFifth: true })];
  const detected = found.find((n) => !n.includes('no5')) ?? found[0];
  return detected ? strudelSymbol(detected) : undefined;
}

/** Why a note outside the key is usually there; undefined when it has no common reason. */
function reasonOutside(p: number, key: KeyName): string | undefined {
  const i = (p - key.tonic + 12) % 12;
  if (key.mode === 'minor') {
    if (i === 11) return 'raised 7th (harmonic minor), as in the major V chord';
    if (i === 9) return 'raised 6th (melodic minor, or Dorian)';
    if (i === 4) return 'major 3rd, from the parallel major';
    if (i === 1) return 'flat 2nd (Phrygian, or the Neapolitan chord)';
    if (i === 6) return 'flat 5th (the blue note)';
  } else {
    // A secondary dominant (V of a chord of the key) is named by its root, a fifth above that chord's root.
    const dominant = (degree: number) => `${(usesFlats(key) ? FLATS : SHARPS)[(key.tonic + degree + 7) % 12]}7`;
    if (i === 3 || i === 10) return 'from the parallel minor (a borrowed chord), or a blue note';
    if (i === 8) return `from the parallel minor (a borrowed chord), or the 3rd of V of vi (${dominant(9)})`;
    if (i === 6) return `raised 4th: the 3rd of V of V (${dominant(7)}), or the Lydian mode`;
    if (i === 1) return `raised tonic: the 3rd of V of ii (${dominant(2)}), or the flat 2nd of a Neapolitan chord`;
  }
  return undefined;
}

/** Strudel's chord symbols: tonal's "CM" is "C", "Bbmaj7" is "Bb^7". */
const strudelSymbol = (name: string) => name.replace(/maj(\d+)/, '^$1').replace(/M(?=\/|$)/, '');

function position(t: number, bpc: number): string {
  const bar = Math.floor(t + EPS);
  const beat = (t - bar) * bpc + 1;
  return Math.abs(beat - 1) < 1e-6 ? `bar ${bar + 1}` : `bar ${bar + 1} beat ${num(beat)}`;
}

const sounding = (notes: Note[], t: number) => notes.filter((n) => n.start <= t + EPS && n.end > t + EPS);

/** Relation between two keys, by how many scale notes differ. */
function keyRelation(a: KeyName, b: KeyName): { notesChanged: number; relation?: string } {
  const sa = new Set(scaleOf(a));
  const notesChanged = scaleOf(b).filter((p) => !sa.has(p)).length;
  let relation: string | undefined;
  if (a.tonic === b.tonic && a.mode !== b.mode) relation = `parallel ${b.mode}`;
  else if (notesChanged === 0) relation = `relative ${b.mode}`;
  else if (notesChanged === 1) relation = 'closely related (one note changed)';
  else if (notesChanged >= 4) relation = 'distant';
  return { notesChanged, relation };
}

/** Chord changes in a span, from the layers that play chords, with the lowest note sounding under each. */
function chordChanges(all: Note[], chordNotes: Note[], from: number, to: number, key: KeyName | undefined, bpc: number): ChordChange[] {
  const onsets = [...new Set(chordNotes.filter((n) => n.start >= from - EPS && n.start < to - EPS).map((n) => Math.round(n.start * 1e6) / 1e6))].sort((a, b) => a - b);
  const changes: ChordChange[] = [];
  for (const t of onsets) {
    const chord = sounding(chordNotes, t);
    const pcs = [...new Set(chord.map((n) => pc(n.pitch)))];
    if (pcs.length < 3) continue;
    // The bass: the lowest note starting within a sixteenth of the chord (a swung bass
    // starts late), or held through that sixteenth. A note from the bar before that
    // only rings a moment into this one (a swung last note) is not the bass.
    const window = 1 / 16;
    const under = all.filter((n) => (n.start >= t - EPS && n.start < t + window) || (n.start < t - EPS && n.end > t + window));
    const bass = pc(under.reduce((low, n) => (n.pitch < low.pitch ? n : low), chord[0]).pitch);
    const name = nameChord(pcs, bass, key) ?? `? (${[bass, ...pcs.filter((p) => p !== bass)].map((p) => spell(p, key)).join(' ')})`;
    const change = { at: t, position: position(t, bpc), name, bass: spell(bass, key), notes: pcs.map((p) => spell(p, key)) };
    const last = changes[changes.length - 1];
    if (!last || last.name !== change.name) changes.push(change);
  }
  return changes;
}

export async function harmonyOf(code: string, cycles: number, sections?: Section[], options: HarmonyOptions = {}): Promise<HarmonyReport> {
  const bpc = options.beatsPerCycle ?? 4;
  const minOverlap = options.minOverlap ?? 1 / 16;
  if (!(bpc > 0)) throw new RangeError('beats per cycle must be positive');
  const { notes: raw } = await pieceNotes(code, cycles, options.language ?? 'js');
  const notes: Note[] = raw.filter((n) => n.pitch !== undefined && !n.drum).map((n) => ({ layer: n.layer, start: n.start, end: n.end, pitch: n.pitch! }));
  const spans = sections ?? [{ name: 'all', from: 0, to: cycles }];

  // Layers that play chords: three or more notes starting together somewhere.
  const chordLayers = [...new Set(notes.map((n) => n.layer))].filter((layer) => {
    const starts = new Map<number, number>();
    for (const n of notes) if (n.layer === layer) starts.set(Math.round(n.start * 1e6), (starts.get(Math.round(n.start * 1e6)) ?? 0) + 1);
    return [...starts.values()].some((c) => c >= 3);
  });
  const chordNotes = notes.filter((n) => chordLayers.includes(n.layer));

  let previous: KeyName | undefined;
  const sectionReports: SectionHarmony[] = spans.map((s) => {
    const weights = new Array(12).fill(0);
    const inSpan = notes.filter((n) => n.end > s.from + EPS && n.start < s.to - EPS);
    for (const n of inSpan) weights[pc(n.pitch)] += Math.min(n.end, s.to) - Math.max(n.start, s.from);
    const report: SectionHarmony = { ...s, outside: [], chords: [] };
    if (inSpan.length) {
      const [key, next] = rankKeys(weights);
      report.key = key;
      report.next = next;
      if (key.r - next.r < CLEAR_MARGIN) report.unclear = true;
      if (previous && previous.name !== key.name) report.changedFrom = { key: previous.name, ...keyRelation(previous, key) };
      previous = key;
      const scale = new Set(scaleOf(key));
      const started = inSpan.filter((n) => n.start >= s.from - EPS);
      const out = new Map<number, Note[]>();
      for (const n of started) if (!scale.has(pc(n.pitch))) out.set(pc(n.pitch), [...(out.get(pc(n.pitch)) ?? []), n]);
      report.outside = [...out]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([p, list]) => ({
          name: spell(p, key),
          events: list.length,
          layers: [...new Set(list.map((n) => n.layer))],
          bars: [...new Set(list.map((n) => Math.floor(n.start + EPS) + 1))],
          why: reasonOutside(p, key),
        }));
    }
    report.chords = chordChanges(notes, chordNotes, s.from, s.to, report.key, bpc);
    return report;
  });
  const keyAt = (t: number) => sectionReports.find((s) => t >= s.from - EPS && t < s.to - EPS)?.key;

  // On the beat, how often each other layer plays a note of the chord sounding.
  const fits: LayerFit[] = [];
  if (chordLayers.length) {
    for (const layer of [...new Set(notes.map((n) => n.layer))].filter((l) => !chordLayers.includes(l))) {
      const fit: LayerFit = { layer, onBeat: 0, inChord: 0, examples: [] };
      for (const n of notes.filter((x) => x.layer === layer)) {
        const beat = n.start * bpc;
        if (Math.abs(beat - Math.round(beat)) > 1e-6) continue;
        const chord = sounding(chordNotes, n.start);
        if (new Set(chord.map((c) => pc(c.pitch))).size < 3) continue;
        fit.onBeat++;
        if (chord.some((c) => pc(c.pitch) === pc(n.pitch))) fit.inChord++;
        else if (fit.examples.length < 4) {
          const changes = sectionReports.flatMap((s) => s.chords).filter((c) => c.at <= n.start + EPS);
          fit.examples.push(`${spell(pc(n.pitch), keyAt(n.start))} ${position(n.start, bpc)} (over ${changes.at(-1)?.name ?? 'the chord'})`);
        }
      }
      if (fit.onBeat) fits.push(fit);
    }
  }

  // Clashes: a note a minor 2nd or 9th above a note another layer holds (an "avoid
  // note"), when the note is not itself in what the other layers sound. A note a
  // semitone below a chord tone is a major 7th above it, a usual colour, so only
  // the upper note of the pair counts. Short notes off the beat pass.
  const clashes: Clash[] = [];
  let passing = 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  for (const a of sorted) {
    const over: { note: Note; overlap: number }[] = [];
    for (const b of sorted) {
      if (b.start >= a.end - EPS) break;
      if (b.layer === a.layer || b.end <= a.start + EPS) continue;
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      if (overlap < minOverlap - EPS || !(a.pitch > b.pitch && Math.round(a.pitch - b.pitch) % 12 === 1)) continue;
      const at = Math.max(a.start, b.start);
      const now = sounding(notes, at);
      // Not a clash when another layer sounds the upper note too (it is in the chord),
      // or the upper note's own layer sounds the lower one (the chord holds both, as
      // Gm9 holds Bb and A, and the other layer only doubles a chord note).
      if (now.some((o) => o.layer !== a.layer && pc(o.pitch) === pc(a.pitch))) continue;
      if (now.some((o) => o.layer === a.layer && pc(o.pitch) === pc(b.pitch))) continue;
      over.push({ note: b, overlap });
    }
    if (!over.length) continue;
    const beats = Math.max(...over.map((o) => o.overlap)) * bpc;
    const onBeat = Math.abs(a.start * bpc - Math.round(a.start * bpc)) < 1e-6;
    if (!onBeat && beats <= 0.5 + EPS) {
      passing++;
      continue;
    }
    const key = keyAt(a.start);
    const name = (n: Note) => `${spell(pc(n.pitch), key)}${Math.floor(n.pitch / 12) - 1}`;
    const seen = new Set<string>();
    clashes.push({
      at: a.start,
      position: position(a.start, bpc),
      note: name(a),
      layer: a.layer,
      over: over.map((o) => ({ note: name(o.note), layer: o.note.layer })).filter((o) => !seen.has(o.note + o.layer) && seen.add(o.note + o.layer)),
      beats,
    });
  }
  return { cycles, beatsPerCycle: bpc, sections: sectionReports, chordLayers, fits, clashes, passing };
}

/** A chord list as its shortest repeating loop: "Dm9 Gm9 Bb^7 A7, 2 times". */
function chordLine(chords: ChordChange[]): string {
  if (!chords.length) return 'none';
  const label = (c: ChordChange) => c.name;
  const n = chords.length;
  for (let p = 1; p < n; p++) {
    if (n % p) continue;
    const period = chords[p].at - chords[0].at;
    if (chords.every((c, i) => i < p || (label(c) === label(chords[i - p]) && Math.abs(c.at - chords[i - p].at - period) < 1e-6))) {
      return `${chords.slice(0, p).map((c) => `${label(c)} (${c.position})`).join(' | ')}, ${n / p} times`;
    }
  }
  const shown = chords.slice(0, 16).map((c) => `${label(c)} (${c.position})`).join(' | ');
  return n > 16 ? `${shown} | ... ${n - 16} more (--json lists all)` : shown;
}

const MAX_CLASHES = 40;

export function formatHarmony(report: HarmonyReport): string {
  const col = Math.max(5, ...report.sections.map((s) => s.name.length));
  const lines = [`Harmony over ${report.cycles} cycles (one cycle = one bar of ${num(report.beatsPerCycle)} beats):`, 'Key by section (Krumhansl–Kessler, note durations):'];
  for (const s of report.sections) {
    if (!s.key) {
      lines.push(`  ${s.name.padEnd(col)}  no pitched notes`);
      continue;
    }
    const change = s.changedFrom ? `; changes key from ${s.changedFrom.key}${s.changedFrom.relation ? `, ${s.changedFrom.relation}` : ''}, ${s.changedFrom.notesChanged} scale note${s.changedFrom.notesChanged === 1 ? '' : 's'} changed` : '';
    lines.push(`  ${s.name.padEnd(col)}  ${s.key.name}  (r ${s.key.r.toFixed(2)}; next ${s.next!.name} ${s.next!.r.toFixed(2)}${s.unclear ? ': unclear, the notes fit both' : ''})${change}`);
    for (const o of s.outside) {
      const bars = o.bars.length > 6 ? `${o.bars.slice(0, 6).join(', ')} ...` : o.bars.join(', ');
      lines.push(`  ${''.padEnd(col)}    outside the key: ${o.name} ×${o.events} (${o.layers.join(', ')}; bar${o.bars.length === 1 ? '' : 's'} ${bars})${o.why ? `: ${o.why}` : ''}`);
    }
  }
  if (report.chordLayers.length) {
    lines.push(`Chords at each change, from ${report.chordLayers.join(', ')} (/X: the bass under the chord, when not its root):`);
    for (const s of report.sections) lines.push(`  ${s.name.padEnd(col)}  ${chordLine(s.chords)}`);
    if (report.fits.length) {
      lines.push('Other layers on the beat, against the chord sounding:');
      for (const f of report.fits) lines.push(`  ${f.layer}: ${f.inChord} of ${f.onBeat} notes in the chord${f.examples.length ? `; not: ${f.examples.join(', ')}` : ''}`);
    }
  } else {
    lines.push('Chords: none named, since no layer plays three or more notes together.');
  }
  const passing = report.passing ? `; ${report.passing} passing (off the beat, at most half a beat) not listed` : '';
  const what = 'Clashes (a note a minor 2nd or 9th above a note another layer holds, and not in the chord)';
  if (!report.clashes.length) lines.push(`${what}: none${passing}.`);
  else {
    lines.push(`${what}: ${report.clashes.length}${passing}. Each one is either meant or a wrong note:`);
    for (const c of report.clashes.slice(0, MAX_CLASHES)) lines.push(`  ${c.position}: ${c.note} (${c.layer}) over ${c.over.map((o) => `${o.note} (${o.layer})`).join(', ')}, ${num(c.beats)} beat${c.beats === 1 ? '' : 's'}`);
    if (report.clashes.length > MAX_CLASHES) lines.push(`  ... and ${report.clashes.length - MAX_CLASHES} more (--json lists all)`);
  }
  return lines.join('\n');
}
