// How faithfully a piece plays a reference song: its notes against a MIDI file's,
// by pitch and onset in beats, with every difference placed by bar and beat.
// Tempo is reported apart, so a piece a little fast still matches note for note.
import {
  DRUM_SOUNDS,
  noteName,
  num,
  partText,
  positionOf,
  summaryLines,
  type ReferenceScore,
} from '../score/reference-score.ts';
import type { Language } from './evaluate.ts';
import { runPattern } from './events.ts';
import { findLayers, layerName, playingLayers, soloLayer } from './layers.ts';
import { drumOf, midiOf } from './pitch.ts';
import { ensureScope } from './scope.ts';

export type CompareOptions = {
  /** Quarter notes per cycle. Unset: alignment tries one bar, two bars, half a bar and four bars, and keeps the best. */
  quartersPerCycle?: number;
  /** The cycle where the reference's first bar (or the first of `bars`) starts. Unset: found by alignment. */
  offset?: number;
  /** Semitones the piece is meant to sound above the reference (negative: below). Default 0. */
  transpose?: number;
  /** How far apart, in quarter notes, two onsets still match. Default 1/16. */
  tolerance?: number;
  /** Only these reference bars, inclusive. */
  bars?: [number, number];
  /** Cycles of the piece to query. Default: enough to cover the reference, plus 16. */
  cycles?: number;
  language?: Language;
};

type Note = { start: number; end: number; pitch?: number; drum?: string };
type RefN = Note & { part: number };
type PieceN = Note & { layer: string };

export type Difference = { kind: 'changed' | 'missing' | 'extra'; bar: number; beat: number; text: string };

export type CompareReport = {
  reference: string;
  bars: [number, number];
  quartersPerCycle: number;
  /** Cycle where the first compared bar starts in the piece. */
  offset: number;
  /** True when alignment moved away from one bar per cycle with the first bar at cycle 0 (or its own cycle), because that matched clearly more notes. */
  realigned: boolean;
  transpose: number;
  /** A transposition under which many more notes match, when the piece is in another key or octave. */
  detectedTranspose?: { semitones: number; matched: number };
  tolerance: number;
  /** Quarter-note bpm; `matches` when the piece is within 2% of the reference's opening tempo. */
  tempo: { piece: number; reference: number; matches: boolean };
  notes: { reference: number; piece: number; matched: number; precision: number; recall: number; f1: number };
  parts: { index: number; name: string; header: string; notes: number; found: number; layers: Record<string, number> }[];
  layers: { name: string; notes: number; matched: number; outside: number; uncompared: number }[];
  lengths: { differ: number; examples: string[] };
  differences: Difference[];
  same: boolean;
};

type Pair = [number, number];

/**
 * Pairs reference and piece notes with the same pitch (or drum) and onsets within
 * `tol`. Of several piece notes that could match one reference note (two layers
 * doubling it), the nearest onset wins, then the closest length.
 */
function match(ref: Note[], piece: Note[], shift: number, transpose: number, tol: number, pitchless = false): Pair[] {
  const groups = new Map<string, { r: number[]; p: number[] }>();
  const group = (key: string) => groups.get(key) ?? groups.set(key, { r: [], p: [] }).get(key)!;
  ref.forEach((n, i) => group(n.drum ? `d:${n.drum}` : pitchless ? '*' : String(n.pitch! + transpose)).r.push(i));
  piece.forEach((n, j) => group(n.drum ? `d:${n.drum}` : pitchless ? '*' : String(n.pitch)).p.push(j));
  const pairs: Pair[] = [];
  for (const { r, p } of groups.values()) {
    if (!r.length || !p.length) continue;
    r.sort((a, b) => ref[a].start - ref[b].start);
    p.sort((a, b) => piece[a].start - piece[b].start);
    const used = new Uint8Array(p.length);
    let lo = 0;
    for (const i of r) {
      const t = ref[i].start + shift;
      const length = ref[i].end - ref[i].start;
      while (lo < p.length && piece[p[lo]].start < t - tol) lo++;
      let best = -1;
      let bestCost = Infinity;
      for (let k = lo; k < p.length && piece[p[k]].start <= t + tol; k++) {
        if (used[k]) continue;
        const n = piece[p[k]];
        const cost = Math.abs(n.start - t) * 1000 + Math.abs(n.end - n.start - length);
        if (cost < bestCost) [best, bestCost] = [k, cost];
      }
      if (best >= 0) {
        used[best] = 1;
        pairs.push([i, p[best]]);
      }
    }
  }
  return pairs;
}

