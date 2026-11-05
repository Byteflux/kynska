// Measures audio in code, so nobody has to judge it by ear: levels, loudness,
// clipping, silence, and whether sound starts where the pattern's events do.

export type AudioStats = {
  duration: number;
  sampleRate: number;
  channels: number;
  /** Highest absolute sample, in dBFS (-Infinity for digital silence). */
  peakDb: number;
  /** When the highest sample is, in seconds from the start. */
  peakAt: number;
  /** RMS over the whole file and all channels, in dBFS. */
  rmsDb: number;
  /** Integrated loudness (ITU-R BS.1770-4, gated), in LUFS; null when too short or too quiet to measure. */
  loudnessLufs: number | null;
  /** Samples at or beyond full scale (|x| >= 0.999). */
  clippedSamples: number;
  /** Mean sample value; far from 0 means a DC offset. */
  dcOffset: number;
  /** Share of 100 ms windows quieter than -60 dBFS, 0 to 1. */
  silentShare: number;
};

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

type Biquad = { b: [number, number, number]; a: [number, number] };

/**
 * The two K-weighting stages of BS.1770 for any sample rate, by the bilinear
 * transform of the analogue prototypes (as libebur128 does). At 48 kHz this
 * reproduces the coefficients printed in the standard.
 */
function kWeighting(sampleRate: number): Biquad[] {
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const Vh = 10 ** (G / 20);
    const Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return {
      b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
      a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    } satisfies Biquad;
  })();
  const highPass = (() => {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const a0 = 1 + K / Q + K * K;
    return {
      b: [1, -2, 1],
      a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    } satisfies Biquad;
  })();
  return [shelf, highPass];
}

function filter(x: Float32Array, { b, a }: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const out = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

/** Integrated loudness per ITU-R BS.1770-4: K-weighting, 400 ms blocks at 75% overlap, absolute and relative gates. */
export function loudness(channels: Float32Array[], sampleRate: number): number | null {
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const frames = channels[0]?.length ?? 0;
  if (frames < block) return null;
  const weighted = channels.slice(0, 2).map((ch) => kWeighting(sampleRate).reduce(filter, ch));
  const powers: number[] = [];
  for (let start = 0; start + block <= frames; start += step) {
    let z = 0;
    for (const ch of weighted) {
      let sum = 0;
      for (let i = start; i < start + block; i++) sum += ch[i] * ch[i];
      z += sum / block;
    }
    powers.push(z);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (zs: number[]) => zs.reduce((s, z) => s + z, 0) / zs.length;
  const absolute = powers.filter((z) => z > 0 && lufs(z) > -70);
  if (!absolute.length) return null;
  const relativeGate = lufs(mean(absolute)) - 10;
  const gated = absolute.filter((z) => lufs(z) > relativeGate);
  return gated.length ? lufs(mean(gated)) : null;
}

export function analyse(channels: Float32Array[], sampleRate: number): AudioStats {
  const frames = channels[0]?.length ?? 0;
  let peak = 0;
  let peakIndex = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      const abs = Math.abs(x);
      if (abs > peak) {
        peak = abs;
        peakIndex = i;
      }
      if (abs >= 0.999) clipped++;
      sumSq += x * x;
      sum += x;
    }
  }
  const total = frames * channels.length || 1;
  const window = Math.max(1, Math.round(0.1 * sampleRate));
  let windows = 0;
  let silent = 0;
  for (let start = 0; start < frames; start += window) {
    const end = Math.min(frames, start + window);
    let s = 0;
    for (const ch of channels) for (let i = start; i < end; i++) s += ch[i] * ch[i];
    windows++;
    if (db(Math.sqrt(s / ((end - start) * channels.length))) < -60) silent++;
  }
  return {
    duration: frames / sampleRate,
    sampleRate,
    channels: channels.length,
    peakDb: db(peak),
    peakAt: peakIndex / sampleRate,
    rmsDb: db(Math.sqrt(sumSq / total)),
    loudnessLufs: loudness(channels, sampleRate),
    clippedSamples: clipped,
    dcOffset: sum / total,
    silentShare: windows ? silent / windows : 1,
  };
}

