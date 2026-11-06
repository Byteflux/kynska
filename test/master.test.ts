import { describe, expect, it } from 'vitest';
import { analyse, loudness } from '../src/audio/analyse.ts';
import { formatMaster, master } from '../src/audio/master.ts';

const RATE = 48000;
const db = (x: number) => 20 * Math.log10(x);

/** A steady 220 Hz tone with a short loud click every half second: a mix whose peaks are far above its loudness. */
function tonesWithClicks(seconds: number, tone: number, click: number): Float32Array {
  return Float32Array.from({ length: seconds * RATE }, (_, i) => {
    const t = i / RATE;
    const c = t % 0.5 < 0.002 ? click * Math.sin(2 * Math.PI * 2000 * t) : 0;
    return tone * Math.sin(2 * Math.PI * 220 * t) + c;
  });
}

describe('master', () => {
  it('reaches the loudness target with every sample under the ceiling', () => {
    const x = tonesWithClicks(6, 0.05, 0.6);
    // Peak about -4 dBFS, loudness about -23.6 LUFS: the +9.6 dB to reach -14 alone would clip.
    expect(loudness([x, x], RATE)!).toBeLessThan(-20);
    expect(analyse([x, x], RATE).peakDb).toBeGreaterThan(-5);
    const m = master([x, x], RATE, { target: -14, ceiling: -1 });
    const stats = analyse(m.channels, RATE);
    expect(m.after).toBeCloseTo(-14, 1);
    expect(stats.loudnessLufs!).toBeCloseTo(-14, 1);
    expect(stats.peakDb).toBeLessThanOrEqual(-1 + 1e-6);
    expect(stats.clippedSamples).toBe(0);
    expect(m.maxReductionDb).toBeGreaterThan(3);
    // The limiter turns down at each click and recovers before the next: 0.3 s
    // after a click (about 4 release time constants), the tone is within 0.2 dB of full gain.
    const pre = 10 ** (m.gainDb / 20);
    for (const t of [1.3, 2.8, 4.3]) {
      const i = Math.round(t * RATE);
      expect(db(m.channels[0][i] / (x[i] * pre))).toBeGreaterThan(-0.2);
    }
    expect(m.limitedShare).toBeLessThan(0.4);
  });

  it('only applies gain when nothing reaches the ceiling', () => {
    const x = tonesWithClicks(4, 0.05, 0);
    const m = master([x, x], RATE, { target: -20 });
    expect(m.maxReductionDb).toBeCloseTo(0, 6);
    expect(m.after).toBeCloseTo(-20, 1);
    // Gain only: the shape is the input scaled.
    const k = m.channels[0][1000] / x[1000];
    expect(m.channels[0][5000] / x[5000]).toBeCloseTo(k, 5);
    expect(db(k)).toBeCloseTo(m.gainDb, 1);
  });

  it('turns down smoothly ahead of a peak instead of clipping it', () => {
    const x = tonesWithClicks(4, 0.05, 0.9);
    const m = master([x, x], RATE, { target: -16, lookahead: 0.005 });
    // Sample to sample, the limiter's gain changes by far less than a hard clip would.
    const out = m.channels[0];
    let worstJump = 0;
    for (let i = 1; i < out.length; i++) {
      const gNow = x[i] ? out[i] / x[i] : NaN;
      const gPrev = x[i - 1] ? out[i - 1] / x[i - 1] : NaN;
      if (Number.isFinite(gNow) && Number.isFinite(gPrev) && Math.abs(x[i]) > 0.01 && Math.abs(x[i - 1]) > 0.01) worstJump = Math.max(worstJump, Math.abs(gNow - gPrev) / Math.max(gNow, gPrev));
    }
    expect(worstJump).toBeLessThan(0.05);
  });

  it('warns when the mix needs heavy limiting', () => {
    const x = tonesWithClicks(4, 0.02, 0.95);
    const m = master([x, x], RATE, { target: -12 });
    expect(m.maxReductionDb).toBeGreaterThan(6);
    expect(formatMaster(m)).toMatch(/warning: more than 6 dB of limiting/);
  });

  // Regression: in the glm-5.3 pilot, bass-drums runs mastered a mix with 2,544
  // clipped samples, saw "0 clipped samples" on the file, and answered.
  it("reports and warns when the code's own mix clips, though the file does not", () => {
    const x = tonesWithClicks(4, 0.05, 1.2);
    const m = master([x, x], RATE, { target: -14 });
    expect(m.input.clippedSamples).toBeGreaterThan(0);
    expect(m.input.peakDb).toBeCloseTo(db(1.2), 0);
    expect(analyse(m.channels, RATE).clippedSamples).toBe(0);
    expect(formatMaster(m)).toMatch(/Before mastering \(the code as strudel\.cc plays it\): peak \+1\.\d dBFS, \d+ clipped samples\nwarning: the code's own mix clips/);
  });

  it('does not warn when the code itself stays under full scale', () => {
    const x = tonesWithClicks(4, 0.05, 0.6);
    const m = master([x, x], RATE, { target: -14 });
    expect(m.input.clippedSamples).toBe(0);
    expect(formatMaster(m)).not.toMatch(/mix clips/);
  });

  it('refuses audio too quiet to measure', () => {
    expect(() => master([new Float32Array(RATE)], RATE)).toThrow(/too short or too quiet/);
  });
});
