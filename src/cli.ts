#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { analyse, detectOnsets } from './audio/analyse.ts';
import { renderCode } from './audio/render.ts';
import { formatLayers, renderLayers } from './audio/layers.ts';
import { formatReport, formatSections, formatStats, reportRender, sectionStats } from './audio/report.ts';
import { decodeWav, encodeWav } from './audio/wav.ts';
import { buildDocs, formatDocsResult } from './docs/build.ts';
import { OUT_DIR, ROOT } from './paths.ts';
import { checkCode, formatCheck } from './patterns/check.ts';
import { diffCode, formatDiff } from './patterns/diff.ts';
import { languageOf, type Language } from './patterns/evaluate.ts';
import { runPattern } from './patterns/events.ts';
import { formatForm, formOf } from './patterns/form.ts';
import { parseSections, windowOf as cycleWindow } from './patterns/sections.ts';
import { buildReference } from './reference/build.ts';
import { formatEntry, loadReference, MissingReferenceError, ReferenceIndex } from './reference/lookup.ts';
import { readPin } from './reference/pin.ts';
import { formatUpstream, upstreamStatus } from './reference/upstream.ts';

const USAGE = `Usage: kynska <command> [options]

Commands:
  events [file] [--cycles N] [--json]     List the events a pattern produces (default 1 cycle)
  check [file] [--cycles N] [--json]      Check code: syntax, unknown or undocumented functions,
                                          evaluation errors, silence (default 4 cycles)
  diff <before> <after> [--cycles N] [--json]
                                          Compare the events of two versions (default 1 cycle)
  lookup <name> [--json]                  Show a function from the Strudel reference
  lookup --tag <tag> | --module <module>  List functions by tag or module
  lookup --tags                           List the tags and how many functions have each
  form [file] [--cycles N] [--sections S] [--json]
                                          Which layer plays which sounds in which cycles; with
                                          sections, events per section and the notes each uses
  render [file] [--cycles N | --from A --to B] [--sections S] [--layers] [--out file.wav]
         [--tail S] [--sample-rate R] [--json]
                                          Render to a WAV file (default 4 cycles, ./render.wav)
                                          and measure it: level, loudness, clipping, silence, onsets;
                                          --sections adds them per section, --layers per layer
  analyse <file.wav> [--sections S --cps C] [--json]
                                          Measure any WAV file the same way (onsets: detected count)
  reference build                         Fetch the pinned Strudel source and build out/reference.json
  docs build                              Build out/reference.json, the docs pages, llms.txt and llms-full.txt
  docs path                               Print where the built docs are (llms.txt, llms-full.txt, pages, reference.md)
  upstream                                Compare the pinned Strudel with its latest release and main
  mcp                                     Serve check, events, diff, form, lookup, render and docs_path as MCP tools (stdio)

Code is read from a file, or from stdin when the file is "-" or omitted. It is JavaScript,
which can use mondo\`...\` and tidal\`...\` inline; --mondo (or a .mondo file) reads it as
Mondo notation throughout.
Sections are lengths in cycles, in order, as arrange() takes them: "intro=4,A=16,B=12,outro=8"
(or "4,16,12,8"); given alone, they also set how many cycles to render or list.
--from/--to render cycles A to B only, e.g. one section as a draft.
Exit codes: 0 success; 1 errors found (check), a difference (diff), an event that failed to
play (render) or failure; 2 bad usage.`;

class UsageError extends Error {}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const readCode = async (file?: string) => (file && file !== '-' ? readFile(file, 'utf8') : readStdin());

function cyclesOf(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const cycles = Number(value);
  if (!(cycles > 0)) throw new UsageError(`--cycles must be a positive number, got "${value}"`);
  return cycles;
}

