// Checks Strudel code before anyone plays it: syntax, functions that do not exist
// (with suggestions), functions missing from the reference, browser-only
// functions, evaluation and query errors, Strudel's own warnings, and silence.
import { parse, type Node } from 'acorn';
import { full, simple } from 'acorn-walk';
import type { ReferenceIndex } from '../reference/lookup.ts';
import { suggest } from '../text/suggest.ts';
import { evaluateCode, type Language } from './evaluate.ts';
import { eventsOf, type PatternEvent } from './events.ts';
import {
  captureConsole,
  engineMessages,
  ensureScope,
  isBrowserOnlyStub,
  outputMethods,
  stubBrowserOnly,
} from './scope.ts';

export type Diagnostic = {
  severity: 'error' | 'warning';
  code:
    | 'syntax'
    | 'unknown-function'
    | 'unknown-method'
    | 'undocumented'
    | 'browser-only'
    | 'evaluation'
    | 'query'
    | 'engine-warning'
    | 'silent'
    | 'ignored-control'
    | 'no-reference';
  message: string;
  line?: number;
  column?: number;
  suggestions?: string[];
};

export type CheckResult = {
  /** True when there are no errors (warnings allowed). */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Events in the checked cycles, when the code got that far. */
  events?: number;
  /** Tempo in cycles per second, when the code evaluated. */
  cps?: number;
};

export type CheckOptions = {
  /** Without it, names are checked against the running engine only. */
  reference?: ReferenceIndex;
  /** Cycles to query for runtime errors and silence. Default 4. */
  cycles?: number;
  /** 'mondo' for code written entirely in Mondo notation. Default 'js'. */
  language?: Language;
};

type AnyNode = Node & Record<string, any>;

/** One diagnostic as a line: "file:line:column: severity [code] message. Did you mean ...?" */
export function formatDiagnostic(d: Diagnostic, file = '<stdin>'): string {
  const where = d.line ? `${file}:${d.line}:${d.column ?? 1}` : file;
  const hint = d.suggestions?.length ? ` Did you mean ${d.suggestions.map((s) => `\`${s}\``).join(', ')}?` : '';
  return `${where}: ${d.severity} [${d.code}] ${d.message}${hint}`;
}

/** A check result as `kynska check` prints it: the diagnostics, then a verdict line. */
export function formatCheck(result: CheckResult, file = '<stdin>'): string {
  const lines = result.diagnostics.map((d) => formatDiagnostic(d, file));
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  const counts = `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
  const facts = result.events !== undefined ? `; ${result.events} events, ${result.cps} cycles per second` : '';
  lines.push(`${result.ok ? 'OK' : 'FAILED'}: ${counts}${facts}`);
  return lines.join('\n');
}

function patternNames(node: AnyNode | null | undefined, into: Set<string>) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      into.add(node.name);
      break;
    case 'ObjectPattern':
      for (const p of node.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, into);
      break;
    case 'ArrayPattern':
      for (const e of node.elements) patternNames(e, into);
      break;
    case 'RestElement':
      patternNames(node.argument, into);
      break;
    case 'AssignmentPattern':
      patternNames(node.left, into);
      break;
  }
}

/**
 * Every name the code itself defines, anywhere: variables, functions, parameters,
 * and functions it registers with register('name', ...). Calls to these are not checked.
 */
function declaredNames(ast: Node): Set<string> {
  const names = new Set<string>();
  full(ast, (n) => {
    const node = n as AnyNode;
    switch (node.type) {
      case 'VariableDeclarator':
        patternNames(node.id, names);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) names.add(node.id.name);
        for (const p of node.params) patternNames(p, names);
        break;
      case 'ClassDeclaration':
        if (node.id) names.add(node.id.name);
        break;
      case 'CatchClause':
        patternNames(node.param, names);
        break;
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        names.add(node.local.name);
        break;
      case 'CallExpression': {
        const [first] = node.arguments;
        if (node.callee.type === 'Identifier' && node.callee.name === 'register' && first?.type === 'Literal' && typeof first.value === 'string') {
          names.add(first.value);
        }
        break;
      }
      case 'AssignmentExpression': {
        // Pattern.prototype.micro = function (...) { ... }
        const left = node.left;
        const object = left.type === 'MemberExpression' ? left.object : undefined;
        if (object?.type === 'MemberExpression' && object.object?.name === 'Pattern' && object.property?.name === 'prototype') {
          const name = left.computed ? left.property.value : left.property.name;
          if (typeof name === 'string') names.add(name);
        }
        break;
      }
    }
  });
  return names;
}

