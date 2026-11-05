// Finds and formats entries in out/reference.json.
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { REFERENCE_FILE, ROOT } from '../paths.ts';
import { suggest } from '../text/suggest.ts';
import type { Reference, ReferenceEntry } from './types.ts';

export class MissingReferenceError extends Error {}

export async function loadReference(file = REFERENCE_FILE): Promise<Reference> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new MissingReferenceError(
      `No Strudel reference at ${relative(ROOT, file) || file}. Build it with: kynska reference build`,
    );
  }
  const reference = JSON.parse(text) as Reference;
  if (reference.schema !== 1) throw new Error(`${file}: unsupported schema ${reference.schema}; rebuild it`);
  return reference;
}

/** Name and synonym lookups over a reference. */
export class ReferenceIndex {
  readonly reference: Reference;
  private readonly byName = new Map<string, ReferenceEntry>();
  private readonly byLower = new Map<string, ReferenceEntry>();
  private readonly byLongname = new Map<string, ReferenceEntry>();

  constructor(reference: Reference) {
    this.reference = reference;
    // Primary names win over synonyms, so index them first.
    for (const entry of reference.functions) this.add(entry.name, entry);
    for (const entry of reference.functions) for (const s of entry.synonyms) this.add(s, entry);
    for (const entry of reference.functions) if (entry.longname) this.byLongname.set(entry.longname, entry);
  }

  private add(name: string, entry: ReferenceEntry) {
    if (!this.byName.has(name)) this.byName.set(name, entry);
    if (!this.byLower.has(name.toLowerCase())) this.byLower.set(name.toLowerCase(), entry);
  }

  /** Every name and synonym. */
  get names(): string[] {
    return [...this.byName.keys()];
  }

  /** Exact match on a name or synonym. */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Exact match on a name, synonym or JSDoc full name ("Pattern.slow"), then a case-insensitive one. */
  find(name: string): ReferenceEntry | undefined {
    return this.byName.get(name) ?? this.byLongname.get(name) ?? this.byLower.get(name.toLowerCase());
  }

  suggest(name: string, extra: Iterable<string> = [], limit = 3): string[] {
    return suggest(name, [...this.byName.keys(), ...extra], limit);
  }

  /** The package a browser-only name comes from, if strudel.cc defines it in one. */
  browserOnlyPackage(name: string): string | undefined {
    return Object.hasOwn(this.reference.browserOnly ?? {}, name) ? this.reference.browserOnly![name] : undefined;
  }

  withTag(tag: string): ReferenceEntry[] {
    return this.reference.functions.filter((e) => e.tags.includes(tag));
  }

  inModule(module: string): ReferenceEntry[] {
    return this.reference.functions.filter((e) => e.module === module || e.module.endsWith(`/${module}`));
  }
}

function signature(entry: ReferenceEntry): string {
  const args = entry.params
    .filter((p) => !p.name.includes('.'))
    .map((p) => (p.optional ? `${p.name}?` : p.name))
    .join(', ');
  const forms: string[] = [];
  if (entry.callable.method) forms.push(`pattern.${entry.name}(${args})`);
  if (entry.callable.global) forms.push(`${entry.name}(${args})`);
  return forms.length ? forms.join('  or  ') : `${entry.name}(${args})`;
}

/** Markdown for one entry, as an agent would want to read it. */
export function formatEntry(entry: ReferenceEntry, asked?: string): string {
  const lines = [`## ${entry.name}`, ''];
  if (asked && asked !== entry.name) {
    // Which name the question matched, ignoring case: the entry's own or a synonym.
    const matched = [entry.name, ...entry.synonyms].find((n) => n.toLowerCase() === asked.toLowerCase()) ?? entry.name;
    const notes: string[] = [];
    if (matched !== entry.name) notes.push(`\`${matched}\` is another name for \`${entry.name}\`.`);
    if (matched !== asked) notes.push(`Names are case-sensitive: write \`${matched}\`, not \`${asked}\`.`);
    lines.push(`(${notes.join(' ')})`, '');
  }
  lines.push('```js', signature(entry), '```', '');
  if (!entry.callable.global && !entry.callable.method) {
    lines.push(`Only available in the browser (strudel.cc): Kynska's headless tools stand it in with a no-op.`, '');
  }
  if (entry.synonyms.length) lines.push(`Also called: ${entry.synonyms.map((s) => `\`${s}\``).join(', ')}`);
  if (entry.tags.length) lines.push(`Tags: ${entry.tags.join(', ')}`);
  lines.push(`Module: ${entry.module}`, '', entry.description, '');
  if (entry.params.length) {
    lines.push('Parameters:');
    for (const p of entry.params) {
      const types = p.types.length ? ` (${p.types.join(' | ')})` : '';
      const extra = [p.optional ? 'optional' : '', p.default !== undefined ? `default ${p.default}` : ''].filter(Boolean);
      const desc = p.description ? `: ${p.description}` : '';
      lines.push(`- \`${p.name}\`${types}${extra.length ? ` [${extra.join(', ')}]` : ''}${desc}`);
    }
    lines.push('');
  }
  if (entry.returns) lines.push(`Returns: ${entry.returns}`, '');
  if (entry.examples.length) {
    lines.push(entry.examples.length === 1 ? 'Example:' : 'Examples:');
    for (const example of entry.examples) lines.push('```js', example, '```');
    lines.push('');
  }
  lines.push(`Source: ${entry.source.url}`);
  return lines.join('\n');
}
