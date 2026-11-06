// Mastering for the exported WAV: gain to a loudness target, with a lookahead
// limiter holding the peak at a ceiling. Strudel has no stage that limits the
// whole mix (every event goes to the output through its own chain), so a mix
// with drums cannot reach release loudness (about -14 LUFS) without clipping;
// this is the step a mastering engineer adds. It changes the file only: the
// code plays unmastered on strudel.cc.
import { CLIP_LEVEL, loudness } from './analyse.ts';

export type MasterOptions = {
  /** Integrated loudness to reach, in LUFS. Default -14. */
  target?: number;
  /** Highest sample allowed, in dBFS. Default -1. */
  ceiling?: number;
  /** Lookahead in seconds: how early the limiter starts turning down before a peak. Default 0.005. */
  lookahead?: number;
  /** Seconds for the gain to recover after a peak (time constant). Default 0.08. */
  release?: number;
};

export type MasterResult = {
  channels: Float32Array[];
  /** Loudness before and after, LUFS. */
  before: number;
  after: number;
  /** Gain applied before the limiter, dB. */
  gainDb: number;
  /** The most the limiter turned down, dB. */
  maxReductionDb: number;
  /** Share of the time the limiter turned down by more than 1 dB, 0 to 1. */
  limitedShare: number;
  ceiling: number;
  /**
   * The mix as the code plays it, before mastering: what strudel.cc plays. The
   * limiter hides its clipping in the file, so it is reported on its own.
   */
  input: { peakDb: number; clippedSamples: number };
};

/** More limiting than this squashes drums audibly; rebalance the mix first. */
export const HEAVY_LIMITING_DB = 6;

const fromDb = (db: number) => 10 ** (db / 20);
const toDb = (x: number) => 20 * Math.log10(x);

/** The gain per sample that keeps every sample at or below `ceiling` (linear), smoothed so it never jumps. */
function limiterGain(channels: Float32Array[], pre: number, ceiling: number, look: number, releaseCoef: number): Float32Array {
  const n = channels[0].length;
  // Gain each sample needs on its own (stereo-linked: the louder channel decides).
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]) * pre);
    need[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // Sliding minimum over the next `look` samples (a monotonic deque), then a
  // moving average over the previous `look`: every window that averages into
  // sample p includes p itself, so the result is never above need[p].
  const min = new Float32Array(n);
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[deque[tail - 1]] >= need[i]) tail--;
    deque[tail++] = i;
    while (deque[head] > i + look - 1) head++;
    min[i] = need[deque[head]];
  }
  const gain = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += min[i];
    if (i >= look) sum -= min[i - look];
    gain[i] = sum / Math.min(i + 1, look);
  }
  // Release: the gain may fall at once (the lookahead already ramps it) but rises slowly.
  let g = 1;
  for (let i = 0; i < n; i++) {
    g = Math.min(gain[i], g + (1 - g) * releaseCoef);
    gain[i] = g;
  }
  return gain;
}

export function master(channels: Float32Array[], sampleRate: number, options: MasterOptions = {}): MasterResult {
  const target = options.target ?? -14;
  const ceilingDb = options.ceiling ?? -1;
  if (!(ceilingDb <= 0)) throw new RangeError(`the ceiling must be at or below 0 dBFS, got ${ceilingDb}`);
  const before = loudness(channels, sampleRate);
  if (before === null) throw new Error('the audio is too short or too quiet to measure its loudness, so it cannot be mastered');
  const ceiling = fromDb(ceilingDb);
  const look = Math.max(1, Math.round((options.lookahead ?? 0.005) * sampleRate));
  const releaseCoef = 1 - Math.exp(-1 / ((options.release ?? 0.08) * sampleRate));
  // The limiter takes some loudness off, so the gain before it goes up until
  // the result lands on the target (each pass corrects by what is missing).
  let gainDb = target - before;
  let out: Float32Array[] = channels;
  let gain: Float32Array = new Float32Array(0);
  let after = before;
  for (let pass = 0; pass < 6; pass++) {
    const pre = fromDb(gainDb);
    gain = limiterGain(channels, pre, ceiling, look, releaseCoef);
    out = channels.map((ch) => Float32Array.from(ch, (x, i) => Math.max(-ceiling, Math.min(ceiling, x * pre * gain[i]))));
    after = loudness(out, sampleRate)!;
    if (Math.abs(after - target) < 0.05) break;
    gainDb += target - after;
  }
  let minGain = 1;
  let limited = 0;
  const limitedBelow = fromDb(-1);
  for (const g of gain) {
    if (g < minGain) minGain = g;
    if (g < limitedBelow) limited++;
  }
  let inputPeak = 0;
  let clippedSamples = 0;
  for (const ch of channels) {
    for (const x of ch) {
      const abs = Math.abs(x);
      if (abs > inputPeak) inputPeak = abs;
      if (abs >= CLIP_LEVEL) clippedSamples++;
    }
  }
  return {
    channels: out,
    before,
    after,
    gainDb,
    maxReductionDb: -toDb(minGain),
    limitedShare: gain.length ? limited / gain.length : 0,
    ceiling: ceilingDb,
    input: { peakDb: toDb(inputPeak), clippedSamples },
  };
}

export function formatMaster(m: MasterResult): string {
  const lines = [
    `Mastered to ${m.after.toFixed(1)} LUFS (from ${m.before.toFixed(1)}): ${m.gainDb >= 0 ? '+' : ''}${m.gainDb.toFixed(1)} dB, limiter at ${m.ceiling.toFixed(1)} dBFS took up to ${m.maxReductionDb.toFixed(1)} dB off peaks, limiting ${Math.round(m.limitedShare * 100)}% of the time`,
    `Before mastering (the code as strudel.cc plays it): peak ${m.input.peakDb >= 0 ? '+' : ''}${m.input.peakDb.toFixed(1)} dBFS, ${m.input.clippedSamples} clipped samples`,
  ];
  if (m.input.clippedSamples) {
    lines.push(
      `warning: the code's own mix clips; the limiter hides it in this file, but strudel.cc plays the code unmastered. Lower the gains in the code until this line shows 0 clipped samples`,
    );
  }
  if (m.maxReductionDb > HEAVY_LIMITING_DB) {
    lines.push(
      `warning: more than ${HEAVY_LIMITING_DB} dB of limiting flattens the drums; lower the layers with the largest gap between peak and loudness (render --layers) and master again`,
    );
  }
  return lines.join('\n');
}
