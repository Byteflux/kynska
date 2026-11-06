// Eval render boundary: cached sounds, temporary WAVs, bounded workers and costs.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatLayers, renderLayers } from '../src/audio/layers.ts';
import { formatMaster, master } from '../src/audio/master.ts';
import { renderCode } from '../src/audio/render.ts';
import { formatReport, reportRender } from '../src/audio/report.ts';
import { encodeWav } from '../src/audio/wav.ts';
import { parseSections, windowOf } from '../src/patterns/sections.ts';

export type RenderCosts = { renderCalls: number; renderSeconds: number };
export const emptyCosts = (): RenderCosts => ({ renderCalls: 0, renderSeconds: 0 });
export type EvalRenderOptions = { cycles?: number; sections?: string; from?: number; to?: number; layers?: boolean; master?: number; tail?: number; sampleRate?: number };

/**
 * Eval renders download and cache sounds like the CLI does, so a fresh checkout
 * or CI runner works. KYNSKA_EVAL_OFFLINE=1 uses only cached sounds, for a
 * machine with no network.
 */
export const offlineRenders = (env: NodeJS.ProcessEnv = process.env) => env.KYNSKA_EVAL_OFFLINE === '1';

// Also covers render calls made on non-produce tasks. Layer workers run serially
// inside each job, so at most two render workers exist across the eval process.
let active = 0;
const waiting: (() => void)[] = [];
export async function withRenderSlot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await job();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export async function evalRender(code: string, args: EvalRenderOptions, costs = emptyCosts(), directory?: string) {
  costs.renderCalls++;
  return withRenderSlot(async () => {
    const sections = args.sections ? parseSections(args.sections) : undefined;
    const sampleRate = args.sampleRate ?? 48000;
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('sampleRate must be a whole number from 8000 to 192000');
    if (args.master !== undefined && (!Number.isFinite(args.master) || args.master >= 0)) throw new Error('master must be a negative LUFS target, e.g. -14');
    const options = { ...windowOf(args, 4, sections), tail: args.tail ?? 0, sampleRate, maxSeconds: 32, timeout: 60, offline: offlineRenders() };
    const rendered = args.layers ? await renderLayers(code, options, sections, 1) : { mix: await renderCode(code, options), layers: undefined };
    // Audio seconds actually rendered, including the mix and each solo render.
    costs.renderSeconds += (rendered.mix.channels[0].length / sampleRate) * (1 + (rendered.layers?.length ?? 0));
    const mastered = args.master === undefined ? undefined : master(rendered.mix.channels, sampleRate, { target: args.master });
    const mix = mastered ? { ...rendered.mix, channels: mastered.channels } : rendered.mix;
    // Mastering hides a clipping mix; the scorer checks the code's own output too.
    const premaster = mastered ? { clippedSamples: mastered.input.clippedSamples, limiterDb: mastered.maxReductionDb } : undefined;
    const dir = directory ?? await mkdtemp(join(tmpdir(), 'kynska-eval-'));
    try {
      const file = join(dir, `render-${costs.renderCalls}.wav`);
      await writeFile(file, encodeWav(mix.channels, sampleRate));
      const report = reportRender(mix, file, sections);
      const text = [
        formatReport(report),
        ...(mastered ? [formatMaster(mastered)] : []),
        ...(rendered.layers ? [formatLayers(rendered.layers, report)] : []),
      ].join('\n');
      return { report, events: mix.events, text, premaster };
    } finally {
      if (!directory) await rm(dir, { recursive: true, force: true });
    }
  });
}
