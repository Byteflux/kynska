// Lists the events (haps) a Strudel pattern produces. This is how an agent checks
// a pattern without listening to it.
import { evaluateCode, type Language } from './evaluate.ts';
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
  withValue(f: (value: unknown) => unknown): Hap;
};

/**
 * Upstream's show() serializes the value with JSON.stringify, which throws on a
 * control holding a pattern or fraction (BigInt inside), as from
 * `.set({ sustain: "<0 0.1>" })`, where the string is not parsed. Such a
 * control is shown by its type, e.g. `sustain:<Pattern>`, so the event still lists.
 */
function showHap(hap: Hap): string {
  try {
    return hap.show(true);
  } catch {
    const plain = (v: unknown): unknown => {
      if (typeof v === 'bigint') return String(v);
      if (v && typeof v === 'object') {
        // The upstream build is minified, so tell values apart by shape, not class name.
        if (typeof (v as any).queryArc === 'function') return '<Pattern>';
        if (typeof (v as any).toFraction === 'function') return (v as any).toFraction();
        if (Array.isArray(v)) return v.map(plain);
        if (Object.getPrototypeOf(v) !== Object.prototype) return '<object>';
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
      }
      return v;
    };
    return hap.withValue(plain).show(true);
  }
}

/** The events that start within `cycles` cycles of `pattern`, from cycle `from`. */
export function eventsOf(pattern: any, cycles = 1, from = 0): PatternEvent[] {
  if (!(cycles > 0)) throw new RangeError(`cycles must be positive, got ${cycles}`);
  if (!(from >= 0)) throw new RangeError(`from must be zero or more, got ${from}`);
  if (!pattern?.queryArc) throw new Error('The code did not evaluate to a pattern.');
  const haps: Hap[] = pattern.sortHapsByPart().queryArc(from, from + cycles);
  // Keep only events that start inside the window, so an event spanning the
  // window's edge is counted once.
  return haps
    .filter((hap) => hap.hasOnset())
    .map((hap) => ({
      begin: hap.whole!.begin.toFraction(),
      end: hap.whole!.end.toFraction(),
      value: hap.value,
      show: showHap(hap),
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
export async function runPattern(code: string, cycles = 1, language: Language = 'js', from = 0): Promise<PatternRun> {
  if (!(cycles > 0)) throw new RangeError(`cycles must be positive, got ${cycles}`);
  const { pattern, error, cps, logs } = await evaluateCode(code, language);
  if (error) throw error;
  const events = await captureConsole(logs, async () => eventsOf(pattern, cycles, from));
  return { events, cps, messages: engineMessages(logs) };
}

export async function queryEvents(code: string, cycles = 1, language: Language = 'js'): Promise<PatternEvent[]> {
  return (await runPattern(code, cycles, language)).events;
}
