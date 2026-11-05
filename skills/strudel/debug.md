# Debug a pattern that plays wrong

Find the **first divergence** between the events you expect and the events the code produces, then change only what causes it.

## Steps

1. **Check.** `kynska check song.js`: errors come with a line and column and suggestions for misspelt names. Warnings are often the bug itself: `engine-warning` (an operation Strudel ignored), `silent` (nothing plays).
2. **Write the expected events** for the part that is wrong: sounds or notes, and their cycle positions.
3. **Find the first divergence.** `kynska events song.js --cycles N`, reading in time order until an event differs from what you wrote. Query enough cycles: `<>` alternation and per-cycle randomness need several.
4. **Isolate.** Solo the layer with `S$:`, or shrink the pattern until the divergence is still there with the least code around it.
5. **Fix, then prove the fix touched only the bug.** Keep the broken version; `kynska diff broken.js fixed.js --cycles N` should list only the events you meant to change.
6. **If it is a sound problem rather than a timing one** (silence, a missing instrument, clipping), `kynska render` names the sound that failed and measures the level.

## Usual causes

- A single-quoted string where a pattern was meant (`'bd sn'` is plain text).
- Arithmetic on a control pattern (`note("c3").add(12)` does nothing; use `.transpose(12)`).
- `n` without a scale or sound means a sample index, not a pitch: `n("0 2 4").scale("C:major")` for pitches.
- Expecting seconds where events show cycles: at 0.5 cycles per second, cycle 1 is 2 seconds in.
- An event that spans cycles (`.slow(2)`) is listed once, at its start.
- A sound name that does not exist: render reports "sound … not found"; `kynska lookup` does not cover sound names, but the samples page (`docs/learn/samples.md`) lists the banks.