/** The most common pitch difference (piece minus reference) among notes that start together. */
function commonInterval(ref: Note[], piece: Note[], shift: number, tol: number): number {
  const counts = new Map<number, number>();
  const pitched = (n: Note) => n.pitch !== undefined && !n.drum;
  const p = piece.filter(pitched).sort((a, b) => a.start - b.start);
  for (const r of ref.filter(pitched)) {
    const t = r.start + shift;
    for (const q of p) {
      if (q.start > t + tol) break;
      if (q.start >= t - tol) counts.set(q.pitch! - r.pitch!, (counts.get(q.pitch! - r.pitch!) ?? 0) + 1);
    }
  }
  let best = 0;
  let most = 0;
  for (const [d, c] of counts) if (c > most || (c === most && Math.abs(d) < Math.abs(best))) [best, most] = [d, c];
  return best;
}

type Alignment = { qpc: number; shift: number; score: number; exact: number; interval: number; transposed: number; natural: boolean };

/**
 * Chooses quarter notes per cycle and the shift (piece time minus reference time,
 * in quarters). The natural reading, one bar per cycle with the first compared bar
 * at its own cycle or at cycle 0, stands unless another matches clearly more
 * notes: a piece half wrong can line up a little better elsewhere, and then every
 * difference would be reported at the wrong bar.
 */
function align(ref: RefN[], pieceCycles: PieceN[], candidates: number[], tol: number, options: CompareOptions, windowStart: number): Alignment {
  let best: Alignment | undefined;
  let natural: Alignment | undefined;
  candidates.forEach((qpc, rank) => {
    const piece = pieceCycles.map((n) => ({ ...n, start: n.start * qpc, end: n.end * qpc }));
    let shifts: number[];
    if (options.offset !== undefined) shifts = [options.offset * qpc - windowStart];
    else {
      // Vote: every pairing of an early reference onset with a piece onset proposes a shift.
      const refOnsets = [...new Set(ref.map((n) => n.start))].sort((a, b) => a - b).slice(0, 32);
      const pieceOnsets = [...new Set(piece.map((n) => n.start))];
      const votes = new Map<number, number>();
      for (const r of refOnsets) for (const p of pieceOnsets) {
        const s = Math.round((p - r) * 960) / 960;
        votes.set(s, (votes.get(s) ?? 0) + 1);
      }
      shifts = [...votes].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([s]) => s);
      for (const s of [0, -windowStart]) if (!shifts.includes(s)) shifts.push(s);
    }
    for (const shift of shifts) {
      const exact = match(ref, piece, shift, options.transpose ?? 0, tol).length;
      const interval = options.transpose === undefined ? commonInterval(ref, piece, shift, tol) : options.transpose;
      const transposed = interval === (options.transpose ?? 0) ? exact : match(ref, piece, shift, interval, tol).length;
      const score = Math.max(exact, 0.95 * transposed) - rank * 1e-3 - Math.abs(shift + windowStart) * 1e-6;
      const isNatural = options.offset !== undefined || (rank === 0 && (shift === 0 || shift === -windowStart));
      const found = { qpc, shift, score, exact, interval, transposed, natural: isNatural };
      if (!best || score > best.score) best = found;
      if (isNatural && (!natural || score > natural.score)) natural = found;
    }
  });
  // Clearly better: at least 2 more notes and a tenth of the reference.
  return natural && natural.score >= best!.score - Math.max(2, 0.1 * ref.length) ? natural : best!;
}

async function pieceNotes(code: string, cycles: number, language: Language): Promise<{ notes: PieceN[]; cps: number; uncompared: Map<string, number> }> {
  const { core } = await ensureScope();
  const all = language === 'mondo' ? [] : findLayers(code);
  const playing = playingLayers(all);
  const runs: { name: string; code: string }[] = playing.length > 1 ? playing.map((l) => ({ name: layerName(l), code: soloLayer(code, l, all) })) : [{ name: 'all', code }];
  const notes: PieceN[] = [];
  const uncompared = new Map<string, number>();
  let cps = 0.5;
  // One after another: each evaluation installs its own collector of labelled layers.
  for (const run of runs) {
    const result = await runPattern(run.code, cycles, language);
    cps = result.cps;
    for (const e of result.events) {
      const [bn, bd = '1'] = e.begin.split('/');
      const [en, ed = '1'] = e.end.split('/');
      const start = Number(bn) / Number(bd);
      const end = Number(en) / Number(ed);
      const drum = drumOf(e, DRUM_SOUNDS);
      const pitch = drum ? undefined : midiOf(e, core.noteToMidi);
      if (drum === undefined && pitch === undefined) uncompared.set(run.name, (uncompared.get(run.name) ?? 0) + 1);
      else notes.push({ layer: run.name, start, end, ...(drum ? { drum } : { pitch: Math.round(pitch!) }) });
    }
  }
  return { notes, cps, uncompared };
}

