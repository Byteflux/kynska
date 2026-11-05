// Runs the evals: node evals/run.ts [--agent llm|oracle] [--model M]
//   [--conditions baseline,kynska] [--transcribe N] [--concurrency N] [--minutes M] [--repeats N]
// The llm agent reads KYNSKA_EVAL_BASE_URL and KYNSKA_EVAL_API_KEY (an
// OpenAI-compatible API). The oracle agent answers with each task's known
// solution, to prove the tasks and scoring without a model.
// Writes out/evals/<run>/results.jsonl and summary.md.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { OUT_DIR } from '../src/paths.ts';
import { loadReference, ReferenceIndex } from '../src/reference/lookup.ts';
import { runAgent, type AgentCosts, type Condition } from './agent.ts';
import { describeTasks, produceTasks, scoreTask, transcribeTasks, type Task } from './tasks.ts';
import { emptyCosts } from './render.ts';
import { summarize, type Row } from './summary.ts';
import { pool } from '../src/patterns/layers.ts';

const { values } = parseArgs({
  options: {
    agent: { type: 'string', default: 'llm' },
    model: { type: 'string' },
    conditions: { type: 'string', default: 'baseline,kynska' },
    transcribe: { type: 'string', default: '16' },
    concurrency: { type: 'string', default: '4' },
    repeats: { type: 'string', default: '1' },
    // Per kynska run: after this many minutes it is asked for its final code.
    minutes: { type: 'string', default: '6' },
  },
});

const repeats = Number(values.repeats);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(repeats) || repeats < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('repeats and concurrency must be positive integers');
if (!['llm', 'oracle'].includes(values.agent!)) throw new Error('agent must be llm or oracle');
const reference = new ReferenceIndex(await loadReference());
const tasks: Task[] = [...(await transcribeTasks(reference.reference, Number(values.transcribe))), ...describeTasks, ...produceTasks];
const conditions = (values.agent === 'oracle' ? ['oracle'] : values.conditions!.split(',')) as (Condition | 'oracle')[];
if (values.agent !== 'oracle' && conditions.some((c) => c !== 'baseline' && c !== 'kynska')) throw new Error('conditions must be baseline,kynska');
const config =
  values.agent === 'llm'
    ? {
        baseUrl: process.env.KYNSKA_EVAL_BASE_URL ?? '',
        apiKey: process.env.KYNSKA_EVAL_API_KEY ?? '',
        model: values.model ?? '',
        budgetMs: Number(values.minutes) * 60_000,
      }
    : undefined;
if (config && (!config.baseUrl || !config.apiKey || !config.model)) {
  console.error('The llm agent needs --model and KYNSKA_EVAL_BASE_URL and KYNSKA_EVAL_API_KEY in the environment.');
  process.exit(2);
}

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${values.agent}${config ? `-${config.model.replace(/[^\w.-]+/g, '_')}` : ''}`;
const dir = join(OUT_DIR, 'evals', runId);
await mkdir(dir, { recursive: true });
console.log(`${tasks.length} tasks (${tasks.filter((t) => t.kind === 'transcribe').length} transcribe, ${describeTasks.length} describe, ${produceTasks.length} produce) x ${conditions.join(', ')} x ${repeats} repeats -> ${dir}`);

const rows: Row[] = [];
const jobs = conditions.flatMap((condition) => tasks.flatMap((task) => Array.from({ length: repeats }, (_, i) => ({ task, condition, repeat: i + 1 }))));
let done = 0;

async function runJob({ task, condition, repeat }: typeof jobs[number]) {
  const started = performance.now();
  const costs: AgentCosts = { ...emptyCosts(), turns: 0, toolCalls: 0, tokens: 0 };
  let row: Row;
  try {
    const answer =
      condition === 'oracle'
        ? { code: task.solution, transcript: [] as unknown[] }
        : await runAgent(task.prompt, condition, config!, reference, costs);
    const score = answer.code.trim() ? await scoreTask(task, answer.code, costs) : { score: 0, detail: 'no answer' };
    row = { task: task.id, kind: task.kind, condition, repeat, ...score, ...costs, seconds: (performance.now() - started) / 1000, code: answer.code, failedToAnswer: !answer.code.trim() };
    if (answer.transcript.length) await writeFile(join(dir, `${condition}--${task.id.replace(/\//g, '--')}--${repeat}.json`), JSON.stringify(answer.transcript, null, 2));
  } catch (error) {
    row = { task: task.id, kind: task.kind, condition, repeat, score: 0, detail: 'agent failed', error: (error as Error).message, ...costs, seconds: (performance.now() - started) / 1000, code: '', failedToAnswer: true };
  }
  rows.push(row);
  await appendFile(join(dir, 'results.jsonl'), `${JSON.stringify(row)}\n`);
  done++;
  console.log(`[${done}/${jobs.length}] ${row.condition} ${row.task} #${repeat}: ${row.score.toFixed(2)} (${row.detail}${row.error ? `; ${row.error.slice(0, 80)}` : ''})`);
}
// Every kynska job may render, including event tasks. Keep these and production
// scoring jobs in one pool of at most two; tool-less event jobs use the rest.
const renders = jobs.filter((j) => j.condition === 'kynska' || j.task.kind === 'produce');
const events = jobs.filter((j) => j.condition !== 'kynska' && j.task.kind !== 'produce');
const renderLimit = Math.min(2, concurrency);
if (concurrency <= 2) {
  await pool(jobs, concurrency, runJob);
} else {
  await Promise.all([pool(renders, renderLimit, runJob), pool(events, Math.max(1, concurrency - renderLimit), runJob)]);
}

const lines = [
  `# Eval run ${runId}`,
  '',
  `Agent: ${values.agent}${config ? `, model ${config.model}` : ''}. ${tasks.length} tasks, ${repeats} repeats.`,
  '',
  summarize(rows, conditions),
  '',
  'Render calls include agent drafts and final scoring renders. Render seconds count generated audio, including each solo layer and tails; seconds is elapsed wall time. Failed to answer counts empty replies and agent errors; invalid code is an answered task scoring zero.',
];
const summary = lines.join('\n');
await writeFile(join(dir, 'summary.md'), `${summary}\n`);
console.log(`\n${summary}`);
process.exitCode = values.agent === 'oracle' && rows.some((r) => r.score !== 1) ? 1 : 0;