/**
 * Whether an expression is certainly a Strudel pattern: a double-quoted or
 * template string (the transpiler turns those into mini-notation), or a chain of
 * calls that starts at a Strudel global such as note(...) or s(...).
 */
function isPatternExpression(node: AnyNode, declared: Set<string>, globals: ReadonlySet<string>): boolean {
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' && typeof node.raw === 'string' && node.raw.startsWith('"');
    case 'TemplateLiteral':
      return true;
    case 'CallExpression':
      if (node.callee.type === 'Identifier') return !declared.has(node.callee.name) && globals.has(node.callee.name);
      return isPatternExpression(node.callee, declared, globals);
    case 'MemberExpression':
      return isPatternExpression(node.object, declared, globals);
    default:
      return false;
  }
}

/**
 * Synths whose pitch comes only from `note` or `freq`: superdough ignores `n` on
 * them (supersaw reads it as detune), so `n("28").s("triangle")` plays the default
 * C2, not E1. On samples and soundfonts `n` picks a sample, which is fine.
 */
const PITCH_FROM_NOTE = new Set(['sine', 'sin', 'triangle', 'tri', 'square', 'sqr', 'sawtooth', 'saw', 'pulse', 'supersaw']);

/** A warning per synth whose events have `n` but no `note` or `freq`. */
function ignoredN(events: PatternEvent[]): Diagnostic[] {
  const synths = new Set<string>();
  for (const { value } of events) {
    const v = value as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || v.n === undefined || v.note !== undefined || v.freq !== undefined) continue;
    // With no sound named, superdough plays a triangle.
    const s = v.s ?? 'triangle';
    if (typeof s === 'string' && PITCH_FROM_NOTE.has(s)) synths.add(s);
  }
  return [...synths].map((s) => ({
    severity: 'warning',
    code: 'ignored-control',
    message: `\`n\` does not set the pitch of the synth "${s}", which reads only \`note\` or \`freq\`, so those notes all play at the default C2. Use note(...), or n(...).scale(...) for scale degrees.`,
  }));
}

function at(node: AnyNode): Pick<Diagnostic, 'line' | 'column'> {
  return node.loc ? { line: node.loc.start.line, column: node.loc.start.column + 1 } : {};
}

