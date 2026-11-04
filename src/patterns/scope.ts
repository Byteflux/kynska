// Sets up a headless Strudel evaluation scope: the pattern language without audio,
// MIDI or drawing. Output-only methods are replaced with no-ops so code written for
// the REPL still evaluates, and its events can be queried.
import { registerHooks } from 'node:module';

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
  'p',
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
const OUTPUT_GLOBALS = {
  samples: async () => {},
  soundfont: async () => {},
  loadSoundfont: async () => {},
  loadCsound: async () => {},
  initAudioOnFirstClick: id,
  setcps: id,
  setcpm: id,
  initDough: id,
};

export type Scope = {
  /** Evaluates Strudel code the way the REPL does and returns its pattern. */
  evaluate: (code: string) => Promise<{ pattern: any }>;
};

let ready: Promise<Scope> | undefined;

export function ensureScope(): Promise<Scope> {
  ready ??= (async () => {
    // Strudel logs banners ("@strudel/core loaded", "cannot use window") while
    // loading. Send them to stderr so stdout stays clean for machine output.
    const log = console.log;
    console.log = console.error;
    const [core, mini, tonal, transpiler] = await Promise.all([
      import('@strudel/core'),
      import('@strudel/mini'),
      import('@strudel/tonal'),
      import('@strudel/transpiler'),
    ]).finally(() => {
      console.log = log;
    });
    for (const name of OUTPUT_METHODS) {
      core.Pattern.prototype[name] = function () {
        return this;
      };
    }
    await core.evalScope(core, mini, tonal, OUTPUT_GLOBALS);
    return { evaluate: transpiler.evaluate };
  })();
  return ready;
}
