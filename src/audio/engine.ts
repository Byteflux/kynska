// Headless superdough: Strudel's audio engine, rendering into an
// OfflineAudioContext from node-web-audio-api. Everything here adapts the npm
// build of superdough (written for browsers) to Node; each workaround says why.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR } from '../paths.ts';
import { isPlainData, SOUNDFONT_HOST } from './soundfonts.ts';

const CDN = 'https://strudel.b-cdn.net';

export type AudioEngine = {
  /** superdough's exports. */
  sd: any;
  /** node-web-audio-api's exports. */
  wa: any;
  /** Renders the context without counting it as a pending side render. */
  startRendering: (ctx: any) => Promise<any>;
  /** Side renders still running, e.g. reverb impulse responses. */
  pending: Set<Promise<unknown>>;
  /** Worklet modules superdough has loaded, to load into each new context. */
  workletUrls: Set<string>;
  workletsIn: WeakMap<object, Set<string>>;
  /** Where superdough's log messages go during a render. */
  log: (message: string) => void;
  /** Sound banks that failed to register (no network, say). */
  soundWarnings: string[];
};

/**
 * Caches GET requests for sample maps and samples under .cache/sounds/, so a
 * sound is downloaded once and later renders work offline.
 */
function cachingFetch(original: typeof fetch): typeof fetch {
  const dir = join(CACHE_DIR, 'sounds');
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/^https?:\/\//.test(url) || (init?.method && init.method !== 'GET')) return original(input, init);
    const file = join(dir, createHash('sha256').update(url).digest('hex'));
    // Soundfont instruments are JavaScript files the loader runs with eval:
    // only plain data gets through.
    const guard = (body: Buffer) => {
      if (SOUNDFONT_HOST.test(url) && !isPlainData(body.toString('utf8'))) {
        throw new Error(`refusing soundfont ${url}: it is not plain data`);
      }
      return body;
    };
    let cached: Buffer | undefined;
    try {
      cached = await readFile(file);
    } catch {
      // not downloaded yet
    }
    if (cached) return new Response(new Uint8Array(guard(cached)));
    // A dead network must not hang a render: give up on a download after 20 s.
    const response = await original(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
    if (!response.ok) return response;
    const body = guard(Buffer.from(await response.arrayBuffer()));
    await mkdir(dir, { recursive: true });
    await writeFile(file, body);
    return new Response(new Uint8Array(body), { status: response.status, headers: response.headers });
  };
}

/** The same default sounds strudel.cc loads, from Strudel's CDN. */
async function registerDefaultSounds(sd: any, warnings: string[]) {
  const banks: [string, string][] = [
    [`${CDN}/piano.json`, `${CDN}/piano/`],
    [`${CDN}/vcsl.json`, `${CDN}/VCSL/`],
    [`${CDN}/tidal-drum-machines.json`, `${CDN}/tidal-drum-machines/machines/`],
    [`${CDN}/uzu-drumkit.json`, `${CDN}/uzu-drumkit/`],
    [`${CDN}/uzu-wavetables.json`, `${CDN}/uzu-wavetables/`],
    [`${CDN}/mridangam.json`, `${CDN}/mrid/`],
    ['github:tidalcycles/dirt-samples', ''],
  ];
  await Promise.all([
    sd.registerSynthSounds(),
    sd.registerZZFXSounds(),
    ...banks.map(([map, base]) =>
      (base ? sd.samples(map, base, { prebake: true }) : sd.samples(map)).catch((e: Error) =>
        warnings.push(`could not load sample bank ${map}: ${e.message}`),
      ),
    ),
  ]);
  try {
    await sd.aliasBank(`${CDN}/tidal-drum-machines-alias.json`);
  } catch (e) {
    warnings.push(`could not load drum machine aliases: ${(e as Error).message}`);
  }
}

let ready: Promise<AudioEngine> | undefined;

