// Recreate tasks: a few bars of a real piece (test/references, public domain),
// given as a plain list of notes; write Strudel that plays them. Scored by
// `compare`'s F1 against the excerpt's MIDI file, halved at the wrong tempo. Both conditions get the same
// list; the kynska condition can also read the MIDI file with `notes` and check
// its code with `compare`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/paths.ts';
import { compareToReference } from '../src/patterns/compare.ts';
import { excerptMidi } from '../src/score/excerpt.ts';
import { barList, num, readReferenceScore, type ReferenceScore } from '../src/score/reference-score.ts';
import { strudelOf } from '../src/score/to-strudel.ts';

export type RecreateTask = { id: string; kind: 'recreate'; prompt: string; reference: Uint8Array; score: ReferenceScore; solution: string };

/** Excerpts that vary metre, texture and rhythm: a hymn, 3/4, 3/8, held chords, ragtime, a minuet. */
const PICKS: [name: string, bars: [number, number]][] = [
  ['old-hundredth', [1, 4]],
  ['brahms-lullaby', [1, 4]],
  ['fur-elise', [1, 4]],
  ['gymnopedie-1', [1, 4]],
  ['entertainer', [1, 4]],
  ['menuet-k2', [1, 4]],
];

const UNIT: Record<number, string> = { 2: 'half', 4: 'quarter', 8: 'eighth', 16: 'sixteenth' };

/** The excerpt as text: metre, tempo, and every note of every part by bar and beat. */
export function recreatePrompt(score: ReferenceScore, title: string): string {
  const first = score.bars[0];
  const quarters = first.end - first.start;
  const lines = [
    `Write Strudel code that plays this excerpt of ${title}: ${score.bars.length} bars of ${first.numerator}/${first.denominator} at ${num(score.bpm)} bpm counting quarter notes, one bar per cycle, so setcpm(${num(score.bpm)}/${num(quarters)}). Play every note listed at its pitch, position and length, and nothing else. Any sound will do.`,
    '',
    `Each bar lists its notes as "beat: pitches (length in beats)", beats counted from 1 in ${UNIT[first.denominator] ?? `1/${first.denominator}`} notes. Pitches are note names with octave, c4 being middle C.`,
  ];
  for (const p of score.parts) {
    lines.push('', `Part ${p.index}:`);
    for (const bar of score.bars) lines.push(`  bar ${bar.number}: ${barList(p.notes, bar)}`);
  }
  lines.push('', 'Reply with the code in one ```js block.');
  return lines.join('\n');
}

export function recreateTasks(): RecreateTask[] {
  return PICKS.map(([name, bars]) => {
    const file = join(ROOT, 'test', 'references', `${name}.mid`);
    const whole = readReferenceScore(readFileSync(file), `${name}.mid`);
    const reference = excerptMidi(whole, bars);
    const score = readReferenceScore(reference, `${name}.mid`);
    return { id: `recreate/${name}`, kind: 'recreate', prompt: recreatePrompt(score, `"${name}"`), reference, score, solution: strudelOf(score) };
  });
}

/** compare's F1, halved when the tempo is more than 2% off: the brief gives it, and notes in time at the wrong speed are not the piece. */
export async function scoreRecreation(task: RecreateTask, code: string): Promise<{ score: number; detail: string; error?: string }> {
  try {
    const r = await compareToReference(code, task.score);
    const tempo = r.tempo.matches ? '' : `; tempo ${num(r.tempo.piece)} bpm, not ${num(r.tempo.reference)}: halved`;
    const moved = r.detectedTranspose ? `; ${r.detectedTranspose.matched} notes match ${r.detectedTranspose.semitones} semitones away` : '';
    return { score: r.notes.f1 * (r.tempo.matches ? 1 : 0.5), detail: `precision ${r.notes.precision.toFixed(2)}, recall ${r.notes.recall.toFixed(2)}${tempo}${moved}` };
  } catch (error) {
    return { score: 0, detail: 'did not evaluate', error: (error as Error).message };
  }
}
