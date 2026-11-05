// Compares the events two versions of a pattern produce, to confirm a change did
// what it meant to and nothing else.
import { queryEvents, type PatternEvent } from './events.ts';

export type EventChange = { before: PatternEvent; after: PatternEvent };

export type EventDiff = {
  same: boolean;
  /** Same timing, different value (e.g. another sound or note). */
  changed: EventChange[];
  /** Only in the first version. */
  removed: PatternEvent[];
  /** Only in the second version. */
  added: PatternEvent[];
  unchanged: number;
};

/** JSON with object keys sorted, so equal values compare equal. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

const timing = (e: PatternEvent) => `${e.begin}|${e.end}`;
const key = (e: PatternEvent) => `${timing(e)}|${stable(e.value)}`;

function fractionValue(f: string): number {
  const [n, d = '1'] = f.split('/');
  return Number(n) / Number(d);
}

const byTime = (a: PatternEvent, b: PatternEvent) =>
  fractionValue(a.begin) - fractionValue(b.begin) || fractionValue(a.end) - fractionValue(b.end) || stable(a.value).localeCompare(stable(b.value));

export function diffEvents(before: PatternEvent[], after: PatternEvent[]): EventDiff {
  // Match identical events first (as multisets), then pair leftovers that share timing.
  const pending = new Map<string, PatternEvent[]>();
  for (const e of after) pending.set(key(e), [...(pending.get(key(e)) ?? []), e]);
  let unchanged = 0;
  const removedCandidates: PatternEvent[] = [];
  for (const e of before) {
    const match = pending.get(key(e));
    if (match?.length) {
      match.pop();
      unchanged++;
    } else {
      removedCandidates.push(e);
    }
  }
  const addedCandidates = [...pending.values()].flat();

  const addedByTiming = new Map<string, PatternEvent[]>();
  for (const e of addedCandidates) addedByTiming.set(timing(e), [...(addedByTiming.get(timing(e)) ?? []), e]);
  const changed: EventChange[] = [];
  const removed: PatternEvent[] = [];
  for (const e of removedCandidates.sort(byTime)) {
    const partner = addedByTiming.get(timing(e))?.shift();
    if (partner) changed.push({ before: e, after: partner });
    else removed.push(e);
  }
  const added = [...addedByTiming.values()].flat().sort(byTime);
  return { same: !changed.length && !removed.length && !added.length, changed, removed, added, unchanged };
}

export async function diffCode(before: string, after: string, cycles = 1): Promise<EventDiff> {
  return diffEvents(await queryEvents(before, cycles), await queryEvents(after, cycles));
}

const valueText = (e: PatternEvent) => e.show.replace(/^\[ [^|]*\| /, '').replace(/ \]$/, '');
const timeText = (e: PatternEvent) => `${e.begin} → ${e.end}`;

/** A readable report: one line per difference, then a summary. */
export function formatDiff(diff: EventDiff, cycles: number): string {
  const lines: string[] = [];
  const rows = [
    ...diff.changed.map((c) => ({ at: c.before, text: `~ ${timeText(c.before)}  ${valueText(c.before)}  →  ${valueText(c.after)}` })),
    ...diff.removed.map((e) => ({ at: e, text: `- ${timeText(e)}  ${valueText(e)}` })),
    ...diff.added.map((e) => ({ at: e, text: `+ ${timeText(e)}  ${valueText(e)}` })),
  ].sort((a, b) => byTime(a.at, b.at));
  for (const row of rows) lines.push(row.text);
  const summary = diff.same
    ? `No differences in ${cycles} cycle${cycles === 1 ? '' : 's'} (${diff.unchanged} events).`
    : `${diff.changed.length} changed, ${diff.removed.length} removed, ${diff.added.length} added, ${diff.unchanged} unchanged in ${cycles} cycle${cycles === 1 ? '' : 's'}.`;
  lines.push(summary);
  return lines.join('\n');
}
