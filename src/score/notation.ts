// Notes as mini-notation: chords as [a,b], voices that overlap joined with ",",
// and bars joined by a note held over the bar line written as one sequence.
import type { Bar, RefNote } from './reference-score.ts';

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
/** 60 → "c4", as Strudel names notes. */
export const noteName = (midi: number) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** A note's name in Strudel: its drum sound, or its pitch. */
export const labelOf = (n: RefNote) => n.drum ?? noteName(n.pitch);

/** Notes that start and end together, as one step: a chord or a single note. */
type Unit = { startTick: number; endTick: number; names: string[] };

function unitsOf(notes: RefNote[]): Unit[] {
  const byTime = new Map<string, Unit>();
  for (const n of notes) {
    const key = `${n.startTick}|${n.endTick}`;
    const unit = byTime.get(key) ?? byTime.set(key, { startTick: n.startTick, endTick: n.endTick, names: [] }).get(key)!;
    const name = labelOf(n);
    if (!unit.names.includes(name)) unit.names.push(name);
  }
  return [...byTime.values()].sort((a, b) => a.startTick - b.startTick || b.endTick - a.endTick);
}

/** Splits steps into voices that never overlap: each joins the first voice free at its start. */
function voicesOf(units: Unit[]): Unit[][] {
  const voices: Unit[][] = [];
  for (const u of units) {
    const voice = voices.find((v) => v[v.length - 1].endTick <= u.startTick);
    if (voice) voice.push(u);
    else voices.push([u]);
  }
  return voices;
}

/** One voice from tick `start` to `end`: "~@3 c4@2 [e4,g4]". Undefined past `maxSteps`. */
function sequence(voice: Unit[], start: number, end: number, maxSteps: number): string | undefined {
  let unit = end - start;
  for (const u of voice) unit = gcd(gcd(unit, u.startTick - start), u.endTick - u.startTick);
  if (!unit || (end - start) / unit > maxSteps) return undefined;
  const tokens: string[] = [];
  const push = (token: string, ticks: number) => tokens.push(ticks === unit ? token : `${token}@${ticks / unit}`);
  let t = start;
  for (const u of voice) {
    if (u.startTick > t) push('~', u.startTick - t);
    push(u.names.length > 1 ? `[${u.names.join(',')}]` : u.names[0], u.endTick - u.startTick);
    t = u.endTick;
  }
  if (t < end) push('~', end - t);
  return tokens.join(' ');
}

/**
 * Mini-notation for the notes that start from tick `start` up to `end`, voices
 * joined with ","; notes held past `end` are cut there. Undefined when a voice
 * would need more than `maxSteps` steps.
 */
export function miniOf(notes: RefNote[], start: number, end: number, maxSteps = Infinity): string | undefined {
  const inside = notes.filter((n) => n.startTick >= start && n.startTick < end).map((n) => ({ ...n, endTick: Math.min(n.endTick, end) }));
  if (!inside.length) return '~';
  const voices = voicesOf(unitsOf(inside)).map((v) => sequence(v, start, end, maxSteps));
  return voices.some((v) => v === undefined) ? undefined : voices.join(', ');
}

/** Runs of bars joined by a note held over a bar line: [bars 1], [bars 2, 3], ... */
export function spansOf(notes: RefNote[], bars: Bar[]): Bar[][] {
  const spans: Bar[][] = [];
  for (let i = 0; i < bars.length; ) {
    const span = [bars[i]];
    while (i + span.length < bars.length) {
      const end = span[span.length - 1].endTick;
      if (!notes.some((n) => n.startTick >= span[0].startTick && n.startTick < end && n.endTick > end)) break;
      span.push(bars[i + span.length]);
    }
    spans.push(span);
    i += span.length;
  }
  return spans;
}
