// The form of a piece from its events: which layer plays which sounds in which
// cycles, how many events each layer has per section, and the note names each
// section uses. This proves an arrangement without listening to it.
import type { Language } from './evaluate.ts';
import { runPattern, type PatternEvent } from './events.ts';
import { findLayers, layerName, playingLayers, ranges, soloLayer, soundsOf } from './layers.ts';
import type { Section } from './sections.ts';

export type FormLayer = {
  name: string;
  sounds: string[];
  events: number;
  /** Whole cycles in which the layer starts an event, as ranges: "4-35". */
  cycles: string;
  /** Events per section, when sections are given. */
  perSection?: number[];
};

export type FormReport = {
  cycles: number;
  cps: number;
  layers: FormLayer[];
  sections?: (Section & { notes: Record<string, number> })[];
};

const begin = (e: PatternEvent) => {
  const [n, d = '1'] = e.begin.split('/');
  return Number(n) / Number(d);
};

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The note name without octave: "Bb2" → "Bb", 70 → "A#"; undefined for events with no note. */
export function pitchClass(value: unknown): string | undefined {
  const note = (value as Record<string, unknown> | null)?.note;
  if (typeof note === 'number' && Number.isFinite(note)) return NAMES[((Math.round(note) % 12) + 12) % 12];
  if (typeof note !== 'string') return undefined;
  const m = /^([a-gA-G])([#sb]*)/.exec(note);
  return m ? m[1].toUpperCase() + m[2].replace(/s/g, '#') : undefined;
}

function describe(name: string, events: PatternEvent[], sections?: Section[]): FormLayer {
  return {
    name,
    sounds: soundsOf(events.map((e) => e.value)),
    events: events.length,
    cycles: ranges(events.map((e) => Math.floor(begin(e) + 1e-9))),
    ...(sections ? { perSection: sections.map((s) => events.filter((e) => begin(e) >= s.from && begin(e) < s.to).length) } : {}),
  };
}

export async function formOf(code: string, cycles: number, language: Language = 'js', sections?: Section[]): Promise<FormReport> {
  const mix = await runPattern(code, cycles, language);
  const all = language === 'mondo' ? [] : findLayers(code);
  const playing = playingLayers(all);
  // One after another: each evaluation installs its own Pattern.prototype.p, which
  // collects the labelled layers, so concurrent evaluations would mix them up.
  const layers: FormLayer[] = [];
  if (playing.length > 1) {
    for (const l of playing) layers.push(describe(layerName(l), (await runPattern(soloLayer(code, l, all), cycles, language)).events, sections));
  } else {
    layers.push(describe('all', mix.events, sections));
  }
  return {
    cycles,
    cps: mix.cps,
    layers,
    ...(sections
      ? {
          sections: sections.map((s) => {
            const notes: Record<string, number> = {};
            for (const e of mix.events) {
              const pc = begin(e) >= s.from && begin(e) < s.to ? pitchClass(e.value) : undefined;
              if (pc) notes[pc] = (notes[pc] ?? 0) + 1;
            }
            return { ...s, notes };
          }),
        }
      : {}),
  };
}

export function formatForm(form: FormReport): string {
  const head = (l: FormLayer) => `${l.name}  ${l.sounds.join(' ') || '(silent)'}`;
  const width = Math.max(5, ...form.layers.map((l) => head(l).length));
  const lines = [
    `Form over ${form.cycles} cycles (${(1 / form.cps).toFixed(2)} s each):`,
    ...form.layers.map((l) => `  ${head(l).padEnd(width)}  ${l.events ? `cycles ${l.cycles}` : 'no events'}  (${l.events} events)`),
  ];
  if (form.sections) {
    // Rows by number and sounds: "1 bd", "2 sd rim".
    const short = (l: FormLayer) => (l.name === 'all' ? 'all' : `${l.name.split(' ')[0]} ${l.sounds.join(' ')}`);
    const col = Math.max(5, ...form.sections.map((s) => s.name.length));
    const rowWidth = Math.max(6, ...form.layers.map((l) => short(l).length));
    lines.push('Events by section (· is none):');
    lines.push(`  ${''.padEnd(rowWidth)}  ${form.sections.map((s) => s.name.padStart(col)).join('  ')}`);
    lines.push(`  ${'cycles'.padEnd(rowWidth)}  ${form.sections.map((s) => `${s.from}-${s.to - 1}`.padStart(col)).join('  ')}`);
    for (const l of form.layers) lines.push(`  ${short(l).padEnd(rowWidth)}  ${l.perSection!.map((n) => (n ? String(n) : '·').padStart(col)).join('  ')}`);
    lines.push('Notes by section (name × events):');
    for (const s of form.sections) {
      const notes = Object.entries(s.notes).sort((a, b) => a[0].localeCompare(b[0]));
      lines.push(`  ${s.name.padEnd(col)}  ${notes.length ? notes.map(([n, c]) => `${n}×${c}`).join(' ') : 'none'}`);
    }
  }
  return lines.join('\n');
}
