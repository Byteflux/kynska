/**
 * Edit distance where swapping two adjacent characters counts as one edit
 * (optimal string alignment), so "gian" is one edit from "gain".
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Names close to `name`, best first: a different case, a small edit distance
 * (up to a third of the length, at least 1), or a shared prefix of 3+ characters.
 */
export function suggest(name: string, candidates: Iterable<string>, limit = 3): string[] {
  const lower = name.toLowerCase();
  const maxDistance = Math.max(1, Math.floor(name.length / 3));
  const scored: [number, string][] = [];
  for (const candidate of new Set(candidates)) {
    if (candidate === name) continue;
    const c = candidate.toLowerCase();
    let score = editDistance(lower, c);
    if (score > maxDistance) {
      const prefix = lower.length >= 3 && (c.startsWith(lower) || lower.startsWith(c));
      if (!prefix) continue;
      score = maxDistance + Math.abs(c.length - lower.length) / 10;
    }
    scored.push([score, candidate]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
    .slice(0, limit)
    .map(([, candidate]) => candidate);
}
