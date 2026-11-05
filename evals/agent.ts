// The agent under test: a chat model behind an OpenAI-compatible API.
//  - baseline: the task alone, one answer, no tools.
//  - kynska: the strudel skill as instructions and a `kynska` tool mirroring the
//    CLI (check, events, diff, lookup, plus reading skill and docs files).
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { OUT_DIR, ROOT } from '../src/paths.ts';
import { checkCode, formatCheck } from '../src/patterns/check.ts';
import { diffCode, formatDiff } from '../src/patterns/diff.ts';
import { runPattern } from '../src/patterns/events.ts';
import { formatEntry, type ReferenceIndex } from '../src/reference/lookup.ts';

export type Condition = 'baseline' | 'kynska';

/** `budgetMs`: wall-clock time after which a kynska run stops taking turns and
 * is asked for its final code, as when it runs out of turns. */
export type ModelConfig = { baseUrl: string; apiKey: string; model: string; budgetMs?: number };

export type AgentResult = { code: string; turns: number; toolCalls: number; tokens: number; transcript: unknown[] };

type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const SKILL_DIR = join(ROOT, 'skills', 'strudel');
const MAX_TURNS = 12;
const MAX_TOOL_OUTPUT = 6000;

const BASELINE_SYSTEM = 'You write Strudel code (strudel.cc, the JavaScript port of TidalCycles). Answer with the code in one ```js block.';

async function kynskaSystem(): Promise<string> {
  const skill = (await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8')).replace(/^---[\s\S]*?---\n/, '');
  return `${BASELINE_SYSTEM}

In this environment you have no shell; the kynska CLI is the \`kynska\` tool, which takes code inline instead of a file. Reference files beside the skill (compose.md, arrange.md, mix.md, tidal.md, debug.md) and docs pages (docs/learn/mini-notation.md, ...) are read with its "read" command. Rendering is not available here: prove your work with check and events. When done, reply with the final code in one \`\`\`js block.

${skill}`;
}

const TOOL = {
  type: 'function',
  function: {
    name: 'kynska',
    description: 'Run a kynska command on Strudel code: check, events, diff, lookup, or read a skill or docs file.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['check', 'events', 'diff', 'lookup', 'read'] },
        code: { type: 'string', description: 'Strudel code, for check and events' },
        before: { type: 'string', description: 'for diff: the earlier code' },
        after: { type: 'string', description: 'for diff: the later code' },
        cycles: { type: 'number', description: 'cycles to query (events, diff, check)' },
        name: { type: 'string', description: 'for lookup: a function name' },
        file: { type: 'string', description: 'for read: e.g. compose.md or docs/learn/mini-notation.md' },
      },
      required: ['command'],
    },
  },
};

/** Runs one tool call, returning what the CLI would print. */
export async function runTool(args: Record<string, any>, reference: ReferenceIndex): Promise<string> {
  const cycles = typeof args.cycles === 'number' && args.cycles > 0 ? Math.min(args.cycles, 64) : undefined;
  try {
    switch (args.command) {
      case 'check':
        return formatCheck(await checkCode(String(args.code ?? ''), { reference, cycles: cycles ?? 4 }), 'code');
      case 'events': {
        const run = await runPattern(String(args.code ?? ''), cycles ?? 1);
        return [...run.messages.map((m) => `strudel: ${m}`), ...run.events.map((e) => e.show), `(${run.events.length} events, ${run.cps} cycles per second)`].join('\n');
      }
      case 'diff':
        return formatDiff(await diffCode(String(args.before ?? ''), String(args.after ?? ''), cycles ?? 1), cycles ?? 1);
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
        return `Unknown command "${args.command}"; use check, events, diff, lookup or read.`;
    }
  } catch (error) {
    return `error: ${(error as Error).message}`;
  }
}

/** Room for a reasoning model's thinking as well as its reply: at 4096,
 * GLM-5.3 spent every token reasoning on half the tasks and wrote no code. */
const MAX_REPLY_TOKENS = 16384;

async function complete(config: ModelConfig, messages: Message[], tools: boolean): Promise<{ message: Message; tokens: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    let data: { choices: { message: Message; finish_reason?: string }[]; usage?: { total_tokens?: number } };
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages, temperature: 0, max_tokens: MAX_REPLY_TOKENS, ...(tools ? { tools: [TOOL] } : {}) }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);
      data = await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    const { message, finish_reason } = data.choices[0];
    // A reply cut off before any answer is the model's failure, not a network one: no retry.
    if (finish_reason === 'length' && !message.content?.trim() && !message.tool_calls?.length) {
      throw new Error(`reply cut off at ${MAX_REPLY_TOKENS} tokens before any answer`);
    }
    return { message, tokens: data.usage?.total_tokens ?? 0 };
  }
  throw lastError;
}

/** The last fenced code block in a reply. */
export function extractCode(text: string): string {
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks[blocks.length - 1][1].trim() : text.trim();
}

export async function runAgent(prompt: string, condition: Condition, config: ModelConfig, reference: ReferenceIndex): Promise<AgentResult> {
  const messages: Message[] = [
    { role: 'system', content: condition === 'kynska' ? await kynskaSystem() : BASELINE_SYSTEM },
    { role: 'user', content: prompt },
  ];
  let tokens = 0;
  let toolCalls = 0;
  const deadline = performance.now() + (config.budgetMs ?? Infinity);
  let turn = 1;
  for (; turn <= (condition === 'kynska' ? MAX_TURNS : 1) && (turn === 1 || performance.now() < deadline); turn++) {
    const { message, tokens: used } = await complete(config, messages, condition === 'kynska');
    tokens += used;
    messages.push({ role: 'assistant', content: message.content ?? '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });
    if (!message.tool_calls?.length) return { code: extractCode(message.content ?? ''), turns: turn, toolCalls, tokens, transcript: messages };
    for (const call of message.tool_calls) {
      toolCalls++;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // leave empty; the tool reports the unknown command
      }
      const output = (await runTool(args, reference)).slice(0, MAX_TOOL_OUTPUT);
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }
  // Out of turns or time: ask for the final answer without tools.
  messages.push({ role: 'user', content: 'Reply now with your final code in one ```js block.' });
  const { message, tokens: used } = await complete(config, messages, false);
  messages.push({ role: 'assistant', content: message.content ?? '' });
  return { code: extractCode(message.content ?? ''), turns: turn, toolCalls, tokens: tokens + used, transcript: messages };
}
