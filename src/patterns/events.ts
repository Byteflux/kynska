// Lists the events (haps) a Strudel pattern produces. This is how an agent checks
// a pattern without listening to it.
import { evaluateCode } from './evaluate.ts';
import { captureConsole, engineMessages } from './scope.ts';

export type PatternEvent = {
  /** Start of the event, in cycles, as an exact fraction such as "3/8". */
  begin: string;
  /** End of the event, in cycles, as an exact fraction. */
  end: string;
  /** The event's controls, e.g. { s: 'bd' } or { note: 'c3' }. */
  value: unknown;
  /** Upstream's one-line rendering, e.g. "[ 0/1 → 1/2 | note:c3 ]". */
  show: string;
};

// Minimal shapes of the upstream objects this module touches.
type Fraction = { toFraction(): string };
type Hap = {
  whole?: { begin: Fraction; end: Fraction };
  value: unknown;
  hasOnset(): boolean;
  show(compact?: boolean): string;
};

/** The events that start within the first `cycles` cycles of `pattern`. */
export function eventsOf(pattern: any, cycles = 1): PatternEvent[] {
  if (!(cycles > 0)) throw new RangeError(`cycles must be positive, got ${cycles}`);
  if (!pattern?.queryArc) throw new Error('The code did not evaluate to a pattern.');
  const haps: Hap[] = pattern.sortHapsByPart().queryArc(0, cycles);
  // Keep only events that start inside the window, so an event spanning the
  // window's edge is counted once.
  return haps
    .filter((hap) => hap.hasOnset())
    .map((hap) => ({
      begin: hap.whole!.begin.toFraction(),
      end: hap.whole!.end.toFraction(),
      value: hap.value,
      show: hap.show(true),
    }));
}

export type PatternRun = {
  events: PatternEvent[];
  /** Tempo in cycles per second. */
  cps: number;
  /** Warnings Strudel printed while evaluating or querying, e.g. about a no-op operation. */
  messages: string[];
};

/** Evaluates the code and lists its events, with Strudel's warnings collected. Throws on errors. */
export async function runPattern(code: string, cycles = 1): Promise<PatternRun> {
  if (!(cycles > 0)) throw new RangeError(`cycles must be positive, got ${cycles}`);
  const { pattern, error, cps, logs } = await evaluateCode(code);
  if (error) throw error;
  const events = await captureConsole(logs, async () => eventsOf(pattern, cycles));
  return { events, cps, messages: engineMessages(logs) };
}

export async function queryEvents(code: string, cycles = 1): Promise<PatternEvent[]> {
  return (await runPattern(code, cycles)).events;
}
