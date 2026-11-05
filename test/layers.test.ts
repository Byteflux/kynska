import { describe, expect, it } from 'vitest';
import { formatLayers, renderLayers } from '../src/audio/layers.ts';
import { renderCode } from '../src/audio/render.ts';
import { formatOnsets, formatSections, onsetsReadable, reportRender, sectionStats } from '../src/audio/report.ts';
import { queryEvents, runPattern } from '../src/patterns/events.ts';
import { formatForm, formOf, pitchClass } from '../src/patterns/form.ts';
import { findLayers, playingLayers, ranges, soloLayer } from '../src/patterns/layers.ts';
import { parseSections, windowOf } from '../src/patterns/sections.ts';

const PIECE = `setcpm(60)
$: s("bd*2")
bass: note("<c2 eb2>").s("sawtooth")
_$: s("hh*8")
$: note("g4").s("sine").mask("<0 1>")`;

describe('layers', () => {
  it('finds labelled layers in source order, with mutes', () => {
    const layers = findLayers(PIECE);
    expect(layers.map((l) => [l.index, l.label, l.line, l.muted])).toEqual([
      [1, '$', 2, false],
      [2, 'bass', 3, false],
      [3, '_$', 4, true],
      [4, '$', 5, false],
    ]);
    expect(playingLayers(layers).map((l) => l.index)).toEqual([1, 2, 4]);
    expect(findLayers('s("bd")')).toEqual([]);
    expect(findLayers('$: s("bd"')).toEqual([]);
  });

  it('plays only the soloed labels when any label solos', () => {
    const layers = findLayers('$: s("bd")\nS$: s("hh")');
    expect(playingLayers(layers).map((l) => l.label)).toEqual(['S$']);
  });

  it('solos a layer by muting every other label', async () => {
    const layers = findLayers(PIECE);
    const bass = await queryEvents(soloLayer(PIECE, layers[1], layers), 2);
    expect(bass.map((e) => (e.value as any).note)).toEqual(['c2', 'eb2']);
    const kick = await queryEvents(soloLayer(PIECE, layers[0], layers), 1);
    expect(kick.map((e) => (e.value as any).s)).toEqual(['bd', 'bd']);
  });

  it('writes whole numbers as ranges', () => {
    expect(ranges([5, 0, 1, 2, 7, 8])).toBe('0-2, 5, 7-8');
    expect(ranges([])).toBe('');
  });
});

describe('sections and windows', () => {
  it('reads section lengths, named or not', () => {
    expect(parseSections('intro=4, A=16')).toEqual([
      { name: 'intro', from: 0, to: 4 },
      { name: 'A', from: 4, to: 20 },
    ]);
    expect(parseSections('2,3').map((s) => [s.name, s.from, s.to])).toEqual([
      ['1', 0, 2],
      ['2', 2, 5],
    ]);
    expect(() => parseSections('intro=0')).toThrow(/positive length/);
    expect(() => parseSections('')).toThrow(/at least one/);
  });

  it('picks the cycles to render', () => {
    const sections = parseSections('a=4,b=8');
    expect(windowOf({}, 4)).toEqual({ from: 0, cycles: 4 });
    expect(windowOf({}, 4, sections)).toEqual({ from: 0, cycles: 12 });
    expect(windowOf({ from: 4, to: 6 }, 4, sections)).toEqual({ from: 4, cycles: 2 });
    expect(windowOf({ from: 2 }, 4, sections)).toEqual({ from: 2, cycles: 4 });
    expect(() => windowOf({ from: 4, to: 4 }, 4)).toThrow(/after from/);
    expect(() => windowOf({ to: 2, cycles: 2 }, 4)).toThrow(/not both/);
  });

  it('lists events from a later cycle', async () => {
    const { events } = await runPattern('s("<bd sd hh>")', 1, 'js', 2);
    expect(events.map((e) => [e.begin, (e.value as any).s])).toEqual([['2', 'hh']]);
  });
});

