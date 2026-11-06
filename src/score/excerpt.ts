// Cut bars out of a reference into a MIDI file of their own: tempo and metre as
// they stand at the first bar, one track per part, notes held past the last bar cut short.
import { writeMidi } from './midi.ts';
import type { ReferenceScore } from './reference-score.ts';

export function excerptMidi(score: ReferenceScore, [from, to]: [number, number]): Uint8Array {
  const bars = score.bars.filter((b) => b.number >= from && b.number <= to);
  if (!bars.length) throw new Error(`the reference has bars 1 to ${score.bars.length}, not ${from}-${to}`);
  const start = bars[0].startTick;
  const end = bars[bars.length - 1].endTick;
  const { midi } = score;
  const inEffect = <T extends { tick: number }>(list: T[], fallback: T) => [
    { ...([...list].reverse().find((x) => x.tick <= start) ?? fallback), tick: 0 },
    ...list.filter((x) => x.tick > start && x.tick < end).map((x) => ({ ...x, tick: x.tick - start })),
  ];
  return writeMidi({
    ticksPerQuarter: midi.ticksPerQuarter,
    tempos: inEffect(midi.tempos, { tick: 0, bpm: 120 }),
    timeSignatures: inEffect(midi.timeSignatures, { tick: 0, numerator: 4, denominator: 4 }),
    tracks: score.parts
      .map((p) => ({
        name: p.name,
        programs: p.program === undefined ? {} : { [p.channel - 1]: p.program },
        notes: p.notes
          .filter((n) => n.startTick >= start && n.startTick < end)
          .map((n) => ({ pitch: n.pitch, start: n.startTick - start, end: Math.min(n.endTick, end) - start, channel: p.channel - 1 })),
      }))
      .filter((t) => t.notes.length),
  });
}
