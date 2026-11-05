---
name: strudel
description: Make music with Strudel (strudel.cc live-coding patterns) and prove it works without listening, using the kynska CLI. Use when writing a Strudel pattern from a description, arranging a piece in sections, mixing or rendering to WAV, translating TidalCycles code to Strudel, or debugging a pattern that plays wrong.
---

# Strudel, with evidence

You cannot hear the music, so every claim you make about it needs **evidence** from `kynska`: the events say what plays when, the render measurements say how loud and whether it clips. "The kick is on every beat" is evidence when `kynska events` shows it; "it doesn't clip" is evidence when `kynska render` reports 0 clipped samples. Report the evidence with the music.

## Steps

1. **Read the reference for the task**, beside this file:
   - a new pattern or piece from a description: [compose.md](compose.md)
   - a piece that changes over time, in sections: [arrange.md](arrange.md), after compose
   - levels, clipping, loudness, a WAV file: [mix.md](mix.md)
   - TidalCycles code to bring into Strudel: [tidal.md](tidal.md)
   - a pattern that plays wrong, or an error: [debug.md](debug.md)
2. **Look up every function you are not sure of** before writing it: `kynska lookup <name>` gives how to call it, its parameters and examples, and suggests names for a typo. For a topic, `kynska docs path` locates the docs: start from `llms.txt`, an index of pages.
3. **Write the expected events, then the code.** In a file (`.js`; `.mondo` for Mondo notation), and before running it, write down what should play: which sounds and notes, at which positions in the cycle, over how many cycles.
4. **`kynska check song.js`** until it says OK. Read every warning: `engine-warning` and `silent` usually mean the music is not what you meant; `undocumented` and `browser-only` mean behaviour kynska cannot verify.
5. **`kynska events song.js --cycles N`**, with N covering every variation and section, and compare with your expected events. On a mismatch, fix and go back to step 4. After an edit, `kynska diff before.js after.js --cycles N` shows exactly which events changed: only the intended ones should. For a piece in sections, `kynska form song.js --sections intro=4,A=16,B=12,outro=8` shows which layer plays in which cycles, events per section, and the notes each section uses.
6. **`kynska render song.js --cycles N --out song.wav`** and read the measurements.

## Time

A render takes from a fifth to three quarters of the audio's length, depending on the code: a 2-minute piece, 25 to 90 s. Spend that on the final render only:

- **Draft one section at a time**: `kynska render song.js --from 20 --to 32` renders cycles 20 to 32 in seconds.
- **Measure balance in one run**: `--layers --sections <form>` renders every layer alone and reports each layer's loudness in each section, next to the mix.
- **Render the whole piece once**, at the end, and report as soon as it is measured.

`form`, `render --layers` and `render --sections` already measure layer balance, level per section, where the peak is, which layer plays where and the notes each section uses: reach for them before writing a script of your own.

Done when `check` is OK, the events match what you wrote down for every cycle, and `render` exits 0 (every sound played) with 0 clipped samples. For drums, plucks and pianos, the onset line should match every event time; slow-attack sounds (flute, strings, pads) can show missing onsets, which is the detector, not the music.

## Facts that catch everyone

- **Time is in cycles.** `kynska events` prints positions as fractions of a cycle. Tempo: `setcpm(bpm / beatsPerCycle)`, e.g. `setcpm(120/4)` for 120 bpm with 4 beats per cycle; without it, 0.5 cycles per second. Seconds = cycle position / cycles per second.
- **Quotes matter.** Double-quoted and backtick strings are mini-notation patterns; single-quoted strings are plain JavaScript strings, so `'0 1'.add(1)` fails where `"0 1".add(1)` works.
- **`<a b>` alternates per cycle**, so it takes as many cycles as entries to show them all: query enough cycles.
- **`$:` lines play together.** `_$:` mutes a line, `S$:` solos it. Each `$:` (or named label, `bass:`) is a layer to `form` and `render --layers`, so give each part its own line.
- **Arithmetic on a control pattern does nothing**: `note("c3").add(12)` stays c3, and `check` warns `engine-warning`. Transpose with `.transpose(12)`, or add before naming the control: `n("0 2 4").add(12)`.
- **Sounds**: drums by name (`bd sd hh oh cp rim`), with a machine via `.bank("RolandTR909")`; synths `sine square sawtooth triangle supersaw`; `piano`; General MIDI instruments `gm_*` (e.g. `gm_acoustic_bass`). An unknown name renders as an error, "sound … not found".
