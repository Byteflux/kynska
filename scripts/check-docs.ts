// Runs `kynska check` on every js and mondo code block in the generated docs pages
// (out/docs, after `kynska docs build`). The blocks are Strudel's own examples,
// so errors point at the docs conversion or at false positives in check.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { OUT_DIR } from '../src/paths.ts';
import { checkCode } from '../src/patterns/check.ts';
import { loadReference, ReferenceIndex } from '../src/reference/lookup.ts';

async function markdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith('.md') && entry.name !== 'reference.md') files.push(path);
  }
  return files.sort();
}

/**
 * Code blocks in Strudel's docs that are not meant to run. Matched by page and
 * the block's start, so a new failure elsewhere on the page still counts.
 */
const EXPECTED: { page: string; starts?: string; reason: string }[] = [
  { page: 'learn/code.md', starts: 'note(c a f e)', reason: 'shows broken syntax on purpose' },
  { page: 'learn/code.md', starts: 'note("c a f e")s(', reason: 'shows broken syntax on purpose' },
  { page: 'learn/code.md', starts: 'note["c a f e"]', reason: 'shows broken syntax on purpose' },
  { page: 'learn/metadata.md', starts: '/*\nsong @by', reason: 'uses "..." as a placeholder' },
  { page: 'technical-manual/sounds.md', starts: 'function registerSound(', reason: 'a TypeScript-style signature, not code' },
  {
    page: 'technical-manual/alignment.md',
    reason: "prose examples written with single-quoted strings, which are plain strings rather than patterns (they fail on strudel.cc too)",
  },
];
const expected = (page: string, block: string) =>
  EXPECTED.find((e) => e.page === page && (!e.starts || block.trimStart().startsWith(e.starts)));

const reference = new ReferenceIndex(await loadReference());
const docs = join(OUT_DIR, 'docs');
const warnings: Record<string, number> = {};
const failures: string[] = [];
const known: Record<string, number> = {};
let total = 0;
// Pages about the docs site itself show MDX and component source, not Strudel code.
const skip = new Set(['technical-manual/docs.md', 'technical-manual/project-start.md', 'technical-manual/repl.md']);
for (const file of await markdownFiles(docs)) {
  const page = relative(docs, file);
  if (skip.has(page)) continue;
  const text = await readFile(file, 'utf8');
  for (const [, lang, block] of text.matchAll(/^```(js|mondo)\n([\s\S]*?)^```$/gm)) {
    total++;
    const result = await checkCode(block, { reference, cycles: 2, language: lang === 'mondo' ? 'mondo' : 'js' });
    const exception = expected(page, block);
    for (const d of result.diagnostics) {
      if (d.severity === 'warning') warnings[d.code] = (warnings[d.code] ?? 0) + 1;
      else if (exception) known[`${page}: ${exception.reason}`] = (known[`${page}: ${exception.reason}`] ?? 0) + 1;
      else failures.push(`${page}: [${d.code}] ${d.message}${d.suggestions ? ` (did you mean ${d.suggestions.join(', ')}?)` : ''}\n    ${block.trim().split('\n')[0].slice(0, 100)}`);
    }
  }
}
const knownCount = Object.values(known).reduce((s, n) => s + n, 0);
console.log(`${total} code blocks, ${failures.length} errors (${knownCount} more in blocks not meant to run)`);
console.log(`warnings: ${Object.entries(warnings).map(([code, n]) => `${code} ${n}`).join(', ') || 'none'}`);
for (const [what, n] of Object.entries(known)) console.log(`  known: ${what} (${n})`);
for (const failure of failures) console.log(`  ${failure}`);
process.exit(failures.length ? 1 : 0);
