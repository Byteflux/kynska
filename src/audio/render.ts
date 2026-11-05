// Renders Strudel code to audio offline, the way strudel.cc's export does: every
// event in onset order through superdough, then one offline render. Each render
// runs in its own worker thread (see render-worker.ts).
import { Worker } from 'node:worker_threads';
import type { Language } from '../patterns/evaluate.ts';
import type { PatternEvent } from '../patterns/events.ts';

export type RenderOptions = {
  /** First cycle to render. Default 0. Events that start before it are not played, so their tails are missing. */
  from?: number;
  /** Cycles to render, from `from`. Default 4. */
  cycles?: number;
  /** Default 48000, the rate loudness measurement is specified at. */
  sampleRate?: number;
  /** Extra seconds after the last cycle, for release and reverb tails. Default 0, as on strudel.cc. */
  tail?: number;
  /** Refuse renders longer than this many seconds. Default 600. */
  maxSeconds?: number;
  /** Give up after this many seconds of wall time. Default 600: a 2-minute piece takes 25 to 90 s. */
  timeout?: number;
  /** 'mondo' for code written entirely in Mondo notation. Default 'js'. */
  language?: Language;
  /** Use cached sounds only; never download a missing sample. Default false. */
  offline?: boolean;
};

export type Rendered = {
  /** One Float32Array per channel (stereo). */
  channels: Float32Array[];
  sampleRate: number;
  /** Tempo in cycles per second. */
  cps: number;
  /** First rendered cycle; time 0 of the audio. */
  from: number;
  cycles: number;
  /** Events that start within the rendered cycles. */
  events: PatternEvent[];
  /** Events that failed to play, e.g. a sound that does not exist. Unique messages. */
  errors: string[];
  /** Other problems, e.g. a sample bank that could not load. Unique messages. */
  warnings: string[];
};

/** Evaluates Strudel code the way the REPL does and renders it. Throws on evaluation errors. */
export function renderCode(code: string, options: RenderOptions = {}): Promise<Rendered> {
  const settings: Required<RenderOptions> = { from: 0, cycles: 4, sampleRate: 48000, tail: 0, maxSeconds: 600, timeout: 600, language: 'js', offline: false, ...options };
  if (!(settings.cycles > 0)) return Promise.reject(new RangeError(`cycles must be positive, got ${settings.cycles}`));
  if (!(settings.from >= 0)) return Promise.reject(new RangeError(`from must be zero or more, got ${settings.from}`));
  if (!(settings.tail >= 0)) return Promise.reject(new RangeError(`tail must be zero or more, got ${settings.tail}`));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./render-worker.ts', import.meta.url), { workerData: { code, options: settings } });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`render took longer than ${settings.timeout} s and was stopped`));
    }, settings.timeout * 1000);
    worker.once('message', (message: { rendered?: Rendered; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (message.error !== undefined) reject(new Error(message.error));
      else resolve(message.rendered!);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