const nameOf = (n: Note) => n.drum ?? noteName(n.pitch!);
const layerNamesOf = (notes: PieceN[]) => [...new Set(notes.map((n) => n.layer))];

export async function compareToReference(code: string, score: ReferenceScore, options: CompareOptions = {}): Promise<CompareReport> {
  const tol = options.tolerance ?? 1 / 16;
  if (!(tol > 0)) throw new Error('tolerance must be a positive number of quarter notes');
  const [fromBar, toBar] = options.bars ?? [1, score.bars.length];
  const bars = score.bars.filter((b) => b.number >= fromBar && b.number <= toBar);
  if (!bars.length) throw new Error(`the reference has bars 1 to ${score.bars.length}, not ${fromBar}-${toBar}`);
  const windowStart = bars[0].start;
  const windowEnd = bars[bars.length - 1].end;
  const ref: RefN[] = score.parts
    .flatMap((p) => p.notes)
    .filter((n) => n.start >= windowStart - 1e-9 && n.start < windowEnd - 1e-9)
    .map((n) => ({ part: n.part, start: n.start, end: n.end, ...(n.drum ? { drum: n.drum } : { pitch: n.pitch }) }));
  if (!ref.length) throw new Error(`no reference notes in bars ${fromBar}-${toBar}`);

  const bar = score.bars[0].end - score.bars[0].start;
  const candidates = options.quartersPerCycle ? [options.quartersPerCycle] : [...new Set([bar, bar * 2, bar / 2, bar * 4])];
  const span = windowEnd - windowStart;
  const cycles = options.cycles ?? Math.min(2048, Math.ceil(span / Math.min(...candidates)) + 16 + Math.max(0, Math.ceil(options.offset ?? 0)));
  const { notes: pieceCycles, cps, uncompared } = await pieceNotes(code, cycles, options.language ?? 'js');

  const chosen = align(ref, pieceCycles, candidates, tol, options, windowStart);
  const { qpc, shift } = chosen;
  const transpose = options.transpose ?? 0;
  const all = pieceCycles.map((n) => ({ ...n, start: n.start * qpc, end: n.end * qpc }));
  const inWindow = (n: Note) => n.start >= windowStart + shift - tol && n.start < windowEnd + shift - tol;
  const piece = all.filter(inWindow);
  const pairs = match(ref, piece, shift, transpose, tol);
  const refMatched = new Set(pairs.map(([i]) => i));
  const pieceMatched = new Set(pairs.map(([, j]) => j));

  // Lengths: matched notes whose length differs by more than the tolerance and a tenth of the note.
  const lengthDiffs = pairs.filter(([i, j]) => {
    const r = ref[i].end - ref[i].start;
    return Math.abs(piece[j].end - piece[j].start - r) > Math.max(tol, 0.1 * r);
  });
  const beats = (q: number, at: number) => {
    const b = score.bars.find((x) => x.number === positionOf(score, at).bar) ?? score.bars[score.bars.length - 1];
    return num(q / (4 / b.denominator));
  };
  const where = (q: number) => {
    const { bar: b, beat } = positionOf(score, q);
    return `bar ${b} beat ${num(beat)}`;
  };

  // Differences, in reference time; a missing and an extra note at one position read as a changed note.
  const partName = (i: number) => `part ${i} "${score.parts[i - 1].name}"`;
  const missing = ref.map((n, i) => ({ n, i })).filter(({ i }) => !refMatched.has(i));
  const extra = piece.map((n, j) => ({ n, j })).filter(({ j }) => !pieceMatched.has(j));
  const key = (q: number) => Math.round(q / tol);
  const extraAt = new Map<number, typeof extra>();
  for (const x of extra) extraAt.set(key(x.n.start - shift), [...(extraAt.get(key(x.n.start - shift)) ?? []), x]);
  const differences: (Difference & { at: number })[] = [];
  for (const { n } of missing) {
    const pos = positionOf(score, n.start);
    const same = extraAt.get(key(n.start));
    const partner = same?.find((x) => !x.n.drum === !n.drum) ?? undefined;
    if (partner) {
      same!.splice(same!.indexOf(partner), 1);
      differences.push({ kind: 'changed', ...pos, at: n.start, text: `~ ${where(n.start)}: ${nameOf(n)} → ${nameOf(partner.n)}  (${partName((n as RefN).part)}; ${partner.n.layer})` });
    } else {
      differences.push({ kind: 'missing', ...pos, at: n.start, text: `- ${where(n.start)}: ${nameOf(n)} (${beats(n.end - n.start, n.start)} beats) missing  (${partName((n as RefN).part)})` });
    }
  }
  // A layer that is mostly not in the reference (an added part, or one in another
  // octave) is one line, not one per note, listed before the note-by-note differences.
  const added = new Map<string, number>();
  for (const l of layerNamesOf(piece)) {
    const notes = piece.filter((n) => n.layer === l).length;
    const matched = pairs.filter(([, j]) => piece[j].layer === l).length;
    if (matched < 0.2 * notes) added.set(l, matched);
  }
  const summaries: Difference[] = [];
  for (const list of extraAt.values()) for (const { n } of list) {
    if (added.has(n.layer)) continue;
    const at = n.start - shift;
    differences.push({ kind: 'extra', ...positionOf(score, at), at, text: `+ ${where(at)}: ${nameOf(n)} extra  (${n.layer})` });
  }
  for (const [l, matched] of added) {
    const notes = piece.filter((n) => n.layer === l);
    const extras = extra.filter((x) => x.n.layer === l).length;
    const names = [...new Set(notes.map(nameOf))];
    const which = `${names.slice(0, 6).join(' ')}${names.length > 6 ? ' ...' : ''}`;
    summaries.push({
      kind: 'extra',
      ...positionOf(score, notes[0].start - shift),
      text: matched
        ? `+ ${l}: ${extras} of its ${notes.length} notes (${which}) are extra, ${matched} in the reference: mostly a part the reference does not have (--json lists each)`
        : `+ ${l}: ${notes.length === 1 ? 'its one note' : `all ${notes.length} notes`} (${which}) ${notes.length === 1 ? 'is' : 'are'} extra, none in the reference: a part the reference does not have, or one in another key or octave`,
    });
  }
  differences.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));

  const layerNames = [...new Set([...pieceCycles.map((n) => n.layer), ...uncompared.keys()])];
  const precision = piece.length ? pairs.length / piece.length : 0;
  const recall = pairs.length / ref.length;
  const tempo = { piece: cps * 60 * qpc, reference: score.bpm };
  const tempoMatches = Math.abs(tempo.piece / tempo.reference - 1) <= TEMPO_TOLERANCE;
  return {
    reference: score.file,
    bars: [fromBar, toBar],
    quartersPerCycle: qpc,
    offset: (windowStart + shift) / qpc,
    realigned: !chosen.natural,
    transpose,
    ...(chosen.interval !== transpose && chosen.transposed > chosen.exact + 0.25 * ref.length
      ? { detectedTranspose: { semitones: chosen.interval, matched: chosen.transposed } }
      : {}),
    tolerance: tol,
    tempo: { ...tempo, matches: tempoMatches },
    notes: { reference: ref.length, piece: piece.length, matched: pairs.length, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 },
    parts: score.parts
      .filter((p) => ref.some((n) => n.part === p.index))
      .map((p) => {
        const layers: Record<string, number> = {};
        for (const [i, j] of pairs) if (ref[i].part === p.index) layers[piece[j].layer] = (layers[piece[j].layer] ?? 0) + 1;
        return { index: p.index, name: p.name, header: partText(p).replace(/\): .*$/, ')'), notes: ref.filter((n) => n.part === p.index).length, found: pairs.filter(([i]) => ref[i].part === p.index).length, layers };
      }),
    layers: layerNames.map((name) => ({
      name,
      notes: piece.filter((n) => n.layer === name).length,
      matched: pairs.filter(([, j]) => piece[j].layer === name).length,
      outside: all.filter((n) => n.layer === name && !inWindow(n)).length,
      uncompared: uncompared.get(name) ?? 0,
    })),
    lengths: {
      differ: lengthDiffs.length,
      examples: lengthDiffs.slice(0, 3).map(([i, j]) => `${where(ref[i].start)} ${nameOf(ref[i])}: ${beats(ref[i].end - ref[i].start, ref[i].start)} beats in the reference, ${beats(piece[j].end - piece[j].start, ref[i].start)} in the piece`),
    },
    differences: [...summaries, ...differences.map(({ at: _, ...d }) => d)],
    same: !missing.length && !extra.length && tempoMatches,
  };
}

