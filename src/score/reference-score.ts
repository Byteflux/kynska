// A reference recording of a song as notes: the parts, bars and tempo of a MIDI
// file, positions as bar and beat, and each bar written out as mini-notation where
// it can be, so an agent can read a score it cannot see.
import { readMidi, type MidiFile } from './midi.ts';
import { labelOf as label, miniOf, noteName, spansOf } from './notation.ts';

export type RefNote = {
  /** 1-based part number. */
  part: number;
  /** MIDI note number; for drums, the General MIDI drum key. */
  pitch: number;
  /** Strudel's sound name for a drum note (channel 10), e.g. "bd". */
  drum?: string;
  /** In quarter notes from the start of the file. */
  start: number;
  end: number;
  startTick: number;
  endTick: number;
};

export type Part = {
  index: number;
  /** The track name, or "track N" (with the channel when a track uses several). */
  name: string;
  track: number;
  /** 1-based, as MIDI software numbers channels. */
  channel: number;
  program?: number;
  drums: boolean;
  notes: RefNote[];
};

export type Bar = {
  /** 1-based. */
  number: number;
  startTick: number;
  endTick: number;
  /** In quarter notes. */
  start: number;
  end: number;
  numerator: number;
  denominator: number;
};

export type ReferenceScore = {
  file: string;
  midi: MidiFile;
  parts: Part[];
  bars: Bar[];
  /** Quarter-note beats per minute at the start, 120 when the file sets none. */
  bpm: number;
  tempoChanges: { bar: number; beat: number; bpm: number }[];
};

/** General MIDI percussion keys as Strudel's drum names. */
const GM_DRUMS: Record<number, string> = {
  35: 'bd', 36: 'bd', 37: 'rim', 38: 'sd', 39: 'cp', 40: 'sd', 41: 'lt', 42: 'hh', 43: 'lt', 44: 'hh', 45: 'mt', 46: 'oh', 47: 'mt',
  48: 'ht', 49: 'cr', 50: 'ht', 51: 'rd', 52: 'cr', 53: 'rd', 54: 'tb', 55: 'cr', 56: 'cb', 57: 'cr', 59: 'rd', 69: 'sh', 70: 'sh',
};
export const drumName = (key: number) => GM_DRUMS[key] ?? 'perc';

/** Strudel's drum sound names, which `compare` matches against General MIDI drums. */
export const DRUM_SOUNDS = new Set(['bd', 'sd', 'rim', 'cp', 'hh', 'oh', 'cr', 'rd', 'ht', 'mt', 'lt', 'sh', 'cb', 'tb', 'perc']);

export { noteName };

/** General MIDI program names, by family of 8, enough to say what a part is. */
const FAMILIES = ['piano', 'chromatic percussion', 'organ', 'guitar', 'bass', 'strings', 'ensemble', 'brass', 'reed', 'pipe', 'synth lead', 'synth pad', 'synth effects', 'ethnic', 'percussive', 'sound effects'];

function barsOf(midi: MidiFile, endTick: number): Bar[] {
  const tpq = midi.ticksPerQuarter;
  const signatures = [...midi.timeSignatures];
  if (!signatures.length || signatures[0].tick > 0) signatures.unshift({ tick: 0, numerator: 4, denominator: 4 });
  const bars: Bar[] = [];
  let tick = 0;
  let si = 0;
  while (tick < endTick || bars.length === 0) {
    while (si + 1 < signatures.length && signatures[si + 1].tick <= tick) si++;
    const sig = signatures[si];
    let length = Math.round((sig.numerator * 4 * tpq) / sig.denominator);
    // A metre change starts a new bar, cutting short any bar it falls inside.
    const next = si + 1 < signatures.length ? signatures[si + 1].tick : Infinity;
    if (next < tick + length) length = next - tick;
    bars.push({ number: bars.length + 1, startTick: tick, endTick: tick + length, start: tick / tpq, end: (tick + length) / tpq, numerator: sig.numerator, denominator: sig.denominator });
    tick += length;
  }
  return bars;
}

