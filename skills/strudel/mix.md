# Mix and render

Balance the layers, keep the peak below full scale, and reach a loudness target, all by measurement: `kynska render` reports peak (dBFS), loudness (LUFS) and clipped samples.

## Targets

- **Peak at or below -1 dBFS**, so 0 clipped samples.
- **Loudness about -14 LUFS** for a finished piece (streaming services normalise to roughly that); a draft can sit lower.

Both at once need the **gap** between peak and loudness to be 13 dB or less: loudness at a -1 dBFS peak is `-1 - gap`. Drums widen the gap (a kick alone measured 17 dB, hats 19), sustained parts narrow it (bass 9, vibraphone 8), and a mix with drums typically lands at 14 to 16.

## How levels behave (measured)

- `.gain(x)` scales amplitude linearly: `gain(0.5)` is 6 dB quieter. Use it for balance.
- `.postgain(x)` and `.velocity(x)` are not linear: 0.5 measured 8 dB quieter. Leave them for musical accents.
- Layers add up: the mix peaks where several layers hit together (often the downbeat), above any layer alone, so a mix of moderate layers can still clip.
- **Strudel has no limiter on the mix.** Every event reaches the output through its own chain, so `.compressor()` and `.distort()` act on each hit alone, never on the sum:
  - `.compressor("-20:4:10:.002:.1")` on a kick left its gap unchanged (17.3 to 17.2 dB) and its automatic makeup gain made it 2.3 dB louder, which clipped the mix. It only acts as a gain change.
  - `.distort("3:.4")` on a kick cut its own gap by 5 dB, but the mix's gap by 0.1: the mix peak came from other layers coinciding.
- Reverb (`room`) and delay add level and ring past the end of the last cycle: render with `--tail 2`.
- In a full mix, reverb, delay, noise and overlapping layers all read as onsets, so `render` says the onsets were not checked; each layer's row in `--layers` checks them.

## Steps

1. **Measure each layer alone**: `kynska render piece.js --layers --sections <form>` renders every `$:` layer alone and reports its peak and loudness, overall and per section, beside the mix. On a long piece, draft on its busiest section: add `--from`/`--to`.
2. **Balance with `gain`** until the layer loudnesses relate as intended (for example kick and bass within a couple of dB of each other, pads several dB below, hats below the snare). Change a few layers, then re-measure.
3. **Render the full mix.** The report names the cycle where the peak is. If the peak is above -1 dBFS, multiply every layer's gain by `10^(-(peak + 1) / 20)`, which lands the peak at -1 dBFS (a mix peaking at +3.3 dBFS needs a factor of 0.61). Re-render to confirm.
4. **Narrow the gap in the code**, so mastering has little to do. Lower the layers whose own gap (peak minus LUFS in `--layers`) is largest, usually kick and snare, by 2 to 3 dB, and soften chord attacks with `.attack(0.03)`. Measured on a lo-fi mix: drums 3 dB down took the gap from 15.0 to 14.1 dB with loudness unchanged, and the softer keys attack to 13.7.
5. **Master the file**: `kynska render piece.js --sections <form> --tail 2 --master=-14` writes the WAV at -14 LUFS with a lookahead limiter holding peaks at -1 dBFS, and reports how much it limited. Up to about 3 dB is gentle; above 6 dB it warns, because the drums flatten: go back to step 4. The same mix mastered took 2.3 dB of limiting as written and 0.8 dB after step 4.

Mastering does not fix a clipping mix: the limiter removes the clipping from the file, but the code still clips on strudel.cc. The mastered report's "Before mastering" line measures the code as it plays, and warns when it clips: then go back to step 3.

Done when the code's own mix has 0 clipped samples (step 3, or the "Before mastering" line) and the mastered render reports peak at or below -1 dBFS, loudness within 1 LU of the target, and limiting of at most 6 dB. Report the code's own peak and loudness as well as the master's: strudel.cc plays the code unmastered, quieter than the file.
