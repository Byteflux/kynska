// Strudel code that plays a reference exactly: each part one mini-notation
// sequence over the whole excerpt (voices that overlap joined with ","), slowed
// so one bar is one cycle. It is the known answer for tests and evals, not a
// transcription anyone would write.
import { miniOf } from './notation.ts';
import { num, type Part, type ReferenceScore } from './reference-score.ts';

export function strudelOf(score: ReferenceScore, parts: Part[] = score.parts): string {
  const first = score.bars[0];
  const last = score.bars[score.bars.length - 1];
  const barQuarters = first.end - first.start;
  const cycles = (last.end - first.start) / barQuarters;
  const lines = [`setcpm(${num(score.bpm)}/${num(barQuarters)})`];
  for (const part of parts) {
    const control = part.drums ? 's' : 'note';
    lines.push(`// part ${part.index} "${part.name}"`, `$: ${control}("${miniOf(part.notes, first.startTick, last.endTick)}").slow(${num(cycles)})`);
  }
  return lines.join('\n');
}
