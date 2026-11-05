// Worker thread for one render. superdough keeps private module state tied to
// the first audio context it sees (its output controller), and rendering needs
// browser stand-ins (window, AudioContext); a worker per render gives each a
// fresh superdough and keeps the stand-ins out of the main thread.
import { parentPort, workerData } from 'node:worker_threads';
import { evaluateCode } from '../patterns/evaluate.ts';
import { eventsOf } from '../patterns/events.ts';
import { captureConsole, engineMessages } from '../patterns/scope.ts';
import { attachContext, ensureAudio } from './engine.ts';
import type { RenderOptions, Rendered } from './render.ts';

async function render(code: string, options: Required<RenderOptions>): Promise<Rendered> {
  const { cycles, sampleRate, tail, language } = options;
  const { pattern, cps, error } = await evaluateCode(code, language);
  if (error) throw error;
  const seconds = cycles / cps + tail;
  if (seconds > options.maxSeconds) {
    throw new RangeError(`${seconds.toFixed(0)} s is longer than the ${options.maxSeconds} s limit; render fewer cycles`);
  }
  const engine = await ensureAudio();
  const errors = new Set<string>();
  const warnings = new Set<string>(engine.soundWarnings);
  engine.log = (message) => {
    if (/error|not found|warn/i.test(message)) warnings.add(message.replace(/^\[\w+\]\s*/, ''));
  };
  // reverbGen keeps a reference on window.filterNode while it renders.
  (globalThis as any).window ??= {};
  const ctx = new engine.wa.OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  await attachContext(engine, ctx);
  const logs: string[] = [];
  const haps = await captureConsole(logs, async () =>
    pattern
      .queryArc(0, cycles, { _cps: cps })
      .filter((hap: any) => hap.hasOnset())
      .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf()),
  );
  for (const hap of haps) {
    hap.ensureObjectValue();
    const t = hap.whole.begin.valueOf() / cps;
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
  return { channels, sampleRate, cps, cycles, events: eventsOf(pattern, cycles), errors: [...errors], warnings: [...warnings] };
}

const { code, options } = workerData as { code: string; options: Required<RenderOptions> };
try {
  const rendered = await captureConsole([], () => render(code, options));
  parentPort!.postMessage({ rendered }, rendered.channels.map((c) => c.buffer as ArrayBuffer));
} catch (error) {
  parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
