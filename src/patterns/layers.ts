// The layers of a piece: Strudel turns each labelled statement (`$: ...`,
// `bass: ...`) into a pattern of its own and plays them stacked. A label that
// starts or ends with `_` mutes its layer; labels starting with `S` solo. To
// hear or measure one layer alone, every other layer's label gets a `_`.
import { parse, type Node } from 'acorn';
import { simple } from 'acorn-walk';

export type Layer = {
  /** 1-based, in source order. */
  index: number;
  /** The label as written, e.g. "$" or "bass". */
  label: string;
  /** Line of the label in the source. */
  line: number;
  /** Muted in the source (`_$:`, `bass_:`): Strudel does not play it. */
  muted: boolean;
  /** Offset of the label in the source. */
  start: number;
};

const isMuted = (label: string) => label.startsWith('_') || label.endsWith('_');

/** The labelled layers of JavaScript Strudel code, in source order; [] when the code does not parse. */
export function findLayers(code: string): Layer[] {
  let ast: Node;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true });
  } catch {
    return [];
  }
  const found: Omit<Layer, 'index'>[] = [];
  simple(ast, {
    LabeledStatement(node: any) {
      if (node.body?.type !== 'ExpressionStatement') return;
      found.push({ label: node.label.name, line: node.loc.start.line, muted: isMuted(node.label.name), start: node.label.start });
    },
  });
  return found.sort((a, b) => a.start - b.start).map((layer, i) => ({ ...layer, index: i + 1 }));
}

/** The layers Strudel plays: not muted, and only the soloed ones when any label solos. */
export function playingLayers(layers: Layer[]): Layer[] {
  const unmuted = layers.filter((l) => !l.muted);
  const soloed = unmuted.filter((l) => l.label.length > 1 && l.label.startsWith('S'));
  return soloed.length ? soloed : unmuted;
}

/** The code with every layer but `layer` muted, so it plays alone. */
export function soloLayer(code: string, layer: Layer, layers: Layer[]): string {
  let out = code;
  for (const other of [...layers].sort((a, b) => b.start - a.start)) {
    if (other.start === layer.start || other.muted) continue;
    out = `${out.slice(0, other.start)}_${out.slice(other.start)}`;
  }
  return out;
}

/** "1 $: line 31", "2 bass: line 40". */
export const layerName = (layer: Layer) => `${layer.index} ${layer.label}: line ${layer.line}`;

/** Sounds the events play: their `s` values, or "synth" for notes with no sound named. */
export function soundsOf(values: unknown[]): string[] {
  const sounds = new Set<string>();
  for (const v of values) {
    if (!v || typeof v !== 'object') continue;
    const s = (v as Record<string, unknown>).s;
    if (typeof s === 'string') sounds.add(s);
    else if ('note' in v || 'freq' in v || 'n' in v) sounds.add('synth');
  }
  return [...sounds];
}

/** Whole numbers as ranges: [0,1,2,5] → "0-2, 5". */
export function ranges(numbers: Iterable<number>): string {
  const xs = [...new Set(numbers)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && last[1] === x - 1) last[1] = x;
    else out.push([x, x]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

/** Runs `job` over `items`, at most `limit` at a time, keeping the order. */
export async function pool<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await job(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
