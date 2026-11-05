import { describe, expect, it } from 'vitest';
import { analyse, detectOnsets, loudness, matchOnsets } from '../src/audio/analyse.ts';
import { renderCode } from '../src/audio/render.ts';
import { reportRender } from '../src/audio/report.ts';
import { isPlainData } from '../src/audio/soundfonts.ts';
import { decodeWav, encodeWav } from '../src/audio/wav.ts';

const RATE = 48000;

function sine(seconds: number, amplitude: number, hz = 1000, rate = RATE): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate));
}

/** Silence with plucked 440 Hz notes (5 ms attack, then decaying) starting at the given times. */
function plucks(seconds: number, starts: number[]): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (const t of starts) {
    const from = Math.round(t * RATE);
    for (let i = 0; from + i < out.length && i < 0.3 * RATE; i++) {
      const s = i / RATE;
      const envelope = Math.min(1, s / 0.005) * Math.exp(-s / 0.06);
      out[from + i] += 0.5 * envelope * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
  }
  return out;
}

const db = (x: number) => 20 * Math.log10(x);

describe('WAV', () => {
  it('round-trips 16-bit stereo audio', () => {
    const left = sine(0.1, 0.5);
    const right = sine(0.1, -0.25, 300);
    const { channels, sampleRate } = decodeWav(encodeWav([left, right], RATE));
    expect(sampleRate).toBe(RATE);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toHaveLength(left.length);
    for (let i = 0; i < left.length; i += 97) {
      expect(channels[0][i]).toBeCloseTo(left[i], 4);
      expect(channels[1][i]).toBeCloseTo(right[i], 4);
    }
  });

  it('rejects files that are not WAV', () => {
    expect(() => decodeWav(Buffer.from('not audio at all, really'))).toThrow(/not a WAV/);
  });
});

describe('analyse', () => {
  it('measures peak and RMS of a sine', () => {
    const stats = analyse([sine(1, 0.5), sine(1, 0.5)], RATE);
    expect(stats.peakDb).toBeCloseTo(db(0.5), 1);
    expect(stats.rmsDb).toBeCloseTo(db(0.5 / Math.SQRT2), 1);
    expect(stats.clippedSamples).toBe(0);
    expect(stats.silentShare).toBe(0);
    expect(Math.abs(stats.dcOffset)).toBeLessThan(1e-3);
  });

  it('counts clipped samples', () => {
    const clipped = Float32Array.from(sine(0.1, 1.5), (x) => Math.max(-1, Math.min(1, x)));
    expect(analyse([clipped], RATE).clippedSamples).toBeGreaterThan(100);
  });

  it('reports silence as silence', () => {
    const stats = analyse([new Float32Array(RATE), new Float32Array(RATE)], RATE);
    expect(stats.peakDb).toBe(-Infinity);
    expect(stats.silentShare).toBe(1);
    expect(stats.loudnessLufs).toBeNull();
  });
});

describe('loudness (ITU-R BS.1770)', () => {
  // EBU Tech 3341 test signal: a stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS.
  it.each([-23, -33])('reads a stereo 1 kHz sine at %d dBFS as that many LUFS', (level) => {
    const tone = sine(5, 10 ** (level / 20));
    expect(loudness([tone, tone], RATE)).toBeCloseTo(level, 1);
  });

  it('works at other sample rates', () => {
    const tone = sine(5, 10 ** (-23 / 20), 1000, 44100);
    expect(loudness([tone, tone], 44100)).toBeCloseTo(-23, 1);
  });

  it('cannot measure less than 400 ms', () => {
    expect(loudness([sine(0.3, 0.5)], RATE)).toBeNull();
  });
});

describe('onsets', () => {
  it('finds where sounds start', () => {
    const starts = [0.1, 0.5, 0.9];
    const found = detectOnsets([plucks(1.2, starts)], RATE);
    expect(found).toHaveLength(3);
    // Within the 40 ms matchOnsets allows; the 43 ms window sees an attack early.
    found.forEach((t, i) => expect(Math.abs(t - starts[i])).toBeLessThan(0.03));
  });

  it('matches onsets to event times, reporting what is missing and extra', () => {
    const check = matchOnsets([0.0, 0.51, 1.3], [0, 0.5, 1.0, 1.0]);
    expect(check).toEqual({ expected: 3, matched: 2, missing: [1], extra: [1.3] });
  });
});