export type OnsetCheck = {
  /** Distinct event onset times (seconds) the pattern scheduled. */
  expected: number;
  /** Of those, how many have a detected sound onset within the tolerance. */
  matched: number;
  /** Event times with no sound starting near them, in seconds. */
  missing: number[];
  /** Detected sound onsets with no event near them, in seconds. */
  extra: number[];
};

/** In-place radix-2 FFT; `re` and `im` have a power-of-two length. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cos - im[b] * sin;
        const ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * Detects where sounds start, by spectral flux: how much the log-compressed
 * spectrum grows from one 5 ms step to the next, against the previous frame's
 * spectrum widened by one bin (so vibrato and leakage do not count). That catches
 * a new note even when the level stays the same, as in legato melodies. Frames
 * quieter than -50 dBFS, or getting quieter (a note ending), are ignored. Tuned
 * on synths, drums and piano (see test/audio.test.ts). A heuristic, so it
 * reports rather than judges.
 */
export function detectOnsets(channels: Float32Array[], sampleRate: number): number[] {
  const size = 1 << Math.round(Math.log2(0.043 * sampleRate)); // ~43 ms window
  const hop = Math.round(0.005 * sampleRate);
  const frames = channels[0]?.length ?? 0;
  const mono = new Float32Array(frames);
  for (const ch of channels) for (let i = 0; i < frames; i++) mono[i] += ch[i] / channels.length;
  const hann = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const flux: number[] = [];
  const levels: number[] = [];
  let previous = new Float64Array(size / 2); // silence before the start
  // Frames are centred on each 5 ms step, so a detected time is the step itself.
  for (let centre = 0; centre < frames; centre += hop) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let energy = 0;
    for (let i = 0; i < size; i++) {
      const j = centre - size / 2 + i;
      const x = j >= 0 && j < frames ? mono[j] : 0;
      energy += x * x;
      re[i] = x * hann[i];
    }
    fft(re, im);
    const magnitudes = new Float64Array(size / 2);
    for (let k = 0; k < size / 2; k++) magnitudes[k] = Math.log1p(Math.hypot(re[k], im[k]));
    let f = 0;
    for (let k = 0; k < size / 2; k++) {
      const reference = Math.max(previous[k], previous[k - 1] ?? 0, previous[k + 1] ?? 0);
      f += Math.max(0, magnitudes[k] - reference);
    }
    previous = magnitudes;
    flux.push(f);
    levels.push(10 * Math.log10(energy / size + 1e-12));
  }
  // Local peaks above twice the local median plus the overall mean, where the
  // level is above -50 dBFS and not falling: a note ending spreads its spectrum
  // too, but its level drops, and keeps dropping (a hit decays by less than 3 dB
  // in the next 10 ms).
  const mean = flux.reduce((s, f) => s + f, 0) / (flux.length || 1);
  const onsets: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < flux.length; i++) {
    if (levels[i] <= -50 || levels[i] - (levels[i - 2] ?? -Infinity) < -1) continue;
    if ((levels[i + 2] ?? levels[i]) - levels[i] < -3) continue;
    if (flux[i] < (flux[i - 1] ?? 0) || flux[i] < (flux[i + 1] ?? 0)) continue;
    const around = flux.slice(Math.max(0, i - 10), i + 11).sort((a, b) => a - b);
    const threshold = around[around.length >> 1] * 2 + mean;
    const t = (i * hop) / sampleRate;
    if (flux[i] > threshold && t - last > 0.03) {
      onsets.push(t);
      last = t;
    }
  }
  return onsets;
}

export function matchOnsets(onsets: number[], eventTimes: number[], toleranceSeconds = 0.04): OnsetCheck {
  const expected = [...new Set(eventTimes.map((t) => Math.round(t * 1000)))].sort((a, b) => a - b).map((ms) => ms / 1000);
  const used = new Set<number>();
  const missing: number[] = [];
  for (const t of expected) {
    const i = onsets.findIndex((o, j) => !used.has(j) && Math.abs(o - t) <= toleranceSeconds);
    if (i >= 0) used.add(i);
    else missing.push(t);
  }
  const extra = onsets.filter((o, j) => !used.has(j) && !expected.some((t) => Math.abs(o - t) <= toleranceSeconds));
  return { expected: expected.length, matched: expected.length - missing.length, missing, extra };
}
