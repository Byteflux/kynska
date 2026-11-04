// Evaluates Strudel code headlessly and lists the events (haps) it produces.
// This is how an agent checks a pattern without listening to it.
import { ensureScope } from './scope.ts';

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
  part: { begin: Fraction; end: Fraction };
  value: unknown;
  hasOnset(): boolean;
  show(compact?: boolean): string;
};

export async function queryEvents(code: string, cycles = 1): Promise<PatternEvent[]> {
  if (!(cycles > 0)) throw new RangeError(`cycles must be positive, got ${cycles}`);
  const { evaluate } = await ensureScope();
  const { pattern } = await evaluate(code);
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
