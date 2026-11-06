// What an event sounds as: a pitch, a drum, or neither.
import type { PatternEvent } from './events.ts';

/** Pitch of an event as MIDI, from `note` (name or number) or `freq`. `n` alone sets no synth pitch. */
export function midiOf(event: PatternEvent, noteToMidi: (n: string) => number): number | undefined {
  const v = event.value as { note?: string | number; freq?: number };
  if (typeof v?.note === 'number') return v.note;
  if (typeof v?.note === 'string') {
    try {
      return noteToMidi(v.note);
    } catch {
      return undefined;
    }
  }
  if (typeof v?.freq === 'number') return Math.round(69 + 12 * Math.log2(v.freq / 440));
  return undefined;
}

/** The drum an event plays, by sound name with any bank prefix dropped ("RolandTR909_bd" → "bd"), if it is one of `drums`. */
export function drumOf(event: PatternEvent, drums: ReadonlySet<string>): string | undefined {
  const v = event.value as { s?: string; note?: unknown; freq?: unknown };
  if (typeof v?.s !== 'string' || v.note !== undefined || v.freq !== undefined) return undefined;
  const name = v.s.split('_').pop()!.split(':')[0].toLowerCase();
  return drums.has(name) ? name : undefined;
}
