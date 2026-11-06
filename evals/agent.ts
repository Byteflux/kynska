// The agent under test: a chat model behind an OpenAI-compatible API.
//  - baseline: the task alone, one answer, no tools.
//  - kynska: the strudel skill as instructions and a `kynska` tool mirroring the
//    CLI, including offline render, plus reading skill and docs files.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { OUT_DIR, ROOT } from '../src/paths.ts';
import { checkCode, formatCheck } from '../src/patterns/check.ts';
import { compareToReference, formatCompare } from '../src/patterns/compare.ts';
import { formatNotes, parseBars, readReferenceScore } from '../src/score/reference-score.ts';
import { diffCode, formatDiff } from '../src/patterns/diff.ts';
import { runPattern } from '../src/patterns/events.ts';
import { formatForm, formOf } from '../src/patterns/form.ts';
import { parseSections, windowOf } from '../src/patterns/sections.ts';
import { formatEntry, type ReferenceIndex } from '../src/reference/lookup.ts';
import { emptyCosts, evalRender, type RenderCosts } from './render.ts';

export type Condition = 'baseline' | 'kynska';

/** `budgetMs`: wall-clock time after which a kynska run stops taking turns and
 * is asked for its final code, as when it runs out of turns.
 * `temperature` and `effort` (reasoning_effort, omitted when unset) apply to
 * both conditions alike. At temperature 0 GLM-5.3's reasoning fell into a
 * repetition loop ("Hmm, hmm, ...") after about 25k tokens; at its default
 * effort it deliberated past 65k tokens without answering a production brief;
 * at medium effort it still looped in self-checks on some transcriptions after
 * about 17k. `reasoningTokens` is a hard budget the server enforces, after
 * which the model answers. */
export type ModelConfig = { baseUrl: string; apiKey: string; model: string; budgetMs?: number; temperature?: number; effort?: string; reasoningTokens?: number };

/** `rateLimitedSeconds`: time spent waiting out 429s, not counted as the run's own. */
export type AgentCosts = RenderCosts & { turns: number; toolCalls: number; tokens: number; rateLimitedSeconds?: number };
export type AgentResult = AgentCosts & { code: string; transcript: unknown[] };

type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const SKILL_DIR = join(ROOT, 'skills', 'strudel');
const MAX_TURNS = 12;
const MAX_TOOL_OUTPUT = 6000;

const BASELINE_SYSTEM = 'You write Strudel code (strudel.cc, the JavaScript port of TidalCycles). Answer with the code in one ```js block.';

async function kynskaSystem(): Promise<string> {
  const skill = (await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8')).replace(/^---[\s\S]*?---\n/, '');
  return `${BASELINE_SYSTEM}

In this environment you have no shell; the kynska CLI is the \`kynska\` tool, which takes code inline instead of a file. When a task comes with a reference song, its MIDI file is already loaded: \`notes\` and \`compare\` use it, with no file argument. Reference files beside the skill (compose.md, arrange.md, mix.md, tidal.md, recreate.md, debug.md) and docs pages (docs/learn/mini-notation.md, ...) are read with its "read" command. Use render to measure audio, layers and sections, draft with from/to, and master to a LUFS target. Each render is capped at 32 seconds including tails and uses cached sounds only. WAVs are temporary. When done, reply with the final code in one \`\`\`js block.

${skill}`;
}

const TOOL = {
  type: 'function',
  function: {
    name: 'kynska',
    description: "Run a kynska command on Strudel code: check, events, diff, form, render, lookup, or read a skill or docs file; when the task has a reference MIDI file, notes reads it and compare checks code against it.",
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['check', 'events', 'diff', 'form', 'render', 'notes', 'compare', 'lookup', 'read'] },
        code: { type: 'string', description: 'Strudel code, for check, events, form, render and compare' },
        bars: { type: 'string', description: 'for notes/compare: reference bars, e.g. "1-4"' },
        beatsPerCycle: { type: 'number', description: 'for compare: quarter notes per cycle (default: found)' },
        offset: { type: 'number', description: 'for compare: cycle where the first compared bar starts (default: found)' },
        transpose: { type: 'number', description: 'for compare: semitones the piece is meant to sound above the reference' },
        sections: { type: 'string', description: 'for form/render: section lengths in cycles, e.g. "intro=4,A=8"' },
        from: { type: 'number', description: 'for render: first cycle, zero-based' },
        to: { type: 'number', description: 'for render: end cycle, exclusive; use to or cycles' },
        layers: { type: 'boolean', description: 'for render: measure each labelled layer alone too' },
        master: { type: 'number', description: 'for render: negative LUFS target, e.g. -14, with -1 dBFS peak ceiling' },
        tail: { type: 'number', description: 'for render: extra seconds for release/reverb, default 0' },
        sampleRate: { type: 'number', description: 'for render: Hz, default 48000' },
        before: { type: 'string', description: 'for diff: the earlier code' },
        after: { type: 'string', description: 'for diff: the later code' },
        cycles: { type: 'number', description: 'cycles to query or render (events, diff, check, form, render)' },
        name: { type: 'string', description: 'for lookup: a function name' },
        file: { type: 'string', description: 'for read: e.g. compose.md or docs/learn/mini-notation.md' },
      },
      required: ['command'],
    },
  },
};