export async function checkCode(code: string, options: CheckOptions = {}): Promise<CheckResult> {
  const { reference, cycles = 4, language = 'js' } = options;
  const diagnostics: Diagnostic[] = [];
  const done = (extra: Partial<CheckResult> = {}): CheckResult => ({
    ok: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    ...extra,
  });

  if (!reference) {
    diagnostics.push({
      severity: 'warning',
      code: 'no-reference',
      message: 'No Strudel reference loaded, so undocumented functions are not reported. Build it with: kynska reference build',
    });
  }

  // Steps 3 and 4, after the static checks (or alone, for Mondo notation).
  const runtime = async (browserOnly: ReadonlyMap<string, unknown>): Promise<CheckResult> => {
    // 3. Evaluate the way the REPL does.
    const evaluation = await evaluateCode(code, language);
    if (evaluation.error) {
      if (browserOnly.size) {
        // A stand-in cannot behave like the real thing (midikeys() returns a
        // function in the browser), so the failure is most likely ours, not the code's.
        const names = [...browserOnly.keys()].map((n) => `\`${n}\``).join(', ');
        diagnostics.push({
          severity: 'warning',
          code: 'browser-only',
          message: `Could not evaluate headlessly, most likely because of browser-only ${names}: ${evaluation.error.message}. The rest of the code was checked for names only.`,
        });
      } else {
        diagnostics.push({ severity: 'error', code: 'evaluation', message: evaluation.error.message });
      }
      return done({ cps: evaluation.cps });
    }
    // 4. Query: some errors only appear when events are computed.
    let listed: PatternEvent[];
    try {
      listed = await captureConsole(evaluation.logs, async () => eventsOf(evaluation.pattern, cycles));
    } catch (error) {
      diagnostics.push({ severity: 'error', code: 'query', message: (error as Error).message });
      return done({ cps: evaluation.cps });
    }
    // Strudel warns about some mistakes instead of failing, e.g. arithmetic on a
    // control pattern, which leaves it unchanged.
    for (const message of engineMessages(evaluation.logs)) {
      diagnostics.push({ severity: 'warning', code: 'engine-warning', message: message.replace(/^\[warn\]:?\s*/, '') });
    }
    diagnostics.push(...ignoredN(listed));
    const events = listed.length;
    // Stand-ins are silent, so silence says nothing when they are in use.
    if (events === 0 && !browserOnly.size) {
      diagnostics.push({
        severity: 'warning',
        code: 'silent',
        message: `The pattern produces no events in the first ${cycles} cycle${cycles === 1 ? '' : 's'}.`,
      });
    }
    return done({ events, cps: evaluation.cps });
  };

  // Mondo notation is not JavaScript: no syntax or name checks, just run it.
  if (language === 'mondo') return runtime(new Map());

  // 1. Syntax.
  let ast: Node;
  try {
    ast = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch (error) {
    const e = error as SyntaxError & { loc?: { line: number; column: number } };
    diagnostics.push({
      severity: 'error',
      code: 'syntax',
      message: e.message.replace(/\s*\(\d+:\d+\)$/, ''),
      ...(e.loc ? { line: e.loc.line, column: e.loc.column + 1 } : {}),
    });
    return done();
  }

  // 2. Names: every free function and every method called on a pattern must exist.
  const { strudelGlobals, patternMethods } = await ensureScope();
  const declared = declaredNames(ast);
  const isFree = (name: string) => !declared.has(name);
  // Documented in Strudel but only available in the browser (MIDI, motion, CSound,
  // Kabelsalat, some visuals): fine for strudel.cc, stood in for here.
  const isBrowserOnly = (name: string) =>
    isBrowserOnlyStub(name) ||
    ((Boolean(reference?.has(name)) || Boolean(reference?.browserOnlyPackage(name))) && !(name in globalThis) && !patternMethods.has(name));

  const calls: AnyNode[] = [];
  const identifiers: AnyNode[] = [];
  simple(ast, {
    CallExpression: (n) => void calls.push(n as AnyNode),
    Identifier: (n) => void identifiers.push(n as AnyNode),
  });

  const calleeName = (call: AnyNode): { name: string; node: AnyNode; method: boolean } | undefined => {
    const callee = call.callee as AnyNode;
    if (callee.type === 'Identifier') return { name: callee.name, node: callee, method: false };
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
      if (!isPatternExpression(callee.object, declared, strudelGlobals)) return undefined;
      return { name: callee.property.name, node: callee.property, method: true };
    }
    return undefined;
  };

  // The arguments of a browser-only call can be another engine's code (K(...)
  // takes Kabelsalat), so they are not checked as Strudel.
  const skipped: [number, number][] = [];
  for (const call of calls) {
    const target = calleeName(call);
    if (target && (target.method || isFree(target.name)) && isBrowserOnly(target.name) && call.arguments.length) {
      skipped.push([call.arguments[0].start, call.arguments[call.arguments.length - 1].end]);
    }
  }
  const inSkipped = (node: AnyNode) => skipped.some(([start, end]) => node.start >= start && node.end <= end);

  const warned = new Set<string>();
  const warnOnce = (name: string, node: AnyNode, code: 'undocumented' | 'browser-only', message: string) => {
    if (warned.has(name)) return;
    warned.add(name);
    diagnostics.push({ severity: 'warning', code, message, ...at(node) });
  };
  const browserOnly = new Map<string, 'function' | 'value'>();
  const noteBrowserOnly = (name: string, node: AnyNode, as: 'function' | 'value') => {
    if (browserOnly.get(name) !== 'function') browserOnly.set(name, as);
    const pkg = reference?.browserOnlyPackage(name);
    warnOnce(
      name,
      node,
      'browser-only',
      `\`${name}\`${pkg ? ` (${pkg})` : ''} only works in the browser (strudel.cc); it is stood in for here, so its effect is not checked.`,
    );
  };
  // Hydra code mixes in Hydra's own visual functions (osc, kaleid, out, ...), which
  // Strudel does not define; with Hydra in use, unknown names are probably those.
  const usesHydra = [...calls, ...identifiers].some((n) => {
    const name = n.type === 'Identifier' ? n.name : calleeName(n)?.name;
    return Boolean(name) && reference?.browserOnlyPackage(name) === '@strudel/hydra' && isFree(name);
  });
  const unknown = (diagnostic: Diagnostic, name: string) => {
    if (!usesHydra) {
      diagnostics.push(diagnostic);
    } else if (!warned.has(name)) {
      warned.add(name);
      browserOnly.set(name, browserOnly.get(name) ?? 'function');
      diagnostics.push({
        severity: 'warning',
        code: 'browser-only',
        message: `\`${name}\` is not Strudel; with Hydra in use it is probably one of Hydra's visual functions, which are not checked.`,
        line: diagnostic.line,
        column: diagnostic.column,
      });
    }
  };
  const noteUndocumented = (name: string, node: AnyNode) => {
    if (reference && !reference.has(name) && !outputMethods.has(name)) {
      warnOnce(name, node, 'undocumented', `\`${name}\` exists but is not in the Strudel reference, so its behaviour is undocumented.`);
    }
  };

  const callees = new Set<AnyNode>();
  for (const call of calls) {
    const target = calleeName(call);
    if (!target) continue;
    callees.add(target.node);
    if (inSkipped(call)) continue;
    const { name, node, method } = target;
    if (!method) {
      if (!isFree(name)) continue;
      if (isBrowserOnly(name)) {
        noteBrowserOnly(name, node, 'function');
      } else if (!(name in globalThis)) {
        const pool = [...strudelGlobals].filter((g) => typeof (globalThis as any)[g] === 'function');
        const suggestions = reference ? reference.suggest(name, pool) : suggest(name, pool);
        unknown(
          {
            severity: 'error',
            code: 'unknown-function',
            message: `\`${name}\` is not a Strudel or JavaScript function.`,
            ...at(node),
            ...(suggestions.length ? { suggestions } : {}),
          },
          name,
        );
      } else if (strudelGlobals.has(name)) {
        noteUndocumented(name, node);
      }
    } else if (declared.has(name)) {
      continue; // defined by the code, e.g. with register('name', ...)
    } else if (isBrowserOnly(name)) {
      noteBrowserOnly(name, node, 'function');
    } else if (!patternMethods.has(name)) {
      const suggestions = reference ? reference.suggest(name, patternMethods) : suggest(name, patternMethods);
      unknown(
        {
          severity: 'error',
          code: 'unknown-method',
          message: `Patterns have no method \`${name}\`.`,
          ...at(node),
          ...(suggestions.length ? { suggestions } : {}),
        },
        name,
      );
    } else {
      noteUndocumented(name, node);
    }
  }
  // Browser-only signals used as values, e.g. `gravityX.range(0, 7)`.
  for (const node of identifiers) {
    if (callees.has(node) || inSkipped(node) || !isFree(node.name)) continue;
    if (isBrowserOnly(node.name)) noteBrowserOnly(node.name, node, 'value');
  }
  if (diagnostics.some((d) => d.severity === 'error')) return done();
  for (const [name, as] of browserOnly) await stubBrowserOnly(name, as);

  return runtime(browserOnly);
}