async function optionalReference(): Promise<ReferenceIndex | undefined> {
  try {
    return new ReferenceIndex(await loadReference());
  } catch (error) {
    if (error instanceof MissingReferenceError) return undefined;
    throw error;
  }
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cycles: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      sections: { type: 'string' },
      layers: { type: 'boolean', default: false },
      cps: { type: 'string' },
      out: { type: 'string' },
      tail: { type: 'string' },
      'sample-rate': { type: 'string' },
      json: { type: 'boolean', default: false },
      tag: { type: 'string' },
      tags: { type: 'boolean', default: false },
      mondo: { type: 'boolean', default: false },
      module: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...args] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const print = (value: unknown, text: () => string) => console.log(values.json ? JSON.stringify(value, null, 2) : text());
  // Mondo notation throughout: --mondo, or a file ending in .mondo.
  const language = (file?: string): Language => (values.mondo ? 'mondo' : languageOf(file));
  const sections = (() => {
    if (values.sections === undefined) return undefined;
    try {
      return parseSections(values.sections);
    } catch (error) {
      throw new UsageError(`--sections: ${(error as Error).message}`);
    }
  })();
  const windowOf = (fallback: number) => {
    const number = (v?: string) => (v === undefined ? undefined : Number(v));
    try {
      return cycleWindow({ from: number(values.from), to: number(values.to), cycles: number(values.cycles) }, fallback, sections);
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
  };

  switch (command) {
    case 'events': {
      const { from, cycles } = windowOf(1);
      const { events, messages } = await runPattern(await readCode(args[0]), cycles, language(args[0]), from);
      for (const message of messages) console.error(`strudel: ${message}`);
      print(events, () => events.map((e) => e.show).join('\n'));
      return 0;
    }
    case 'check': {
      const file = args[0] && args[0] !== '-' ? args[0] : '<stdin>';
      const result = await checkCode(await readCode(args[0]), {
        reference: await optionalReference(),
        cycles: cyclesOf(values.cycles, 4),
        language: language(args[0]),
      });
      print(result, () => formatCheck(result, file));
      return result.ok ? 0 : 1;
    }
    case 'diff': {
      if (args.length !== 2) throw new UsageError('diff needs two files: <before> <after> ("-" for stdin)');
      if (args[0] === '-' && args[1] === '-') throw new UsageError('only one of the two files can be stdin');
      const cycles = cyclesOf(values.cycles, 1);
      const diff = await diffCode(await readCode(args[0]), await readCode(args[1]), cycles, language(args[0]));
      print(diff, () => formatDiff(diff, cycles));
      return diff.same ? 0 : 1;
    }
    case 'lookup': {
      const index = new ReferenceIndex(await loadReference());
      if (values.tags) {
        const counts = new Map<string, number>();
        for (const f of index.reference.functions) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        print(Object.fromEntries(sorted), () => sorted.map(([t, n]) => `${t} (${n})`).join('\n') || 'No tags in this reference.');
        return 0;
      }
      if (values.tag || values.module) {
        const entries = values.tag ? index.withTag(values.tag) : index.inModule(values.module!);
        print(entries, () =>
          entries.length
            ? entries.map((e) => `${e.name}${e.synonyms.length ? ` (${e.synonyms.join(', ')})` : ''}`).join('\n')
            : `No functions with ${values.tag ? `tag "${values.tag}"` : `module "${values.module}"`}.`,
        );
        return 0;
      }
      const name = args[0];
      if (!name) throw new UsageError('lookup needs a function name, --tag or --module');
      const entry = index.find(name);
      if (!entry) {
        const suggestions = index.suggest(name);
        const hint = suggestions.length ? ` Did you mean ${suggestions.map((s) => `\`${s}\``).join(', ')}?` : '';
        console.error(`No Strudel function \`${name}\` in the reference.${hint}`);
        return 1;
      }
      print(entry, () => formatEntry(entry, name));
      return 0;
    }
    case 'render': {
      const tail = values.tail === undefined ? 0 : Number(values.tail);
      if (!(tail >= 0)) throw new UsageError(`--tail must be zero or more seconds, got "${values.tail}"`);
      const sampleRate = values['sample-rate'] === undefined ? 48000 : Number(values['sample-rate']);
      if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
        throw new UsageError(`--sample-rate must be a whole number of Hz from 8000 to 192000, got "${values['sample-rate']}"`);
      }
      const options = { ...windowOf(4), tail, sampleRate, language: language(args[0]) };
      const code = await readCode(args[0]);
      const { mix, layers } = values.layers ? await renderLayers(code, options, sections) : { mix: await renderCode(code, options), layers: undefined };
      const file = values.out ?? 'render.wav';
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, encodeWav(mix.channels, mix.sampleRate));
      const report = reportRender(mix, relative(process.cwd(), file) || file, sections);
      print(layers ? { ...report, layers } : report, () => (layers ? `${formatReport(report)}\n${formatLayers(layers, report)}` : formatReport(report)));
      return report.errors.length ? 1 : 0;
    }
    case 'analyse': {
      if (!args[0]) throw new UsageError('analyse needs a WAV file');
      const cps = values.cps === undefined ? undefined : Number(values.cps);
      if (sections && !(cps! > 0)) throw new UsageError('--sections needs --cps, the tempo in cycles per second, to find the sections in the audio');
      const { channels, sampleRate } = decodeWav(await readFile(args[0]));
      const stats = analyse(channels, sampleRate);
      const onsets = detectOnsets(channels, sampleRate);
      const bySection = sections ? sectionStats(channels, sampleRate, cps!, 0, sections) : undefined;
      print({ stats, onsets, ...(bySection ? { sections: bySection } : {}) }, () =>
        [formatStats(stats, cps === undefined ? undefined : stats.peakAt * cps), `Onsets: ${onsets.length} detected`, ...(bySection ? [formatSections(bySection)] : [])].join('\n'),
      );
      return 0;
    }
    case 'form': {
      const form = await formOf(await readCode(args[0]), windowOf(8).cycles, language(args[0]), sections);
      print(form, () => formatForm(form));
      return 0;
    }
    case 'mcp': {
      await (await import('./mcp.ts')).serveMcp();
      return new Promise<number>(() => {}); // serves until stdin closes
    }
    case 'upstream': {
      const status = await upstreamStatus(await readPin());
      print(status, () => formatUpstream(status));
      return 0;
    }
    case 'docs': {
      if (args[0] === 'path') {
        // Where the generated docs are, so an agent working elsewhere can read them.
        const paths = {
          llms: join(OUT_DIR, 'llms.txt'),
          llmsFull: join(OUT_DIR, 'llms-full.txt'),
          pages: join(OUT_DIR, 'docs'),
          reference: join(OUT_DIR, 'docs', 'reference.md'),
        };
        if (!existsSync(paths.llms)) throw new Error('The docs are not built yet. Build them with: kynska docs build');
        print(paths, () => Object.values(paths).join('\n'));
        return 0;
      }
      if (args[0] !== 'build') throw new UsageError('usage: kynska docs build | kynska docs path');
      const result = await buildDocs();
      console.error(formatDocsResult(result));
      return 0;
    }
    case 'reference': {
      if (args[0] !== 'build') throw new UsageError('usage: kynska reference build');
      const reference = await buildReference();
      const withExamples = reference.functions.filter((f) => f.examples.length).length;
      console.error(
        `Built ${relative(process.cwd(), `${ROOT}out/reference.json`) || 'out/reference.json'}: ` +
          `${reference.functions.length} functions (${withExamples} with examples) from Strudel ${reference.strudel.version} ` +
          `(${reference.strudel.commit.slice(0, 7)}).`,
      );
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`kynska: ${error.message}\n\n${USAGE}`);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