export function readReferenceScore(bytes: Uint8Array, file = 'reference.mid'): ReferenceScore {
  const midi = readMidi(bytes);
  const tpq = midi.ticksPerQuarter;
  const groups = new Map<string, { track: number; channel: number; notes: typeof midi.notes }>();
  for (const n of midi.notes) {
    const key = `${n.track}:${n.channel}`;
    if (!groups.has(key)) groups.set(key, { track: n.track, channel: n.channel, notes: [] });
    groups.get(key)!.notes.push(n);
  }
  const channelsPerTrack = new Map<number, number>();
  for (const g of groups.values()) channelsPerTrack.set(g.track, (channelsPerTrack.get(g.track) ?? 0) + 1);
  const parts: Part[] = [...groups.values()]
    .sort((a, b) => a.track - b.track || a.channel - b.channel)
    .map((g, i) => {
      const track = midi.tracks.find((t) => t.index === g.track);
      const drums = g.channel === 9;
      const name = `${track?.name || `track ${g.track}`}${(channelsPerTrack.get(g.track) ?? 1) > 1 ? ` ch ${g.channel + 1}` : ''}`;
      return {
        index: i + 1,
        name,
        track: g.track,
        channel: g.channel + 1,
        program: track?.programs[g.channel],
        drums,
        notes: g.notes.map((n) => ({
          part: i + 1,
          pitch: n.pitch,
          ...(drums ? { drum: drumName(n.pitch) } : {}),
          start: n.start / tpq,
          end: n.end / tpq,
          startTick: n.start,
          endTick: n.end,
        })),
      };
    });
  const lastNote = Math.max(0, ...midi.notes.map((n) => n.end));
  const bars = barsOf(midi, lastNote || midi.endTick);
  const score = { file, midi, parts, bars, bpm: 120, tempoChanges: [] as ReferenceScore['tempoChanges'] };
  const tempos = midi.tempos.filter((t, i, all) => i === 0 || Math.abs(t.bpm - all[i - 1].bpm) > 1e-6);
  if (tempos.length && tempos[0].tick === 0) score.bpm = tempos[0].bpm;
  score.tempoChanges = tempos.filter((t) => t.tick > 0).map((t) => ({ ...positionOf(score, t.tick / tpq), bpm: t.bpm }));
  return score;
}

/** The bar a position (in quarter notes) falls in; past the end, the last. */
export function barAt(score: Pick<ReferenceScore, 'bars'>, quarters: number): Bar {
  const { bars } = score;
  for (let i = bars.length - 1; i >= 0; i--) if (quarters >= bars[i].start - 1e-9) return bars[i];
  return bars[0];
}

/** The beat unit of a bar, in quarter notes: a quarter in 4/4, an eighth in 6/8. */
export const beatUnit = (bar: Bar) => 4 / bar.denominator;

/** Bar and 1-based beat (in the time signature's unit) of a position in quarter notes. */
export function positionOf(score: Pick<ReferenceScore, 'bars'>, quarters: number): { bar: number; beat: number } {
  const bar = barAt(score, quarters);
  const beyond = quarters >= bar.end && bar === score.bars[score.bars.length - 1];
  // Past the last bar, keep counting bars of the same length.
  if (beyond) {
    const extra = Math.floor((quarters - bar.start) / (bar.end - bar.start));
    const start = bar.start + extra * (bar.end - bar.start);
    return { bar: bar.number + extra, beat: 1 + (quarters - start) / beatUnit(bar) };
  }
  if (quarters < bar.start) return { bar: 0, beat: 1 + (quarters - (bar.start - (bar.end - bar.start))) / beatUnit(bar) };
  return { bar: bar.number, beat: 1 + (quarters - bar.start) / beatUnit(bar) };
}

/** 2.5, 1.333: up to three decimals, no trailing zeros. */
export const num = (x: number) => String(Math.round(x * 1000) / 1000);

export const positionText = (score: Pick<ReferenceScore, 'bars'>, quarters: number) => {
  const { bar, beat } = positionOf(score, quarters);
  return `bar ${bar} beat ${num(beat)}`;
};

/** Most steps a bar's mini-notation may take before `notes` lists the bar instead. */
const MAX_STEPS_PER_BAR = 48;

/**
 * Bars of a part as mini-notation, one cycle per bar: "~ c4 d4 e4@2 [c4,e4]@4",
 * voices that overlap joined with ",". Undefined when a voice needs more than 48
 * steps a bar.
 */
export function barsMini(notes: RefNote[], bars: Bar[]): string | undefined {
  return miniOf(notes, bars[0].startTick, bars[bars.length - 1].endTick, MAX_STEPS_PER_BAR * bars.length);
}

/** One bar as mini-notation; notes held past it are cut at the bar line. */
export const barMini = (notes: RefNote[], bar: Bar) => barsMini(notes, [bar]);