const MAX_LINES = 60;
/** How far the piece's tempo may be from the reference's, as a share. */
const TEMPO_TOLERANCE = 0.02;

export function formatCompare(report: CompareReport, score: ReferenceScore): string {
  const n = report.notes;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    ...summaryLines(score).slice(0, 2),
    `Compared bars ${report.bars[0]}-${report.bars[1]}: one cycle = ${num(report.quartersPerCycle)} quarter notes; bar ${report.bars[0]} starts at cycle ${num(report.offset)}${report.transpose ? `; piece transposed ${report.transpose > 0 ? '+' : ''}${report.transpose} semitones` : ''}${report.realigned ? ' (found by alignment, which matched clearly more notes there than at one bar per cycle from cycle 0; set --offset and --beats-per-cycle to compare elsewhere)' : ''}.`,
    `Tempo: piece ${num(report.tempo.piece)} bpm, reference ${num(report.tempo.reference)} bpm (quarter notes).`,
    `Notes: ${n.matched} of ${n.reference} reference notes played (recall ${n.recall.toFixed(2)}); ${n.matched} of ${n.piece} piece notes are in the reference (precision ${n.precision.toFixed(2)}); F1 ${n.f1.toFixed(2)}.`,
  ];
  if (!report.tempo.matches) {
    const ratio = report.tempo.piece / report.tempo.reference;
    const how = ratio > 1.5 || ratio < 1 / 1.5 ? `${num(ratio > 1 ? ratio : 1 / ratio)} times too ${ratio > 1 ? 'fast' : 'slow'}` : `${pct(Math.abs(ratio - 1))} too ${ratio > 1 ? 'fast' : 'slow'}`;
    const bar = score.bars[0].end - score.bars[0].start;
    const perCycle = report.quartersPerCycle / bar;
    const ref = num(report.tempo.reference);
    const fix =
      perCycle === 1
        ? `Fix: setcpm(${ref}/${num(bar)}).`
        : `The piece fits ${num(perCycle)} bars into each cycle. Fix: setcpm(${ref}/${num(report.quartersPerCycle)}), or keep setcpm(${ref}/${num(bar)}) and slow every layer by ${num(perCycle)} so each bar is one cycle.`;
    lines.push(
      `warning: wrong tempo, which fails the comparison: the piece plays ${how}, at ${num(report.tempo.piece)} bpm where the reference has ${ref}. ${fix} (Notes are matched by beat, so they can all match at the wrong tempo.)`,
    );
  }
  if (report.detectedTranspose) {
    const t = report.detectedTranspose;
    lines.push(`warning: ${t.matched} notes match if the piece is ${t.semitones > 0 ? '+' : ''}${t.semitones} semitones from the reference${t.semitones % 12 === 0 ? ` (${Math.abs(t.semitones / 12)} octave${Math.abs(t.semitones) === 12 ? '' : 's'} ${t.semitones > 0 ? 'up' : 'down'})` : ''}; if that is meant, compare with --transpose=${t.semitones}.`);
  }
  lines.push('Reference parts:');
  for (const p of report.parts) {
    const where = Object.entries(p.layers).map(([l, c]) => `${l} ×${c}`).join(', ');
    lines.push(`  ${p.header}: ${p.found} of ${p.notes} found${where ? ` (${where})` : ''}`);
  }
  lines.push('Piece layers:');
  for (const l of report.layers) {
    lines.push(`  ${l.name}: ${l.matched} of ${l.notes} notes in the reference${l.uncompared ? `; ${l.uncompared} events with no pitch or drum, not compared` : ''}`);
  }
  if (report.lengths.differ) lines.push(`Lengths: ${report.lengths.differ} matched notes have another length (not counted above), e.g. ${report.lengths.examples.join('; ')}`);
  if (report.differences.length) {
    lines.push(`Differences (~ changed, - missing, + extra), ${report.differences.length}:`);
    for (const d of report.differences.slice(0, MAX_LINES)) lines.push(`  ${d.text}`);
    if (report.differences.length > MAX_LINES) lines.push(`  ... and ${report.differences.length - MAX_LINES} more (--json lists all, --bars narrows)`);
  } else {
    lines.push(`Every reference note in bars ${report.bars[0]}-${report.bars[1]} is played, and nothing else${report.tempo.matches ? '.' : ', but at the wrong tempo: see the warning above.'}`);
  }
  return lines.join('\n');
}
