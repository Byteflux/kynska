// Worker thread for one render. superdough keeps private module state tied to
// the first audio context it sees (its output controller), and rendering needs
// browser stand-ins (window, AudioContext); a worker per render gives each a
// fresh superdough and keeps the stand-ins out of the main thread.
import { parentPort, workerData } from 'node:worker_threads';
import { evaluateCode } from '../patterns/evaluate.ts';
import { eventsOf } from '../patterns/events.ts';
import { captureConsole, engineMessages } from '../patterns/scope.ts';
import { attachContext, ensureAudio } from './engine.ts';
import { registerSoundfonts } from './soundfonts.ts';
import type { RenderOptions, Rendered } from './render.ts';

async function render(code: string, options: Required<RenderOptions>): Promise<Rendered> {
  const { from, cycles, sampleRate, tail, language } = options;
  const { pattern, cps, error } = await evaluateCode(code, language);
  if (error) throw error;
  const seconds = cycles / cps + tail;
  if (seconds > options.maxSeconds) {
    throw new RangeError(`${Number(seconds.toFixed(2))} s is longer than the ${options.maxSeconds} s limit; render fewer cycles`);
  }
  const engine = await ensureAudio(options.offline);
  const errors = new Set<string>();
  const warnings = new Set<string>(engine.soundWarnings);
  engine.log = (message) => {
    if (/error|not found|warn/i.test(message)) warnings.add(message.replace(/^\[\w+\]\s*/, ''));
  };
  // reverbGen keeps a reference on window.filterNode while it renders, and the
  // dough worklet listens for and posts messages on window.
  (globalThis as any).window ??= Object.assign(new EventTarget(), { postMessage: () => {} });
  const ctx = new engine.wa.OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  await attachContext(engine, ctx);
  const logs: string[] = [];
  const haps = await captureConsole(logs, async () =>
    pattern
      .queryArc(from, from + cycles, { _cps: cps })
      .filter((hap: any) => hap.hasOnset())
      .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf()),
  );
  // General MIDI instruments are only loaded when the pattern plays one.
  if (haps.some((hap: any) => typeof hap.value?.s === 'string' && hap.value.s.startsWith('gm_'))) {
    try {
      await registerSoundfonts(options.offline);
    } catch (e) {
      warnings.add(`could not load soundfont instruments: ${(e as Error).message}`);
    }
  }
  for (const hap of haps) {
    hap.ensureObjectValue();
    const t = (hap.whole.begin.valueOf() - from) / cps;
    try {
      await engine.sd.superdough(hap.value, t, hap.duration / cps, cps, t);
    } catch (e) {
      errors.add((e as Error).message);
    }
  }
  // Reverb impulse responses render in their own contexts; wait for them.
  while (engine.pending.size) {
    await Promise.all([...engine.pending]);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const buffer = await engine.startRendering(ctx);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => Float32Array.from(buffer.getChannelData(c)));
  for (const message of engineMessages(logs)) warnings.add(message);
  return { channels, sampleRate, cps, from, cycles, events: eventsOf(pattern, cycles, from), errors: [...errors], warnings: [...warnings] };
}

const { code, options } = workerData as { code: string; options: Required<RenderOptions> };
try {
  const rendered = await captureConsole([], () => render(code, options));
  parentPort!.postMessage({ rendered }, rendered.channels.map((c) => c.buffer as ArrayBuffer));
} catch (error) {
  parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