/** Runs one tool call, returning what the CLI would print. `midi`: the task's reference song, for notes and compare. */
export async function runTool(args: Record<string, any>, reference: ReferenceIndex, costs: RenderCosts = emptyCosts(), directory?: string, midi?: Uint8Array): Promise<string> {
  const cycles = typeof args.cycles === 'number' && args.cycles > 0 ? Math.min(args.cycles, 64) : undefined;
  const number = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  try {
    switch (args.command) {
      case 'notes':
      case 'compare': {
        if (!midi) return `This task has no reference MIDI file for ${args.command}.`;
        const score = readReferenceScore(midi, 'reference.mid');
        const bars = args.bars ? parseBars(String(args.bars)) : undefined;
        if (args.command === 'notes') return formatNotes(score, { bars });
        const report = await compareToReference(String(args.code ?? ''), score, {
          bars,
          quartersPerCycle: number(args.beatsPerCycle),
          offset: number(args.offset),
          transpose: number(args.transpose),
        });
        return formatCompare(report, score);
      }
      case 'render':
        return (await evalRender(String(args.code ?? ''), args, costs, directory)).text;
      case 'check':
        return formatCheck(await checkCode(String(args.code ?? ''), { reference, cycles: cycles ?? 4 }), 'code');
      case 'events': {
        const run = await runPattern(String(args.code ?? ''), cycles ?? 1);
        return [...run.messages.map((m) => `strudel: ${m}`), ...run.events.map((e) => e.show), `(${run.events.length} events, ${run.cps} cycles per second)`].join('\n');
      }
      case 'diff':
        return formatDiff(await diffCode(String(args.before ?? ''), String(args.after ?? ''), cycles ?? 1), cycles ?? 1);
      case 'form': {
        const sections = args.sections ? parseSections(String(args.sections)) : undefined;
        return formatForm(await formOf(String(args.code ?? ''), Math.min(windowOf({ cycles }, 8, sections).cycles, 64), 'js', sections));
      }
      case 'lookup': {
        const entry = reference.find(String(args.name ?? ''));
        if (!entry) {
          const s = reference.suggest(String(args.name ?? ''));
          return `No Strudel function \`${args.name}\` in the reference.${s.length ? ` Did you mean ${s.join(', ')}?` : ''}`;
        }
        return formatEntry(entry, String(args.name));
      }
      case 'read': {
        const file = normalize(String(args.file ?? '')).replace(/^(\.\.(\/|\\|$))+/, '');
        const path = file.startsWith('docs/') ? join(OUT_DIR, file) : join(SKILL_DIR, file);
        return await readFile(path, 'utf8');
      }
      default:
        return `Unknown command "${args.command}"; use check, events, diff, form, render, notes, compare, lookup or read.`;
    }
  } catch (error) {
    return `error: ${(error as Error).message}`;
  }
}

/** Room for a reasoning model's thinking as well as its reply: at 4096,
 * GLM-5.3 spent every token reasoning on half the tasks and wrote no code.
 * Bounding the reasoning is the effort setting's job; this is headroom. */
const MAX_REPLY_TOKENS = 32768;
const REPLY_TIMEOUT_MS = 30 * 60_000;

/** The request's reasoning settings, each omitted when unset. */
export function reasoningOptions({ effort, reasoningTokens }: Pick<ModelConfig, 'effort' | 'reasoningTokens'>) {
  return { ...(effort ? { reasoning_effort: effort } : {}), ...(reasoningTokens ? { reasoning: { max_tokens: reasoningTokens } } : {}) };
}

type Reply = { message: Message; finish_reason?: string; usage?: { total_tokens?: number } };

/**
 * Reads a chat completion, streamed (server-sent events) or as one JSON body.
 * Replies are streamed because a long reasoning reply sent whole arrives after
 * undici's 300 s headers timeout and fails as "fetch failed".
 */
export async function readReply(response: Response): Promise<Reply> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json();
    return { ...data.choices[0], usage: data.usage };
  }
  const message: Message = { role: 'assistant', content: '' };
  const calls: ToolCall[] = [];
  let finish_reason: string | undefined;
  let usage: Reply['usage'];
  let buffer = '';
  const decoder = new TextDecoder();
  const take = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return;
    const data = JSON.parse(payload);
    if (data.usage) usage = data.usage;
    const choice = data.choices?.[0];
    if (!choice) return;
    finish_reason = choice.finish_reason ?? finish_reason;
    message.content += choice.delta?.content ?? '';
    // Tool calls arrive in pieces keyed by index: id and name once, arguments in chunks.
    for (const piece of choice.delta?.tool_calls ?? []) {
      const call = (calls[piece.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (piece.id) call.id = piece.id;
      if (piece.function?.name) call.function.name += piece.function.name;
      if (piece.function?.arguments) call.function.arguments += piece.function.arguments;
    }
  };
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) take(line.trim());
  }
  take(buffer.trim());
  if (calls.length) message.tool_calls = calls.filter(Boolean);
  return { message, finish_reason, usage };
}

