// Scoring helpers: everything is decided from the events a candidate produces.
import type { PatternEvent } from '../src/patterns/events.ts';

/** JSON with object keys sorted, so equal values compare equal. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

const key = (e: PatternEvent) => `${e.begin}|${e.end}|${stable(e.value)}`;

/** Precision, recall and F1 of `actual` against `expected`, events compared exactly (multisets). */
export function eventF1(expected: PatternEvent[], actual: PatternEvent[]): { precision: number; recall: number; f1: number } {
  const pool = new Map<string, number>();
  for (const e of expected) pool.set(key(e), (pool.get(key(e)) ?? 0) + 1);
  let hits = 0;
  for (const e of actual) {
    const n = pool.get(key(e)) ?? 0;
    if (n > 0) {
      hits++;
      pool.set(key(e), n - 1);
    }
  }
  const precision = actual.length ? hits / actual.length : expected.length ? 0 : 1;
  const recall = expected.length ? hits / expected.length : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

export const fraction = (f: string) => {
  const [n, d = '1'] = f.split('/');
  return Number(n) / Number(d);
};

/** Onset positions (in cycles) of events whose sound is `s`. */
export const onsetsOf = (events: PatternEvent[], s: string) =>
  events.filter((e) => (e.value as { s?: string })?.s === s).map((e) => fraction(e.begin)).sort((a, b) => a - b);

export const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

/** Whether two sorted number lists are equal, within a tolerance. */
export const sameTimes = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => near(x, b[i]));

/** Pitch of an event as MIDI, from `note` (name or number) or `freq`. */
export function midiOf(event: PatternEvent, noteToMidi: (n: string) => number): number | undefined {
  const v = event.value as { note?: string | number; n?: number; freq?: number };
  if (typeof v?.note === 'number') return v.note;
  if (typeof v?.note === 'string') return noteToMidi(v.note);
  if (typeof v?.freq === 'number') return Math.round(69 + 12 * Math.log2(v.freq / 440));
  return undefined;
}
