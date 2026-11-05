// Sections of a piece in cycles, written as their lengths in order, the way
// arrange() takes them: "intro=4,A=16,B=12,outro=8", or "4,16,12,8".

export type Section = { name: string; /** First cycle. */ from: number; /** End cycle (exclusive). */ to: number };

export function parseSections(spec: string): Section[] {
  const parts = spec.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new RangeError('sections need at least one length, e.g. "intro=4,A=16"');
  let at = 0;
  return parts.map((part, i) => {
    const [name, length] = part.includes('=') ? part.split('=').map((s) => s.trim()) : [String(i + 1), part];
    const cycles = Number(length);
    if (!name || !(cycles > 0)) throw new RangeError(`section "${part}" needs a positive length in cycles, e.g. "intro=4"`);
    const section = { name, from: at, to: at + cycles };
    at += cycles;
    return section;
  });
}

/**
 * Which cycles to render or list: `from` to `to`, or `cycles` from `from`; with
 * sections and none of these, all of the sections; otherwise `fallback` cycles.
 */
export function windowOf(
  given: { from?: number; to?: number; cycles?: number },
  fallback: number,
  sections?: Section[],
): { from: number; cycles: number } {
  const from = given.from ?? 0;
  if (!(from >= 0)) throw new RangeError(`from must be a cycle, zero or more, got ${given.from}`);
  if (given.to !== undefined) {
    if (given.cycles !== undefined) throw new RangeError('give to or cycles, not both');
    if (!(given.to > from)) throw new RangeError(`to must be after from, got ${given.to}`);
    return { from, cycles: given.to - from };
  }
  const cycles = given.cycles ?? (sections && given.from === undefined ? sections[sections.length - 1].to : fallback);
  if (!(cycles > 0)) throw new RangeError(`cycles must be positive, got ${given.cycles}`);
  return { from, cycles };
}

/** "intro 0-3" for whole cycles 0 to 3. */
export const sectionLabel = (s: Section) => `${s.name} ${s.from}-${s.to - 1}`;