describe('soundfont data guard', () => {
  it('accepts an instrument file as the loader evaluates it', () => {
    const file = "console.log('load _tone_x');\nvar _tone_x={\n\tzones:[{midi:32,originalPitch:-3800,file:'SUQz'\n//comment\n}]\n};\n";
    expect(isPlainData(file)).toBe(true);
  });

  it.each([
    ['a call', "var x={zones:[{file:fetch('x')}]};"],
    ['a function', 'var x={zones(){ return 1 }};'],
    ['a variable', 'var x={zones:process};'],
    ['code after the data', "var x={zones:[]};require('fs')"],
    ['no data at all', "console.log('x')"],
  ])('refuses %s', (_, file) => {
    expect(isPlainData(file)).toBe(false);
  });
});

describe('renderCode', () => {
  it('renders synth notes where the pattern puts them', async () => {
    const rendered = await renderCode('note("c3 e3 g3 b3").s("sawtooth")', { cycles: 1 });
    expect(rendered.channels).toHaveLength(2);
    expect(rendered.channels[0].length).toBe(2 * RATE); // one cycle at the default 0.5 cycles per second
    expect(rendered.errors).toEqual([]);
    const report = reportRender(rendered);
    expect(report.stats.peakDb).toBeGreaterThan(-30);
    expect(report.stats.peakDb).toBeLessThan(0);
    expect(report.onsets).toMatchObject({ expected: 4, matched: 4 });
  }, 30_000);

  it('follows the tempo the code sets', async () => {
    const rendered = await renderCode('setcpm(60)\nnote("c3").s("sine")', { cycles: 2 });
    expect(rendered.cps).toBe(1);
    expect(rendered.channels[0].length).toBe(2 * RATE);
  }, 30_000);

  it('renders reverb tails and worklet effects', async () => {
    const tailRms = async (code: string) => {
      const { channels } = await renderCode(code, { cycles: 1 });
      const last = channels[0].subarray((channels[0].length * 3) / 4);
      return Math.sqrt(last.reduce((s, x) => s + x * x, 0) / last.length);
    };
    const dry = await tailRms('note("c3 ~ ~ ~").s("square")');
    const wet = await tailRms('note("c3 ~ ~ ~").s("square").room(0.9).size(4)');
    expect(wet).toBeGreaterThan(dry * 10 + 1e-4);
    const crushed = await renderCode('note("c3").s("sine").crush(4)', { cycles: 1 });
    expect(analyse(crushed.channels, crushed.sampleRate).peakDb).toBeGreaterThan(-30);
  }, 60_000);

  it('reports a sound that does not exist', async () => {
    const rendered = await renderCode('s("no_such_sound")', { cycles: 1 });
    expect(rendered.errors.join('\n')).toMatch(/no_such_sound not found/);
    expect(reportRender(rendered).warnings.join('\n')).toMatch(/silent/);
  }, 30_000);

  it('refuses renders over the length limit', async () => {
    await expect(renderCode('s("bd")', { cycles: 10, maxSeconds: 5 })).rejects.toThrow(/longer than the 5 s limit/);
  }, 30_000);

  // Loads the soundfont loader from the pinned Strudel source and the instrument from its host on first run.
  it('renders General MIDI soundfont instruments', async () => {
    const rendered = await renderCode('note("c4 e4 g4 c5").s("gm_piano")', { cycles: 1 });
    expect(rendered.errors).toEqual([]);
    const report = reportRender(rendered);
    expect(report.stats.peakDb).toBeGreaterThan(-30);
    expect(report.onsets).toMatchObject({ expected: 4, matched: 4 });
  }, 120_000);

  it('rejects code that does not evaluate', async () => {
    await expect(renderCode('nonsense("bd")', { cycles: 1 })).rejects.toThrow(/nonsense/);
  }, 30_000);
});
