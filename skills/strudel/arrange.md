# Arrange a piece in sections

A loop becomes a piece when layers enter, leave and change on known cycles. Plan the **form** first, as a list of sections with lengths in cycles (intro 8, build 8, drop 16, outro 8), then make the code follow it.

## Two ways to build the form

- **Sections as whole patterns**, played in order with `arrange([cycles, pattern], ...)`. It plays each for its length, then loops:
  ```js
  const drums = s("bd*4, [~ cp]*2").bank("RolandTR909")
  const bass = note("<c2 f2 bb1 eb2>").s("sawtooth").lpf(500)
  const pad = chord("<Cm7 Fm7 Bb7 Eb^7>").voicing().s("gm_pad_warm")
  $: arrange([8, pad], [8, stack(pad, bass)], [16, stack(pad, bass, drums)])
  ```
- **Layers entering and leaving**, each with a mask of 1s (playing) and 0s (silent), one entry per cycle: `drums.mask("<0!8 1!16 0!8>")` stays silent for 8 cycles, plays 16, then stops.

## Proving it

Give the form to the tools as section lengths, the same numbers `arrange` takes: `--sections intro=4,A=16,B=12,outro=8`.

- **`kynska form piece.js --sections <form>`** lists each layer's sounds and the cycles it plays in, a grid of events per layer per section, and the notes each section uses. Compare it with the plan: every layer present exactly in its sections, and a key change visible in the notes (B♭ in place of B).
- **Draft a section**: `kynska render piece.js --from 20 --to 32` renders only cycles 20 to 32.
- **Render the whole piece once**, at the end: `kynska render piece.js --sections <form> --tail 2` (the tail keeps reverb and release that ring past the end) reports level and loudness per section, and the cycle where the peak is.
- When one section changes, `kynska diff` against the previous version over the full length shows that only that section's events moved.
