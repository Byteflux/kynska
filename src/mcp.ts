// `kynska mcp`: the kynska commands as MCP tools, over stdio.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { renderCode } from './audio/render.ts';
import { formatReport, reportRender } from './audio/report.ts';
import { encodeWav } from './audio/wav.ts';
import { OUT_DIR } from './paths.ts';
import { checkCode, formatCheck } from './patterns/check.ts';
import { diffCode, formatDiff } from './patterns/diff.ts';
import { languageOf, type Language } from './patterns/evaluate.ts';
import { runPattern } from './patterns/events.ts';
import { formatEntry, loadReference, MissingReferenceError, ReferenceIndex } from './reference/lookup.ts';

const source = {
  code: z.string().optional().describe('Strudel code'),
  file: z.string().optional().describe('A file with Strudel code, instead of code (.mondo for Mondo notation)'),
  mondo: z.boolean().optional().describe('The code is Mondo notation throughout'),
};

async function codeOf(args: { code?: string; file?: string; mondo?: boolean }): Promise<{ code: string; language: Language }> {
  if (args.code !== undefined) return { code: args.code, language: args.mondo ? 'mondo' : 'js' };
  if (args.file) return { code: await readFile(resolve(args.file), 'utf8'), language: args.mondo ? 'mondo' : languageOf(args.file) };
  throw new Error('give code or file');
}

async function reference(): Promise<ReferenceIndex | undefined> {
  try {
    return new ReferenceIndex(await loadReference());
  } catch (error) {
    if (error instanceof MissingReferenceError) return undefined;
    throw error;
  }
}

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError } : {}) });

/** Runs a tool body, turning a thrown error into an error result the model can read. */
const tool =
  <A>(body: (args: A) => Promise<string>) =>
  async (args: A) => {
    try {
      return text(await body(args));
    } catch (error) {
      return text(`error: ${(error as Error).message}`, true);
    }
  };

export async function serveMcp(): Promise<void> {
  // stdout carries the protocol; Strudel's logging goes to stderr.
  console.log = console.error;
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const server = new McpServer({ name: 'kynska', version });

  server.registerTool(
    'check',
    {
      description:
        'Check Strudel code before playing it: syntax, unknown functions (with suggestions), undocumented and browser-only functions, evaluation errors, Strudel warnings, silence.',
      inputSchema: { ...source, cycles: z.number().positive().optional().describe('Cycles to query (default 4)') },
    },
    tool(async (args) => {
      const { code, language } = await codeOf(args);
      return formatCheck(await checkCode(code, { reference: await reference(), cycles: args.cycles ?? 4, language }), args.file ?? 'code');
    }),
  );

  server.registerTool(
    'events',
    {
      description: 'List the events (what plays when) Strudel code produces over the first cycles. Positions are in cycles.',
      inputSchema: { ...source, cycles: z.number().positive().optional().describe('Cycles (default 1)') },
    },
    tool(async (args) => {
      const { code, language } = await codeOf(args);
      const run = await runPattern(code, args.cycles ?? 1, language);
      return [...run.messages.map((m) => `strudel: ${m}`), ...run.events.map((e) => e.show), `(${run.events.length} events, ${run.cps} cycles per second)`].join('\n');
    }),
  );

  server.registerTool(
    'diff',
    {
      description: 'Compare the events of two versions of Strudel code: changed, removed and added events.',
      inputSchema: {
        before: z.string().describe('Earlier code'),
        after: z.string().describe('Later code'),
        cycles: z.number().positive().optional().describe('Cycles (default 1)'),
        mondo: z.boolean().optional(),
      },
    },
    tool(async (args) => {
      const cycles = args.cycles ?? 1;
      return formatDiff(await diffCode(args.before, args.after, cycles, args.mondo ? 'mondo' : 'js'), cycles);
    }),
  );

  server.registerTool(
    'lookup',
    {
      description: "A Strudel function's reference entry (how to call it, parameters, examples), or the functions with a tag or in a module.",
      inputSchema: { name: z.string().optional(), tag: z.string().optional(), module: z.string().optional() },
    },
    tool(async (args) => {
      const index = await reference();
      if (!index) throw new Error('The reference is not built. Build it with: kynska docs build');
      if (args.tag || args.module) {
        const entries = args.tag ? index.withTag(args.tag) : index.inModule(args.module!);
        return entries.map((e) => e.name).join('\n') || 'none';
      }
      const entry = index.find(args.name ?? '');
      if (!entry) {
        const s = index.suggest(args.name ?? '');
        return `No Strudel function \`${args.name}\`.${s.length ? ` Did you mean ${s.join(', ')}?` : ''}`;
      }
      return formatEntry(entry, args.name);
    }),
  );

  server.registerTool(
    'render',
    {
      description:
        "Render Strudel code to a WAV file with Strudel's audio engine and measure it: peak, loudness (LUFS), clipping, silence, and whether sound starts at the event times.",
      inputSchema: {
        ...source,
        out: z.string().describe('Path of the WAV file to write'),
        cycles: z.number().positive().optional().describe('Cycles (default 4)'),
        tail: z.number().min(0).optional().describe('Seconds after the last cycle, for tails (default 0)'),
      },
    },
    tool(async (args) => {
      const { code, language } = await codeOf(args);
      const rendered = await renderCode(code, { cycles: args.cycles ?? 4, tail: args.tail ?? 0, language });
      const file = resolve(args.out);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, encodeWav(rendered.channels, rendered.sampleRate));
      return formatReport(reportRender(rendered, file));
    }),
  );

  server.registerTool(
    'docs_path',
    { description: "Where the generated Strudel docs are: llms.txt (an index of pages), llms-full.txt, the pages, and the function reference.", inputSchema: {} },
    tool(async () => {
      const llms = join(OUT_DIR, 'llms.txt');
      if (!existsSync(llms)) throw new Error('The docs are not built. Build them with: kynska docs build');
      return [llms, join(OUT_DIR, 'llms-full.txt'), join(OUT_DIR, 'docs'), join(OUT_DIR, 'docs', 'reference.md')].join('\n');
    }),
  );

  await server.connect(new StdioServerTransport());
}