/** One bar of a part as "beat: notes (length in beats)", for any bar. */
export function barList(notes: RefNote[], bar: Bar): string {
  const inBar = notes.filter((n) => n.startTick >= bar.startTick && n.startTick < bar.endTick);
  if (!inBar.length) return '(rest)';
  const unit = beatUnit(bar);
  const groups = new Map<string, RefNote[]>();
  for (const n of inBar) {
    const key = `${n.start}|${n.end}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return [...groups.values()]
    .sort((a, b) => a[0].start - b[0].start || a[0].end - b[0].end)
    .map((g) => `${num(1 + (g[0].start - bar.start) / unit)}: ${g.map(label).join(' ')} (${num((g[0].end - g[0].start) / unit)})`)
    .join(', ');
}

/** "1-8" or "9" as a range of bar numbers. */
export function parseBars(text: string): [number, number] {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(text);
  if (!m) throw new Error(`bars must be a bar number or a range such as 9-16, got "${text}"`);
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  if (from < 1 || to < from) throw new Error(`bars must count up from 1, got "${text}"`);
  return [from, to];
}

export const programName = (program: number | undefined) => (program === undefined ? undefined : `${FAMILIES[Math.floor(program / 8)]} (program ${program + 1})`);

const range = (notes: RefNote[]) => {
  const pitches = notes.map((n) => n.pitch);
  return `${noteName(Math.min(...pitches))}-${noteName(Math.max(...pitches))}`;
};

/** A part's header: `1 "one" (track 1, channel 1, piano (program 1)): 240 notes, c3-d6`. */
export const partText = (p: Part) =>
  `${p.index} "${p.name}" (track ${p.track}, channel ${p.channel}${p.drums ? ', drums' : programName(p.program) ? `, ${programName(p.program)}` : ''}): ${p.notes.length} notes${p.drums ? `, ${[...new Set(p.notes.map(label))].join(' ')}` : `, ${range(p.notes)}`}`;

/** The metre, tempo and length, and the setcpm that plays it at one bar per cycle. */
export function summaryLines(score: ReferenceScore): string[] {
  const metres = [...new Set(score.bars.map((b) => `${b.numerator}/${b.denominator}`))];
  const first = score.bars[0];
  const quarters = (first.end - first.start);
  return [
    `Reference ${score.file}: ${score.parts.length} part${score.parts.length === 1 ? '' : 's'}, ${score.bars.length} bars of ${metres.join(', ')}, ${num(score.bpm)} bpm (quarter notes)`,
    ...(score.tempoChanges.length ? [`Tempo changes: ${score.tempoChanges.map((t) => `bar ${t.bar} beat ${num(t.beat)} → ${num(t.bpm)} bpm`).join('; ')}`] : []),
    `At one bar per cycle it plays at setcpm(${num(score.bpm)}/${num(quarters)})${metres.length > 1 ? '; the metre changes, so some bars are not one cycle long' : ''}.`,
  ];
}

/** The notes of each part, bar by bar. */
export function formatNotes(score: ReferenceScore, options: { bars?: [number, number]; parts?: number[] } = {}): string {
  const [from, to] = options.bars ?? [1, score.bars.length];
  const bars = score.bars.filter((b) => b.number >= from && b.number <= to);
  const parts = options.parts ? score.parts.filter((p) => options.parts!.includes(p.index)) : score.parts;
  const lines = [
    ...summaryLines(score),
    'Each line is mini-notation for its bars, one cycle per bar: "~" a rest, "@n" a step held n steps, [a,b] notes together, "," voices that play together.',
    'A line for several bars ("bars 9-10") is joined by a note held over the bar line: play it slowed over its bars, e.g. arrange([1, note("<bar 8>")], [2, note("<bars 9-10>").slow(2)]).',
    'Each part ends with all its bars as one layer, exact with the setcpm above: paste it, then arrange, cut or change it.',
  ];
  const metre = (bar: Bar) => (bar.numerator !== score.bars[0].numerator || bar.denominator !== score.bars[0].denominator ? ` (${bar.numerator}/${bar.denominator})` : '');
  for (const p of parts) {
    lines.push('', `Part ${partText(p)}`);
    for (const span of spansOf(p.notes, bars)) {
      const head = span[0];
      // A note tied over from before the first bar shown sounds where it shows a rest: say so.
      const held = p.notes.filter((n) => n.startTick < head.startTick && n.endTick > head.startTick);
      const heldText = held.length
        ? `  (still sounding from an earlier bar: ${held.map((n) => `${label(n)} until ${n.endTick >= head.endTick ? 'after this bar' : `beat ${num(1 + (n.end - head.start) / beatUnit(head))}`}`).join(', ')})`
        : '';
      const name = span.length > 1 ? `bars ${head.number}-${span[span.length - 1].number}` : `bar ${head.number}`;
      const mini = barsMini(p.notes, span);
      if (mini !== undefined) lines.push(`  ${name}${metre(head)}: ${mini}${heldText}`);
      // Finer than mini-notation can show at a glance: list each bar.
      else for (const bar of span) lines.push(`  bar ${bar.number}${metre(bar)}: ${barList(p.notes, bar)}${bar === head ? heldText : ''}`);
    }
    // The whole part as one layer, exact: the bars as one sequence slowed over them.
    if (bars.length <= MAX_LAYER_BARS) {
      const cycles = (bars[bars.length - 1].end - bars[0].start) / (score.bars[0].end - score.bars[0].start);
      lines.push(`  as one layer, bars ${from}-${to}: $: ${p.drums ? 's' : 'note'}("${miniOf(p.notes, bars[0].startTick, bars[bars.length - 1].endTick)}").slow(${num(cycles)})`);
    } else {
      lines.push(`  (with --bars for at most ${MAX_LAYER_BARS} bars, it also prints the part as one layer to paste)`);
    }
  }
  return lines.join('\n');
}

/** Most bars `notes` writes as one pasteable layer line. */
const MAX_LAYER_BARS = 32;
