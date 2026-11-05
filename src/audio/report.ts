// What `kynska render` and `kynska analyse` report: measurements of the audio,
// plus whether sound starts where the pattern's events do.
import { analyse, detectOnsets, matchOnsets, type AudioStats, type OnsetCheck } from './analyse.ts';
import type { Rendered } from './render.ts';

export type RenderReport = {
  file?: string;
  cps: number;
  cycles: number;
  events: number;
  stats: AudioStats;
  onsets: OnsetCheck;
  errors: string[];
  warnings: string[];
};

const seconds = (fraction: string) => {
  const [n, d = '1'] = fraction.split('/');
  return Number(n) / Number(d);
};

export function reportRender(rendered: Rendered, file?: string): RenderReport {
  const stats = analyse(rendered.channels, rendered.sampleRate);
  const onsets = matchOnsets(
    detectOnsets(rendered.channels, rendered.sampleRate),
    rendered.events.map((e) => seconds(e.begin) / rendered.cps),
  );
  const warnings = [...rendered.warnings];
  if (rendered.events.length && stats.peakDb === -Infinity) warnings.push('The render is silent although the pattern has events.');
  if (stats.clippedSamples) warnings.push(`${stats.clippedSamples} samples clip at full scale; lower the gain.`);
  return {
    ...(file ? { file } : {}),
    cps: rendered.cps,
    cycles: rendered.cycles,
    events: rendered.events.length,
    stats,
    onsets,
    errors: rendered.errors,
    warnings,
  };
}

const fmtDb = (x: number) => (x === -Infinity ? '-inf' : x.toFixed(1));

export function formatStats(stats: AudioStats): string {
  const loudness = stats.loudnessLufs === null ? 'too short or quiet to measure' : `${stats.loudnessLufs.toFixed(1)} LUFS`;
  return [
    `Length ${stats.duration.toFixed(2)} s, ${stats.sampleRate} Hz, ${stats.channels === 2 ? 'stereo' : `${stats.channels} channels`}`,
    `Level: peak ${fmtDb(stats.peakDb)} dBFS, RMS ${fmtDb(stats.rmsDb)} dBFS, loudness ${loudness}`,
    `${stats.clippedSamples} clipped samples, DC offset ${stats.dcOffset.toFixed(4)}, ${Math.round(stats.silentShare * 100)}% silent`,
  ].join('\n');
}

export function formatReport(report: RenderReport): string {
  const lines: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (report.file) {
    lines.push(`Wrote ${report.file}: ${plural(report.cycles, 'cycle')} at ${+report.cps.toFixed(4)} cycles per second, ${plural(report.events, 'event')}`);
  }
  lines.push(formatStats(report.stats));
  const { onsets } = report;
  const missing = onsets.missing.length ? `; no sound starts at ${onsets.missing.slice(0, 8).map((t) => `${t.toFixed(3)} s`).join(', ')}${onsets.missing.length > 8 ? ', ...' : ''}` : '';
  lines.push(
    `Onsets: sound starts at ${onsets.matched} of ${onsets.expected} event times${missing}; ${onsets.extra.length} onset${onsets.extra.length === 1 ? '' : 's'} with no event`,
  );
  for (const e of report.errors) lines.push(`error: ${e}`);
  for (const w of report.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}
