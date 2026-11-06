// Turns JSDoc doclets (jsdoc -X) from Strudel's source into Kynska's reference.
import { relative, sep } from 'node:path';
import type { Reference, ReferenceEntry } from './types.ts';
import type { StrudelPin } from './pin.ts';

/** The doclet fields this module reads. */
export type Doclet = {
  name?: string;
  longname?: string;
  kind?: string;
  scope?: string;
  memberof?: string;
  alias?: string;
  undocumented?: boolean;
  description?: string;
  params?: { name?: string; type?: { names?: string[] }; description?: string; optional?: boolean; defaultvalue?: unknown }[];
  returns?: { type?: { names?: string[] }; description?: string }[];
  examples?: string[];
  kynskaSynonyms?: string[];
  kynskaTags?: string[];
  meta?: { filename?: string; path?: string; lineno?: number };
};

export type TransformOptions = {
  pin: StrudelPin;
  /** The checkout the doclets were read from; source paths are made relative to it. */
  sourceRoot: string;
  /** Whether a name is callable as a global function in the running engine. */
  isGlobal: (name: string) => boolean;
  /** Whether a name is a Pattern method in the running engine. */
  isMethod: (name: string) => boolean;
};

const KINDS = new Set(['function', 'member', 'constant']);
// Members of these are part of the user-facing language; members of anything
// else (DoughVoice, OLAProcessor, ...) are audio-engine internals.
const PUBLIC_PARENTS = new Set(['Pattern', 'repl']);

function isPublic(d: Doclet): boolean {
  if (d.undocumented || !d.name || !d.kind || !KINDS.has(d.kind)) return false;
  if (d.name.startsWith('_')) return false;
  if (d.memberof && !PUBLIC_PARENTS.has(d.memberof)) return false;
  // As in strudel.cc's own reference panel: an entry needs a description.
  return Boolean(d.description?.trim());
}

/** `{@link Pattern#scale}` and `{@link scale}` become `scale` in code style. */
function rewriteLinks(text: string): string {
  return text.replace(/\{@link\s+([^}\s|]+)(?:[\s|]+([^}]+))?\}/g, (_, target: string, label?: string) => {
    const name = target.split(/[#.]/).pop() || target;
    return `\`${(label ?? name).trim()}\``;
  });
}

function sourceOf(d: Doclet, opts: TransformOptions): ReferenceEntry['source'] & { module: string } {
  const absolute = `${d.meta?.path ?? ''}${sep}${d.meta?.filename ?? ''}`;
  const path = relative(opts.sourceRoot, absolute).split(sep).join('/');
  const line = d.meta?.lineno ?? 0;
  const web = opts.pin.repository.replace(/\.git$/, '');
  const module = path.replace(/^packages\//, '').replace(/\.[^./]+$/, '');
  return { path, line, url: `${web}/src/commit/${opts.pin.commit}/${path}#L${line}`, module };
}

function toEntry(d: Doclet, opts: TransformOptions): ReferenceEntry {
  const name = d.name!;
  const { module, ...source } = sourceOf(d, opts);
  const synonyms = [...(d.kynskaSynonyms ?? []), ...(d.alias && d.alias !== name ? [d.alias] : [])];
  const returns = d.returns?.map((r) => r.description || r.type?.names?.join(' | ')).filter(Boolean).join('; ');
  return {
    name,
    longname: d.longname ?? name,
    synonyms: [...new Set(synonyms)].filter((s) => s !== name),
    tags: [...new Set(d.kynskaTags ?? [])],
    module,
    description: rewriteLinks(d.description!.trim()),
    params: (d.params ?? []).map((p) => ({
      name: p.name ?? '',
      types: p.type?.names ?? [],
      description: rewriteLinks(p.description?.trim() ?? ''),
      optional: Boolean(p.optional),
      ...(p.defaultvalue !== undefined ? { default: String(p.defaultvalue) } : {}),
    })),
    ...(returns ? { returns } : {}),
    examples: (d.examples ?? []).map((e) => e.trim()).filter(Boolean),
    callable: { global: opts.isGlobal(name), method: opts.isMethod(name) },
    source,
  };
}

export function toReference(doclets: Doclet[], opts: TransformOptions): Reference {
  const ordered = doclets
    .filter(isPublic)
    .map((d) => ({ d, key: `${d.meta?.path ?? ''}/${d.meta?.filename ?? ''}`, line: d.meta?.lineno ?? 0 }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.line - b.line);
  // A name documented twice keeps its first definition, in source order.
  const byName = new Map<string, ReferenceEntry>();
  for (const { d } of ordered) if (!byName.has(d.name!)) byName.set(d.name!, toEntry(d, opts));
  return {
    schema: 1,
    strudel: { branch: opts.pin.branch, commit: opts.pin.commit, date: opts.pin.date, repository: opts.pin.repository },
    functions: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
