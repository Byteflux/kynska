// Measures each layer of a piece on its own: the mix, then every playing layer
// rendered alone (its label kept, every other label muted), a few at a time.
import { availableParallelism } from 'node:os';
import { findLayers, layerName, playingLayers, pool, soloLayer, soundsOf, type Layer } from '../patterns/layers.ts';
import type { Section } from '../patterns/sections.ts';
import { renderCode, type Rendered, type RenderOptions } from './render.ts';
import { fmtDb, fmtLufs, reportRender, type RenderReport } from './report.ts';

export type LayerReport = Layer & { name: string; sounds: string[]; report: RenderReport };

export type LayersResult = {
  mix: Rendered;
  /** Empty when the code has fewer than two playing layers. */
  layers: LayerReport[];
};

/** Renders at most this many at once: each render keeps about one CPU busy. */
const PARALLEL = Math.max(1, Math.min(3, availableParallelism() - 1));

export async function renderLayers(code: string, options: RenderOptions = {}, sections?: Section[], concurrency = PARALLEL): Promise<LayersResult> {
  const all = options.language === 'mondo' ? [] : findLayers(code);
  const playing = playingLayers(all);
  const jobs: (Layer | undefined)[] = [undefined, ...(playing.length > 1 ? playing : [])];
  const rendered = await pool(jobs, concurrency, (layer) => renderCode(layer ? soloLayer(code, layer, all) : code, options));
  const [mix, ...alone] = rendered;
  return {
    mix,
    layers: alone.map((r, i) => {
      const layer = jobs[i + 1]!;
      return { ...layer, name: layerName(layer), sounds: soundsOf(r.events.map((e) => e.value)), report: reportRender(r, undefined, sections) };
    }),
  };
}

const onsetCell = (r: RenderReport) =>
  r.onsetsChecked ? `${r.onsets.matched}/${r.onsets.expected}${r.onsets.extra.length ? ` +${r.onsets.extra.length}` : ''}` : 'dense';

/** A row per layer: what it plays, its level and loudness, onsets; with sections, loudness per section too. */
export function formatLayers(layers: LayerReport[], mix?: RenderReport): string {
  if (!layers.length) return 'Layers: fewer than two playing layers ($: or named labels), so nothing to measure apart.';
  const label = (l: LayerReport) => `${l.name}  ${l.sounds.join(' ') || '(silent)'}`;
  const width = Math.max(5, ...layers.map((l) => label(l).length));
  const lines = [
    'Layers, each rendered alone:',
    `  ${'layer'.padEnd(width)}    peak     RMS    LUFS  onsets (found/events +extra)`,
    ...layers.map((l) => {
      const s = l.report.stats;
      return `  ${label(l).padEnd(width)}  ${fmtDb(s.peakDb).padStart(6)}  ${fmtDb(s.rmsDb).padStart(6)}  ${fmtLufs(s.loudnessLufs).padStart(6)}  ${onsetCell(l.report)}`;
    }),
  ];
  const sections = layers[0].report.sections;
  if (sections?.length) {
    const names = sections.map((s) => s.name);
    const col = Math.max(6, ...names.map((n) => n.length));
    const rowWidth = Math.max(5, ...layers.map((l) => `${l.index} ${l.sounds.join(' ')}`.length));
    const row = (name: string, values: (number | null)[]) => `  ${name.padEnd(rowWidth)}  ${values.map((v) => fmtLufs(v).padStart(col)).join('  ')}`;
    lines.push('Loudness by section (LUFS; — is silent or under 0.4 s):');
    lines.push(`  ${'layer'.padEnd(rowWidth)}  ${names.map((n) => n.padStart(col)).join('  ')}`);
    if (mix?.sections) lines.push(row('mix', mix.sections.map((s) => s.loudnessLufs)));
    for (const l of layers) lines.push(row(`${l.index} ${l.sounds.join(' ')}`, l.report.sections!.map((s) => s.loudnessLufs)));
  }
  return lines.join('\n');
}
