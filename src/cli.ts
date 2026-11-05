#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { analyse, detectOnsets } from './audio/analyse.ts';
import { renderCode } from './audio/render.ts';
import { formatReport, formatStats, reportRender } from './audio/report.ts';
import { decodeWav, encodeWav } from './audio/wav.ts';
import { buildDocs, formatDocsResult } from './docs/build.ts';
import { OUT_DIR, ROOT } from './paths.ts';
import { checkCode, type Diagnostic } from './patterns/check.ts';
import { diffCode, formatDiff } from './patterns/diff.ts';
import { runPattern } from './patterns/events.ts';
import { buildReference } from './reference/build.ts';
import { formatEntry, loadReference, MissingReferenceError, ReferenceIndex } from './reference/lookup.ts';

const USAGE = `Usage: kynska <command> [options]

Commands:
  events [file] [--cycles N] [--json]     List the events a pattern produces (default 1 cycle)
  check [file] [--cycles N] [--json]      Check code: syntax, unknown or undocumented functions,
                                          evaluation errors, silence (default 4 cycles)
  diff <before> <after> [--cycles N] [--json]
                                          Compare the events of two versions (default 1 cycle)
  lookup <name> [--json]                  Show a function from the Strudel reference
  lookup --tag <tag> | --module <module>  List functions by tag or module
  render [file] [--cycles N] [--out file.wav] [--tail S] [--sample-rate R] [--json]
                                          Render to a WAV file (default 4 cycles, out/render.wav)
                                          and measure it: level, loudness, clipping, silence, onsets
  analyse <file.wav> [--json]             Measure any WAV file the same way (onsets: detected count)
  reference build                         Fetch the pinned Strudel source and build out/reference.json
  docs build                              Build out/reference.json, the docs pages, llms.txt and llms-full.txt

Code is read from a file, or from stdin when the file is "-" or omitted.
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

function formatDiagnostic(d: Diagnostic, file: string): string {
  const where = d.line ? `${file}:${d.line}:${d.column ?? 1}` : file;
  const hint = d.suggestions?.length ? ` Did you mean ${d.suggestions.map((s) => `\`${s}\``).join(', ')}?` : '';
  return `${where}: ${d.severity} [${d.code}] ${d.message}${hint}`;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cycles: { type: 'string' },
      out: { type: 'string' },
      tail: { type: 'string' },
      'sample-rate': { type: 'string' },
      json: { type: 'boolean', default: false },
      tag: { type: 'string' },
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

  switch (command) {
    case 'events': {
      const { events, messages } = await runPattern(await readCode(args[0]), cyclesOf(values.cycles, 1));
      for (const message of messages) console.error(`strudel: ${message}`);
      print(events, () => events.map((e) => e.show).join('\n'));
      return 0;
    }
    case 'check': {
      const file = args[0] && args[0] !== '-' ? args[0] : '<stdin>';
      const result = await checkCode(await readCode(args[0]), {
        reference: await optionalReference(),
        cycles: cyclesOf(values.cycles, 4),
      });
      print(result, () => {
        const lines = result.diagnostics.map((d) => formatDiagnostic(d, file));
        const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
        const warnings = result.diagnostics.length - errors;
        const counts = `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
        const facts = result.events !== undefined ? `; ${result.events} events, ${result.cps} cycles per second` : '';
        lines.push(`${result.ok ? 'OK' : 'FAILED'}: ${counts}${facts}`);
        return lines.join('\n');
      });
      return result.ok ? 0 : 1;
    }
    case 'diff': {
      if (args.length !== 2) throw new UsageError('diff needs two files: <before> <after> ("-" for stdin)');
      if (args[0] === '-' && args[1] === '-') throw new UsageError('only one of the two files can be stdin');
      const cycles = cyclesOf(values.cycles, 1);
      const diff = await diffCode(await readCode(args[0]), await readCode(args[1]), cycles);
      print(diff, () => formatDiff(diff, cycles));
      return diff.same ? 0 : 1;
    }
    case 'lookup': {
      const index = new ReferenceIndex(await loadReference());
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
      const rendered = await renderCode(await readCode(args[0]), { cycles: cyclesOf(values.cycles, 4), tail, sampleRate });
      const file = values.out ?? join(OUT_DIR, 'render.wav');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, encodeWav(rendered.channels, rendered.sampleRate));
      const report = reportRender(rendered, relative(process.cwd(), file) || file);
      print(report, () => formatReport(report));
      return report.errors.length ? 1 : 0;
    }
    case 'analyse': {
      if (!args[0]) throw new UsageError('analyse needs a WAV file');
      const { channels, sampleRate } = decodeWav(await readFile(args[0]));
      const stats = analyse(channels, sampleRate);
      const onsets = detectOnsets(channels, sampleRate);
      print({ stats, onsets }, () => `${formatStats(stats)}\nOnsets: ${onsets.length} detected`);
      return 0;
    }
    case 'docs': {
      if (args[0] !== 'build') throw new UsageError('usage: kynska docs build');
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
