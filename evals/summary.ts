import type { AgentCosts } from './agent.ts';
import type { Score } from './tasks.ts';

export type Row = Score & AgentCosts & { task: string; kind: string; condition: string; repeat: number; seconds: number; code: string; failedToAnswer: boolean };
/** A reply that hit the token cap before any answer (see complete() in agent.ts). */
export const isCutOff = (r: Pick<Row, 'error'>) => /^reply cut off at \d+ tokens/.test(r.error ?? '');
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export function summarize(rows: Row[], conditions: string[]): string {
  const lines = [
    '| Condition | Kind | Runs | Mean score | Repeat mean min–max | Perfect | Mean turns | Mean tool calls | Mean tokens | Mean seconds | Mean render calls | Mean render seconds | Failed to answer | Of those, cut off |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const condition of conditions) {
    for (const kind of ['transcribe', 'describe', 'produce', 'all']) {
      const rs = rows.filter((r) => r.condition === condition && (kind === 'all' || r.kind === kind));
      if (!rs.length) continue;
      const scores = rs.map((r) => r.score);
      const repeatMeans = [...new Set(rs.map((r) => r.repeat))].map((repeat) => mean(rs.filter((r) => r.repeat === repeat).map((r) => r.score)));
      const cost = (key: keyof AgentCosts | 'seconds') => mean(rs.map((r) => r[key] ?? 0)).toFixed(1);
      lines.push(`| ${condition} | ${kind} | ${rs.length} | ${mean(scores).toFixed(3)} | ${Math.min(...repeatMeans).toFixed(3)}–${Math.max(...repeatMeans).toFixed(3)} | ${scores.filter((s) => s === 1).length} | ${cost('turns')} | ${cost('toolCalls')} | ${cost('tokens')} | ${cost('seconds')} | ${cost('renderCalls')} | ${cost('renderSeconds')} | ${rs.filter((r) => r.failedToAnswer).length} | ${rs.filter((r) => r.failedToAnswer && isCutOff(r)).length} |`);
    }
  }
  return lines.join('\n');
}
