# Mix and render

Balance the layers, keep the peak below full scale, and hit a loudness target, all by measurement: `kynska render` reports peak (dBFS), loudness (LUFS) and clipped samples.

## Targets

- **Peak at or below -1 dBFS**, so 0 clipped samples.
- **Loudness about -14 LUFS** for a finished piece (streaming services normalise to roughly that); a draft can sit lower.

## How levels behave (measured)

- `.gain(x)` scales amplitude linearly: `gain(0.5)` is 6 dB quieter. Use it for balance.
- `.postgain(x)` and `.velocity(x)` are not linear: 0.5 measured 8 dB quieter. Leave them for musical accents.
- Layers add up: two layers peaking together can sit up to 6 dB above either alone, so a mix of moderate layers can still clip.
- Reverb (`room`) and delay add level and ring past the end of the last cycle: render with `--tail 2`.

## Steps

1. **Measure each layer alone**: solo it with `S$:` and render. Note each layer's loudness.
2. **Balance with `gain`** until the solo loudnesses relate as intended (for example kick and bass within a couple of dB of each other, pads several dB below, hats below the snare). Change one layer at a time and re-measure.
3. **Render the full mix.** If the peak is above -1 dBFS, multiply every layer's gain by `10^(-(peak + 1) / 20)`, which lands the peak at -1 dBFS (a mix peaking at +3.3 dBFS needs a factor of 0.61). Re-render to confirm.
4. **Loudness**: if the mix is well below the target after step 3, the peaks are limiting it; lower the loudest transient layer (often the kick) slightly and raise the rest, or add `.compressor("-20:4:10:.002:.1")` to that layer, then repeat step 3.

Done when the full render reports 0 clipped samples, peak at or below -1 dBFS, and loudness within 2 LU of the target.
