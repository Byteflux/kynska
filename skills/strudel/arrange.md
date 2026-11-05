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

- The total length is the sum of the sections. Query all of it: `kynska events piece.js --cycles <total> --json`, and check each section boundary: a layer's first event is at the cycle its section starts, and its last event ends where the section ends.
- Render the whole piece: `kynska render piece.js --cycles <total> --tail 2`, where the tail keeps reverb and release that ring past the end.
- When one section changes, `kynska diff` against the previous version over the full length shows that only that section's events moved.
