// Sets up a headless Strudel evaluation scope: the pattern language without audio,
// MIDI or drawing. Output-only methods are replaced with no-ops so code written for
// the REPL still evaluates, and its events can be queried.
import { registerHooks } from 'node:module';
import { format } from 'node:util';

// @kabelsalat/web (a dependency of @strudel/core) is "type": "module" but its
// "main" is a browser IIFE with no exports; its ES module build is only named in
// the bundler-only "module" field. Plain Node therefore fails to import
// @strudel/core. Point that one specifier at the ES module build. The hook must be
// registered before any @strudel package loads, which is why they are imported
// dynamically below.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (specifier === '@kabelsalat/web' && resolved.url.endsWith('/dist/index.js')) {
      return { ...resolved, url: resolved.url.replace(/index\.js$/, 'index.mjs') };
    }
    return resolved;
  },
});

// Pattern methods that only send output (sound, MIDI, visuals). They return the
// pattern unchanged so the events stay identical.
const OUTPUT_METHODS = [
  'osc',
  'csound',
  'webaudio',
  'midi',
  'soundfont',
  'speak',
  'markcss',
  'dough',
  'scope',
  'pianoroll',
  'punchcard',
  'spiral',
  'pitchwheel',
  'spectrum',
  '_scope',
  '_spiral',
  '_pitchwheel',
  '_pianoroll',
  '_punchcard',
  '_spectrum',
];

const id = <T>(x: T): T => x;

// Global functions that load resources or configure output. They do nothing here.
// (The REPL replaces setcps/setcpm with its own, which record the tempo.)
const OUTPUT_GLOBALS = {
  samples: async () => {},
  soundfont: async () => {},
  loadSoundfont: async () => {},
  loadCsound: async () => {},
  initAudioOnFirstClick: id,
  initDough: id,
};

export type Scope = {
  core: any;
  /** The transpiler the REPL uses: mini-notation strings, `$:` labels, etc. */
  transpiler: unknown;
  /** Global names Strudel defines, as opposed to JavaScript's own globals. */
  strudelGlobals: ReadonlySet<string>;
  /** Method names on Pattern. */
  patternMethods: ReadonlySet<string>;
};

/**
 * Runs `fn` with console output captured into `logs` instead of printed. Strudel
 * logs freely (banners, "[eval] code updated", caught errors), which would break
 * machine-readable output on stdout.
 */
export async function captureConsole<T>(logs: string[], fn: () => Promise<T>): Promise<T> {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      // format() swallows the "%c" style marker Strudel's logger() uses; keep it
      // as a prefix so engineMessages() can tell Strudel's messages apart.
      const styled = typeof args[0] === 'string' && args[0].startsWith('%c');
      logs.push(`${styled ? '%c' : ''}${format(...args)}`);
    };
  }
  try {
    return await fn();
  } finally {
    methods.forEach((m, i) => (console[m] = saved[i]));
  }
}

/** Creates a REPL that never plays: patterns are evaluated and stored, not scheduled. */
export function silentRepl(scope: Pick<Scope, 'core' | 'transpiler'>, onEvalError: (error: unknown) => void) {
  return scope.core.repl({
    defaultOutput: async () => {},
    getTime: () => 0,
    transpiler: scope.transpiler,
    setInterval: () => 0,
    clearInterval: () => {},
    onEvalError,
  });
}

/**
 * Lines Strudel logs that say something about the user's code: everything but
 * load banners and REPL bookkeeping.
 */
export function engineMessages(logs: string[]): string[] {
  // Strudel's logger() prints "%c<message>" with a style argument; anything else
  // is the user's own console.log output.
  const noise = [/^\[eval\] code updated/, /@strudel\/\w+ loaded/];
  const messages = logs.filter((l) => l.startsWith('%c')).map((l) => l.slice(2).trim());
  return [...new Set(messages.filter((m) => m && !noise.some((re) => re.test(m))))];
}

/** Output-only methods replaced with no-ops; never worth a warning. */
export const outputMethods: ReadonlySet<string> = new Set(OUTPUT_METHODS);

const stubs = new Set<string>();

/**
 * Stands in for documented Strudel functions that only exist in the browser
 * (MIDI, motion sensors, CSound, some visuals), so code using them still
 * evaluates headlessly. As a method a stub returns the pattern unchanged; as a
 * global it is a function returning silence, or, when the code uses it as a
 * value (a signal such as `gravityX`), silence itself. Their effect is not checked.
 */
export async function stubBrowserOnly(name: string, as: 'function' | 'value' = 'function'): Promise<void> {
  const { core, strudelGlobals } = await ensureScope();
  if (stubs.has(name)) return;
  stubs.add(name);
  if (!(name in core.Pattern.prototype)) {
    core.Pattern.prototype[name] = function () {
      return this;
    };
  }
  if (!(name in globalThis)) {
    (globalThis as any)[name] = as === 'value' ? core.silence : () => core.silence;
    (strudelGlobals as Set<string>).add(name);
  }
}

/** Whether a name is a stand-in from stubBrowserOnly. */
export const isBrowserOnlyStub = (name: string): boolean => stubs.has(name);

let ready: Promise<Scope> | undefined;

export function ensureScope(): Promise<Scope> {
  ready ??= captureConsole([], async () => {
    const before = new Set(Object.getOwnPropertyNames(globalThis));
    const [core, mini, tonal, transpiler] = await Promise.all([
      import('@strudel/core'),
      import('@strudel/mini'),
      import('@strudel/tonal'),
      import('@strudel/transpiler'),
    ]);
    for (const name of OUTPUT_METHODS) {
      core.Pattern.prototype[name] = function () {
        return this;
      };
    }
    await core.evalScope(core, mini, tonal, OUTPUT_GLOBALS, {
      // The transpiler rewrites slider(value, min, max) into a call to this editor
      // widget; headlessly the slider just stays at its starting value.
      sliderWithID: (_id: string, value: unknown) => core.pure(value),
    });
    // A first evaluation injects the REPL's own globals (setcpm, all, each, hush)
    // and pattern methods (p, d1..d9), so they count as defined from the start.
    const scope = { core, transpiler: transpiler.transpiler };
    await silentRepl(scope, () => {}).evaluate('silence', false);
    const strudelGlobals = new Set(Object.getOwnPropertyNames(globalThis).filter((n) => !before.has(n)));
    const patternMethods = new Set<string>();
    for (let proto = core.Pattern.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) if (name !== 'constructor') patternMethods.add(name);
    }
    return { ...scope, strudelGlobals, patternMethods };
  });
  return ready;
}