describe('form', () => {
  it('names note pitch classes from names and MIDI numbers', () => {
    expect(pitchClass({ note: 'Bb2' })).toBe('Bb');
    expect(pitchClass({ note: 'c#4' })).toBe('C#');
    expect(pitchClass({ note: 'fs3' })).toBe('F#');
    expect(pitchClass({ note: 70 })).toBe('A#');
    expect(pitchClass({ s: 'bd' })).toBeUndefined();
  });

  it('says which layer plays where, per section, and the notes each section uses', async () => {
    const form = await formOf(PIECE, 2, 'js', parseSections('one=1,two=1'));
    expect(form.cps).toBe(1);
    expect(form.layers.map((l) => [l.name, l.sounds, l.cycles, l.perSection])).toEqual([
      ['1 $: line 2', ['bd'], '0-1', [2, 2]],
      ['2 bass: line 3', ['sawtooth'], '0-1', [1, 1]],
      ['4 $: line 5', ['sine'], '1', [0, 1]],
    ]);
    expect(form.sections!.map((s) => s.notes)).toEqual([{ C: 1 }, { Eb: 1, G: 1 }]);
    const text = formatForm(form);
    expect(text).toContain('Form over 2 cycles (1.00 s each)');
    expect(text).toMatch(/4 sine\s+·\s+1/);
    expect(text).toContain('two    Eb×1 G×1');
  });

  it('treats unlabelled code as one layer', async () => {
    const form = await formOf('s("bd sd")', 1);
    expect(form.layers).toEqual([{ name: 'all', sounds: ['bd', 'sd'], events: 2, cycles: '0' }]);
  });
});

describe('measuring by section and layer', () => {
  const RATE = 8000;
  const tone = (seconds: number, amplitude: number) =>
    Float32Array.from({ length: seconds * RATE }, (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE));

  it('measures each section of the audio, in cycles', () => {
    // Cycles 2-6 at 1 cycle per second: one silent second, then three of tone.
    const audio = Float32Array.from([...new Float32Array(RATE), ...tone(3, 0.5)]);
    const stats = sectionStats([audio, audio], RATE, 1, 2, parseSections('before=2,quiet=1,loud=3,after=4'));
    expect(stats.map((s) => s.name)).toEqual(['quiet', 'loud']);
    expect(stats[0].peakDb).toBe(-Infinity);
    expect(stats[0].silentShare).toBe(1);
    expect(stats[1].peakDb).toBeCloseTo(20 * Math.log10(0.5), 1);
    expect(stats[1].loudnessLufs).not.toBeNull();
    expect(formatSections(stats)).toMatch(/quiet\s+2-2\s+-inf\s+-inf\s+—\s+100%/);
  });

  it('does not read onsets out of a dense mix', () => {
    const onsets = { expected: 100, matched: 98, missing: [1, 2], extra: Array.from({ length: 400 }, (_, i) => i) };
    expect(onsetsReadable(onsets)).toBe(false);
    expect(formatOnsets(onsets, false)).toMatch(/not checked: too dense .*498 detected for 100 events/);
    expect(onsetsReadable({ ...onsets, extra: [1, 2, 3] })).toBe(true);
  });

  it('renders from a later cycle, with time 0 at that cycle', async () => {
    const rendered = await renderCode('setcpm(60)\nnote("<c3 ~ e3>").s("sine")', { from: 2, cycles: 1 });
    expect(rendered.from).toBe(2);
    expect(rendered.channels[0].length).toBe(48000);
    expect(rendered.events.map((e) => [e.begin, (e.value as any).note])).toEqual([['2', 'e3']]);
    const report = reportRender(rendered);
    expect(report.onsets.matched).toBe(1);
    expect(report.stats.peakAt).toBeLessThan(0.5);
    expect(report.peakCycle).toBeGreaterThanOrEqual(2);
  });

  it('measures each layer alone next to the mix', async () => {
    const code = 'setcpm(60)\n$: note("c3*2").s("sine").gain(0.8)\n$: note("c5*4").s("sine").gain(0.1)';
    const { mix, layers } = await renderLayers(code, { cycles: 1 }, parseSections('a=1'));
    expect(mix.events).toHaveLength(6);
    expect(layers.map((l) => [l.index, l.sounds, l.report.events])).toEqual([
      [1, ['sine'], 2],
      [2, ['sine'], 4],
    ]);
    // gain is linear: 0.1 against 0.8 is 18 dB quieter.
    const [loud, quiet] = layers.map((l) => l.report.stats.peakDb);
    expect(loud - quiet).toBeGreaterThan(14);
    const text = formatLayers(layers, reportRender(mix, undefined, parseSections('a=1')));
    expect(text).toContain('Layers, each rendered alone:');
    expect(text).toMatch(/Loudness by section[\s\S]*mix[\s\S]*1 sine[\s\S]*2 sine/);
  });

  it('has nothing to split in code with one layer', async () => {
    const { layers } = await renderLayers('note("c3").s("sine")', { cycles: 1 });
    expect(layers).toEqual([]);
    expect(formatLayers(layers)).toMatch(/fewer than two playing layers/);
  });
});
