// Runs the evals: node evals/run.ts [--agent llm|oracle] [--model M]
//   [--conditions baseline,kynska] [--transcribe N] [--concurrency N]
// The llm agent reads KYNSKA_EVAL_BASE_URL and KYNSKA_EVAL_API_KEY (an
// OpenAI-compatible API). The oracle agent answers with each task's known
// solution, to prove the tasks and scoring without a model.
// Writes out/evals/<run>/results.jsonl and summary.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { OUT_DIR } from '../src/paths.ts';
import { loadReference, ReferenceIndex } from '../src/reference/lookup.ts';
import { runAgent, type Condition } from './agent.ts';
import { describeTasks, scoreTask, transcribeTasks, type Task } from './tasks.ts';

const { values } = parseArgs({
  options: {
    agent: { type: 'string', default: 'llm' },
    model: { type: 'string' },
    conditions: { type: 'string', default: 'baseline,kynska' },
    transcribe: { type: 'string', default: '16' },
    concurrency: { type: 'string', default: '4' },
  },
});

const reference = new ReferenceIndex(await loadReference());
const tasks: Task[] = [...(await transcribeTasks(reference.reference, Number(values.transcribe))), ...describeTasks];
const conditions = (values.agent === 'oracle' ? ['oracle'] : values.conditions!.split(',')) as (Condition | 'oracle')[];
const config =
  values.agent === 'llm'
    ? {
        baseUrl: process.env.KYNSKA_EVAL_BASE_URL ?? '',
        apiKey: process.env.KYNSKA_EVAL_API_KEY ?? '',
        model: values.model ?? '',
      }
    : undefined;
if (config && (!config.baseUrl || !config.apiKey || !config.model)) {
  console.error('The llm agent needs --model and KYNSKA_EVAL_BASE_URL and KYNSKA_EVAL_API_KEY in the environment.');
  process.exit(2);
}

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${values.agent}${config ? `-${config.model.replace(/[^\w.-]+/g, '_')}` : ''}`;
const dir = join(OUT_DIR, 'evals', runId);
await mkdir(dir, { recursive: true });
console.log(`${tasks.length} tasks (${tasks.filter((t) => t.kind === 'transcribe').length} transcribe, ${describeTasks.length} describe) x ${conditions.join(', ')} -> ${dir}`);

type Row = { task: string; kind: string; condition: string; score: number; detail: string; error?: string; turns: number; toolCalls: number; tokens: number; seconds: number; code: string };
const rows: Row[] = [];
const jobs = conditions.flatMap((condition) => tasks.map((task) => ({ task, condition })));
let next = 0;
let done = 0;

async function worker() {
  while (next < jobs.length) {
    const { task, condition } = jobs[next++];
    const started = performance.now();
    let row: Row;
    try {
      const answer =
        condition === 'oracle'
          ? { code: task.solution, turns: 0, toolCalls: 0, tokens: 0, transcript: [] as unknown[] }
          : await runAgent(task.prompt, condition, config!, reference);
      const score = await scoreTask(task, answer.code);
      row = { task: task.id, kind: task.kind, condition, ...score, turns: answer.turns, toolCalls: answer.toolCalls, tokens: answer.tokens, seconds: (performance.now() - started) / 1000, code: answer.code };
      if (answer.transcript.length) await writeFile(join(dir, `${condition}--${task.id.replace(/\//g, '--')}.json`), JSON.stringify(answer.transcript, null, 2));
    } catch (error) {
      row = { task: task.id, kind: task.kind, condition, score: 0, detail: 'agent failed', error: (error as Error).message, turns: 0, toolCalls: 0, tokens: 0, seconds: (performance.now() - started) / 1000, code: '' };
    }
    rows.push(row);
    await writeFile(join(dir, 'results.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    done++;
    console.log(`[${done}/${jobs.length}] ${row.condition} ${row.task}: ${row.score.toFixed(2)} (${row.detail}${row.error ? `; ${row.error.slice(0, 80)}` : ''})`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency)) }, worker));

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const lines = [
  `# Eval run ${runId}`,
  '',
  `Agent: ${values.agent}${config ? `, model ${config.model}` : ''}. ${tasks.length} tasks.`,
  '',
  '| Condition | Kind | Tasks | Mean score | Perfect | Mean tool calls | Mean tokens | Failed to answer |',
  '|---|---|---|---|---|---|---|---|',
];
for (const condition of conditions) {
  for (const kind of ['transcribe', 'describe', 'all']) {
    const rs = rows.filter((r) => r.condition === condition && (kind === 'all' || r.kind === kind));
    lines.push(
      `| ${condition} | ${kind} | ${rs.length} | ${mean(rs.map((r) => r.score)).toFixed(3)} | ${rs.filter((r) => r.score === 1).length} | ${mean(rs.map((r) => r.toolCalls)).toFixed(1)} | ${Math.round(mean(rs.map((r) => r.tokens)))} | ${rs.filter((r) => r.detail === 'agent failed').length} |`,
    );
  }
}
const summary = lines.join('\n');
await writeFile(join(dir, 'summary.md'), `${summary}\n`);
console.log(`\n${summary}`);
process.exit(0);