/** Longest a single model call waits out rate limits before it fails. */
const MAX_RATE_LIMIT_WAIT_MS = 20 * 60_000;

/** Milliseconds to wait on a 429: the Retry-After seconds if given, else a
 * backoff from 5 s doubling with the time already waited, at most 60 s. */
export function retryAfterMs(header: string | null, waitedMs: number): number {
  const seconds = Number(header);
  if (header !== null && header.trim() !== '' && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return Math.min(60_000, Math.max(5000, waitedMs));
}

async function complete(config: ModelConfig, messages: Message[], tools: boolean, costs: AgentCosts): Promise<Message> {
  let lastError: unknown;
  let rateLimitedMs = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    let data: Reply;
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages, temperature: config.temperature ?? 0, ...reasoningOptions(config), max_tokens: MAX_REPLY_TOKENS, stream: true, stream_options: { include_usage: true }, ...(tools ? { tools: [TOOL] } : {}) }),
        signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
      });
      // Rate limited: wait as long as the API asks and try again, without
      // spending an attempt; the wait is not the run's own time.
      if (response.status === 429 && rateLimitedMs < MAX_RATE_LIMIT_WAIT_MS) {
        await response.body?.cancel();
        const waitMs = retryAfterMs(response.headers.get('retry-after'), rateLimitedMs);
        rateLimitedMs += waitMs;
        costs.rateLimitedSeconds = (costs.rateLimitedSeconds ?? 0) + waitMs / 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        attempt--;
        continue;
      }
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);
      data = await readReply(response);
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    const { message, finish_reason } = data;
    costs.tokens += data.usage?.total_tokens ?? 0;
    // A reply cut off before any answer is the model's failure, not a network one: no retry.
    if (finish_reason === 'length' && !message.content?.trim() && !message.tool_calls?.length) {
      throw new Error(`reply cut off at ${MAX_REPLY_TOKENS} tokens before any answer`);
    }
    // An empty reply that still spent tokens: GLM-5.3 asked for final code
    // sometimes emits a tool call the server strips from the content without
    // returning it (about 1 in 3 replays). Ask again, like a failed request.
    if (!message.content?.trim() && !message.tool_calls?.length) {
      lastError = new Error(`empty reply (${data.usage?.total_tokens ?? 0} tokens, finish ${finish_reason ?? 'unknown'}) after ${attempt + 1} attempts`);
      continue;
    }
    return message;
  }
  throw lastError;
}

/** The last fenced code block in a reply. */
export function extractCode(text: string): string {
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks[blocks.length - 1][1].trim() : text.trim();
}

/** `midi`: a reference song the task comes with, for the kynska tool's notes and compare. */
export async function runAgent(prompt: string, condition: Condition, config: ModelConfig, reference: ReferenceIndex, costs: AgentCosts = { ...emptyCosts(), turns: 0, toolCalls: 0, tokens: 0 }, midi?: Uint8Array): Promise<AgentResult> {
  const directory = await mkdtemp(join(tmpdir(), 'kynska-eval-run-'));
  try {
    return await runAgentTurns(prompt, condition, config, reference, costs, directory, midi);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runAgentTurns(prompt: string, condition: Condition, config: ModelConfig, reference: ReferenceIndex, costs: AgentCosts, directory: string, midi?: Uint8Array): Promise<AgentResult> {
  const withMidi = condition === 'kynska' && midi ? `${prompt}\n\nThe excerpt is also loaded as a MIDI file for the kynska tool: notes prints it, compare checks code against it.` : prompt;
  const messages: Message[] = [
    { role: 'system', content: condition === 'kynska' ? await kynskaSystem() : BASELINE_SYSTEM },
    { role: 'user', content: withMidi },
  ];
  const deadline = performance.now() + (config.budgetMs ?? Infinity);
  let turn = 1;
  // Waiting out rate limits does not use up the turn budget.
  const ownTime = () => performance.now() - (costs.rateLimitedSeconds ?? 0) * 1000;
  for (; turn <= (condition === 'kynska' ? MAX_TURNS : 1) && (turn === 1 || ownTime() < deadline); turn++) {
    costs.turns = turn;
    const message = await complete(config, messages, condition === 'kynska', costs);
    messages.push({ role: 'assistant', content: message.content ?? '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });
    if (condition === 'baseline' || !message.tool_calls?.length) return { code: extractCode(message.content ?? ''), ...costs, transcript: messages };
    for (const call of message.tool_calls) {
      costs.toolCalls++;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // leave empty; the tool reports the unknown command
      }
      const output = (await runTool(args, reference, costs, directory, midi)).slice(0, MAX_TOOL_OUTPUT);
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }
  // Out of turns or time: ask for the final answer without tools.
  messages.push({ role: 'user', content: 'Reply now with your final code in one ```js block.' });
  costs.turns = turn;
  const message = await complete(config, messages, false, costs);
  messages.push({ role: 'assistant', content: message.content ?? '' });
  return { code: extractCode(message.content ?? ''), ...costs, transcript: messages };
}
