// What `kynska render` and `kynska analyse` report: measurements of the audio,
// per section when asked, plus whether sound starts where the pattern's events do.
import type { Section } from '../patterns/sections.ts';
import { analyse, detectOnsets, matchOnsets, type AudioStats, type OnsetCheck } from './analyse.ts';
import type { Rendered } from './render.ts';

export type SectionStats = Section & Pick<AudioStats, 'peakDb' | 'rmsDb' | 'loudnessLufs' | 'silentShare'>;

export type RenderReport = {
  file?: string;
  cps: number;
  /** First rendered cycle. */
  from: number;
  cycles: number;
  events: number;
  stats: AudioStats;
  /** The cycle the peak falls in, e.g. 23.0 for the downbeat of cycle 23. */
  peakCycle: number;
  onsets: OnsetCheck;
  /**
   * False when the audio is too dense to tell onsets apart (reverb, delay,
   * noise and overlapping layers all read as onsets); measure layers alone instead.
   */
  onsetsChecked: boolean;
  sections?: SectionStats[];
  errors: string[];
  warnings: string[];
};

const seconds = (fraction: string) => {
  const [n, d = '1'] = fraction.split('/');
  return Number(n) / Number(d);
};

/** Onsets mean something only when most detected onsets belong to an event. */
export const onsetsReadable = (onsets: OnsetCheck) => onsets.extra.length <= onsets.expected / 2 + 10;

/** Level and loudness of each section that overlaps the audio, which starts at cycle `from`. */
export function sectionStats(channels: Float32Array[], sampleRate: number, cps: number, from: number, sections: Section[]): SectionStats[] {
  const frames = channels[0]?.length ?? 0;
  const end = from + (frames / sampleRate) * cps;
  const out: SectionStats[] = [];
  for (const section of sections) {
    const a = Math.max(section.from, from);
    const b = Math.min(section.to, end);
    if (b <= a) continue;
    const [i, j] = [a, b].map((c) => Math.round(((c - from) / cps) * sampleRate));
    const { peakDb, rmsDb, loudnessLufs, silentShare } = analyse(channels.map((ch) => ch.subarray(i, j)), sampleRate);
    out.push({ ...section, peakDb, rmsDb, loudnessLufs, silentShare });
  }
  return out;
}

export function reportRender(rendered: Rendered, file?: string, sections?: Section[]): RenderReport {
  const stats = analyse(rendered.channels, rendered.sampleRate);
  const onsets = matchOnsets(
    detectOnsets(rendered.channels, rendered.sampleRate),
    rendered.events.map((e) => (seconds(e.begin) - rendered.from) / rendered.cps),
  );
  const warnings = [...rendered.warnings];
  if (rendered.events.length && stats.peakDb === -Infinity) warnings.push('The render is silent although the pattern has events.');
  if (stats.clippedSamples) warnings.push(`${stats.clippedSamples} samples clip at full scale; lower the gain.`);
  return {
    ...(file ? { file } : {}),
    cps: rendered.cps,
    from: rendered.from,
    cycles: rendered.cycles,
    events: rendered.events.length,
    stats,
    peakCycle: rendered.from + stats.peakAt * rendered.cps,
    onsets,
    onsetsChecked: onsetsReadable(onsets),
    ...(sections ? { sections: sectionStats(rendered.channels, rendered.sampleRate, rendered.cps, rendered.from, sections) } : {}),
    errors: rendered.errors,
    warnings,
  };
}

export const fmtDb = (x: number) => (x === -Infinity ? '-inf' : x.toFixed(1));
export const fmtLufs = (x: number | null) => (x === null ? '—' : x.toFixed(1));

/** `peakCycle`, when known, says which cycle the peak is in. */
export function formatStats(stats: AudioStats, peakCycle?: number): string {
  const loudness = stats.loudnessLufs === null ? 'too short or quiet to measure' : `${stats.loudnessLufs.toFixed(1)} LUFS`;
  const at = stats.peakDb === -Infinity ? '' : ` at ${stats.peakAt.toFixed(2)} s${peakCycle === undefined ? '' : ` (cycle ${peakCycle.toFixed(2)})`}`;
  return [
    `Length ${stats.duration.toFixed(2)} s, ${stats.sampleRate} Hz, ${stats.channels === 2 ? 'stereo' : `${stats.channels} channels`}`,
    `Level: peak ${fmtDb(stats.peakDb)} dBFS${at}, RMS ${fmtDb(stats.rmsDb)} dBFS, loudness ${loudness}`,
    `${stats.clippedSamples} clipped samples, DC offset ${stats.dcOffset.toFixed(4)}, ${Math.round(stats.silentShare * 100)}% silent`,
  ].join('\n');
}

/** A table: one row per section, in cycles. */
export function formatSections(sections: SectionStats[]): string {
  const width = Math.max(7, ...sections.map((s) => s.name.length));
  const rows = sections.map(
    (s) =>
      `  ${s.name.padEnd(width)}  ${`${s.from}-${s.to - 1}`.padEnd(7)}  ${fmtDb(s.peakDb).padStart(6)}  ${fmtDb(s.rmsDb).padStart(6)}  ${fmtLufs(s.loudnessLufs).padStart(6)}  ${`${Math.round(s.silentShare * 100)}%`.padStart(6)}`,
  );
  return [`By section:`, `  ${'section'.padEnd(width)}  cycles      peak     RMS    LUFS  silent`, ...rows].join('\n');
}

/** One line on onsets: matched against the events, or why they were not checked. */
export function formatOnsets(onsets: OnsetCheck, checked: boolean): string {
  if (!checked) {
    return `Onsets: not checked: too dense to tell apart (${onsets.matched + onsets.extra.length} detected for ${onsets.expected} events); --layers checks each layer alone`;
  }
  const missing = onsets.missing.length ? `; no sound starts at ${onsets.missing.slice(0, 8).map((t) => `${t.toFixed(3)} s`).join(', ')}${onsets.missing.length > 8 ? ', ...' : ''}` : '';
  return `Onsets: sound starts at ${onsets.matched} of ${onsets.expected} event times${missing}; ${onsets.extra.length} onset${onsets.extra.length === 1 ? '' : 's'} with no event`;
}

export function formatReport(report: RenderReport): string {
  const lines: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (report.file) {
    const span = report.from ? `cycles ${report.from}-${report.from + report.cycles} (${plural(report.cycles, 'cycle')})` : plural(report.cycles, 'cycle');
    lines.push(`Wrote ${report.file}: ${span} at ${+report.cps.toFixed(4)} cycles per second, ${plural(report.events, 'event')}`);
  }
  lines.push(formatStats(report.stats, report.peakCycle));
  lines.push(formatOnsets(report.onsets, report.onsetsChecked));
  if (report.sections?.length) lines.push(formatSections(report.sections));
  for (const e of report.errors) lines.push(`error: ${e}`);
  for (const w of report.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}
