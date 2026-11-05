# Compose from a description

Build the music **layer by layer**, one `$:` line per layer, and prove each layer with events before adding the next. A description ("dark techno at 128 bpm, rolling bass, sparse claps") becomes decisions: tempo and grid, then drums, harmony, bass, melody, sounds.

## Decisions, in order

1. **Tempo and grid.** Pick beats per cycle (4 is usual) and set `setcpm(bpm/4)`. Each mini-notation step then divides the cycle: `"bd*4"` is four beats, `"hh*8"` eighths, `"[~ hh]*4"` offbeats.
2. **Drums.** One layer per part when the parts need their own levels:
   ```js
   $: s("bd*4").bank("RolandTR909")
   $: s("[~ cp]*2").bank("RolandTR909")
   $: s("[~ hh]*4").bank("RolandTR909").gain(0.6)
   ```
   Euclidean rhythms: `"bd(3,8)"`; rests `~`; repeat `!`; weight `@`. Mini-notation page: `docs/learn/mini-notation.md`.
3. **Harmony.** One chord per cycle: `chord("<Cm7 Fm7 Bb7 Eb^7>").voicing()`, with a sound such as `.s("gm_epiano1")`. Chord symbols follow Strudel's voicing dictionary: a major seventh is `^7` (`Eb^7`), not `maj7`; an unknown symbol plays nothing for that chord and `check` warns `engine-warning`. Voicings page: `docs/understand/voicings.md`.
4. **Bass, following the chord roots**, on the same cycle boundaries:
   `note("<c2 f2 bb1 eb2>").s("sawtooth").lpf(500)` or scale degrees, `n("<0 3 6 2>").scale("C2:minor")`. For a rhythm on each root use `.ply(8)` (eight eighths per root); `"<c2 f2 bb1 eb2>*8"` instead changes root on every eighth.
5. **Melody.** Scale degrees keep it in key: `n("0 2 4 <7 9>").scale("C4:minor").s("triangle")`. A scale without an octave (`"C:minor"`) starts at octave 3.
6. **Sound design.** Filters (`lpf`, `hpf`), envelopes (`attack decay sustain release`), space (`room`, `delay`). Pages: `docs/learn/synths.md`, `docs/learn/effects.md`, `docs/learn/samples.md`.
7. **Variation**, so it does not loop identically: `.lastOf(4, x => x.fast(2))`, `.sometimes(x => x.ply(2))`, `.degradeBy(0.2)`, `<>` alternation.

## Proving it

- After each layer, solo it (`S$:`) and run `kynska events --cycles 4`: the sounds, notes and positions are the ones you decided.
- Bass and chords change on the same cycles: their events start at the same cycle positions.
- Random variation (`sometimes`, `degradeBy`) is decided per cycle; query 8 or more cycles before judging how often it fires.