export function ensureAudio(): Promise<AudioEngine> {
  ready ??= (async () => {
    const wa: any = await import('node-web-audio-api');
    for (const [name, value] of Object.entries(wa)) {
      if (name !== 'default' && !(name in globalThis)) (globalThis as any)[name] = value;
    }
    globalThis.fetch = cachingFetch(globalThis.fetch);

    // superdough loads its AudioWorklet processors once per process (into the first
    // context); record them so every new offline context can load them too.
    const workletUrls = new Set<string>();
    const workletsIn = new WeakMap<object, Set<string>>();
    const addModule = wa.AudioWorklet.prototype.addModule;
    // superdough's worklets are data: URLs, which node-web-audio-api only finds by
    // resolving relative to its caller (fragile, and failing under test runners);
    // it reads blob: URLs directly, so hand it those.
    const blobs = new Map<string, string>();
    const asBlob = (url: string) => {
      const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
      if (!match) return url;
      let blob = blobs.get(url);
      if (!blob) {
        const body = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
        blob = URL.createObjectURL(new Blob([body], { type: match[1] || 'text/javascript' }));
        blobs.set(url, blob);
      }
      return blob;
    };
    wa.AudioWorklet.prototype.addModule = function (this: any, url: string, ...rest: unknown[]) {
      workletUrls.add(url);
      return addModule.call(this, asBlob(url), ...rest);
    };

    // Reverb impulse responses render in their own offline contexts, finishing
    // asynchronously; track them so a render can wait for its reverb.
    const pending = new Set<Promise<unknown>>();
    const startRendering = wa.OfflineAudioContext.prototype.startRendering;
    wa.OfflineAudioContext.prototype.startRendering = function (this: any) {
      const p: Promise<unknown> = startRendering.call(this);
      pending.add(p);
      p.finally(() => pending.delete(p));
      return p;
    };

    const sd: any = await import('superdough');
    // superdough adds createReverb, createFeedbackDelay, ... to AudioContext; an
    // OfflineAudioContext needs them too.
    for (const name of Object.getOwnPropertyNames(wa.AudioContext.prototype)) {
      if (!(name in wa.OfflineAudioContext.prototype)) {
        Object.defineProperty(wa.OfflineAudioContext.prototype, name, Object.getOwnPropertyDescriptor(wa.AudioContext.prototype, name)!);
      }
    }
    const engine: AudioEngine = {
      sd,
      wa,
      startRendering: (ctx) => startRendering.call(ctx),
      pending,
      workletUrls,
      workletsIn,
      log: () => {},
      soundWarnings: [],
    };
    sd.setLogger((...args: unknown[]) => engine.log(args.map(String).join(' ')));
    await registerDefaultSounds(sd, engine.soundWarnings);
    return engine;
  })();
  return ready;
}

/**
 * Makes `ctx` superdough's audio context and loads its worklets. superdough only
 * creates its context with `new AudioContext()` and only initialises when
 * `window` exists, so both are stood in for while this runs.
 */
export async function attachContext(engine: AudioEngine, ctx: any): Promise<void> {
  const { sd } = engine;
  const RealAudioContext = globalThis.AudioContext;
  (globalThis as any).AudioContext = function () {
    return ctx;
  };
  try {
    sd.setDefaultAudioContext();
  } finally {
    (globalThis as any).AudioContext = RealAudioContext;
  }
  sd.resetGlobalEffects();
  // An OfflineAudioContext's resume() never settles before rendering starts.
  const resume = ctx.resume;
  ctx.resume = async () => {};
  try {
    await sd.initAudio({});
  } finally {
    ctx.resume = resume;
  }
  const loaded = engine.workletsIn.get(ctx) ?? new Set<string>();
  engine.workletsIn.set(ctx, loaded);
  for (const url of engine.workletUrls) {
    if (!loaded.has(url)) {
      await ctx.audioWorklet.addModule(url);
      loaded.add(url);
    }
  }
}
