#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { queryEvents } from './patterns/events.ts';

const USAGE = `Usage: kynska events [file] [--cycles N] [--json]

Evaluates Strudel code from a file (or stdin) without audio and lists the
events it produces over the first N cycles (default 1).`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cycles: { type: 'string', default: '1' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, file] = positionals;
  if (values.help || command !== 'events') {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const cycles = Number(values.cycles);
  const code = file && file !== '-' ? await readFile(file, 'utf8') : await readStdin();
  const events = await queryEvents(code, cycles);
  if (values.json) {
    console.log(JSON.stringify(events, null, 2));
  } else {
    for (const event of events) console.log(event.show);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
