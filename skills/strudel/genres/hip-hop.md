# Hip-hop: boom-bap

For a brief that asks for boom-bap, 90s hip-hop, or a jazz-rap or lo-fi hip-hop beat. Trap and drill are different (faster tempos felt at half time, rolling hi-hats) and have no card yet: write the conventions you assume as numbers in your expected events.

Each number is a convention, not a rule. The **Check** column says how to prove the code follows it; **Source** where it comes from.

| Part | Convention | In Strudel | Check | Source |
|---|---|---|---|---|
| Tempo | 85 to 95 bpm; the style spans about 80 to 100 | `setcpm(90/4)`: 4 beats per cycle, one cycle per bar | `render` prints cycles per second; bpm = that × 240 | [1] |
| Swing | Off-beats played late. On an MPC, 66% is a perfect triplet swing, 62% looser, 54% loosens the feel without sounding swung | see *Swing* below | `events`: each off-beat at its swung position | [2] |
| Snare | On beats 2 and 4, every bar | `s("~ sd ~ sd")` | `events`: sd at 1/4 and 3/4 of each cycle | [1] |
| Kick | Beat 1, and around beat 3 with pickups before it; not with the snare | `s("bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~")` (16 steps) | `events` | [1] |
| Hats | Eighths or sixteenths, the on-beats louder | `s("hh*8").gain("[0.27 0.18]*4")`: one value per eighth (`"0.27 0.18"` alone would make the first half of the bar louder) | `events`: gain 0.27 on the beats, 0.18 between | [1] |
| Drum sounds | Sampled drum machines of the era | `.bank("AkaiMPC60")`, `.bank("EmuSP12")` | `check` (an unknown bank is an error) | [1] |
| Harmony | A loop of 1, 2 or 4 bars in one minor key, with 7th and 9th chords from jazz and soul records | `chord("<Dm9 Gm9 Bb^7 A7>").voicing()` | `harmony`: one key in every section, the chord loop "N times" | [1] |
| Bass | The chord root at each change, with the kick | `note("<d2 g1 bb1 a1>").struct("x@10 x@6")` | `harmony`: the bass in the chord on every beat, no `/X` | theory.md |
| Form | Intro of 4 or 8 bars, verses of 16, hooks of 8 (sometimes 4); bridges are rare | masks per cycle, or `arrange` | `form --sections intro=4,verse=16,hook=8,...` | [3] |
| Levels | Kick, snare and bass within about 3 LU of each other; a melody 3 to 5 below the snare, keys 5 to 7, hats 8 to 11 | `.gain()` per layer | `render --layers` | measured, below |

## Swing

An MPC's swing percentage is how far through each pair of notes the second one starts: 50% is straight, 66% puts it on the triplet. In Strudel, `.swingBy(x, n)` splits each cycle into `n` slices and delays the second half of each by `x` of a half slice, so a swing of p% is **`x = 2p − 1`**, with `n` the number of note pairs per cycle:

| MPC swing | `x` | Swung eighths (`n = 4`) | Swung sixteenths (`n = 8`) |
|---|---|---|---|
| 54% | 0.08 | `.swingBy(0.08, 4)` | `.swingBy(0.08, 8)` |
| 62% | 0.24 | `.swingBy(0.24, 4)` | `.swingBy(0.24, 8)` |
| 66% (triplet) | 1/3 | `.swing(4)` | `.swing(8)` |

Swing every rhythmic layer the same way, the bass included, so their off-beats line up. **Check:** with swung eighths at 66%, `events` puts each off-beat eighth at 2/3 of its beat: 1/6, 5/12, 2/3 and 11/12 of the cycle, not 1/8, 3/8, 5/8 and 7/8.

## A starting loop

Four bars in D minor at 90 bpm, the levels as measured below. `harmony` reports D minor, C# only on the A7 bars (the raised 7th), Dm9 Gm9 Bb^7 A7 over their roots, and no clashes.

```js
setcpm(90/4)
kick: s("<[bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~]!3 [bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ bd ~ ~]>").bank("AkaiMPC60").gain(.48).swing(4)
snare: s("~ sd ~ sd").bank("AkaiMPC60").gain(.18).swing(4)
hats: s("hh*8").bank("AkaiMPC60").gain("[0.27 0.18]*4").swing(4)
bass: note("<d2 g1 bb1 a1>").struct("x@10 x@6").s("gm_electric_bass_finger").gain(.76).lpf(900).swing(4)
keys: chord("<Dm9 Gm9 Bb^7 A7>").voicing().s("gm_epiano1").gain(.16).attack(.03).lpf(2500).room(.3)
```

For the lo-fi side: a low-pass on the keys (`lpf(2500)`), a little `room`, and vinyl noise, `s("crackle").density(0.1).gain(0.3)`. A minor-pentatonic melody (`scale("D4:minor:pentatonic")`) stays clear of the chords; see theory.md.

## Measured

This loop, `render --cycles 4 --layers`, in LUFS: snare −21.9, bass −23.3, kick −24.4, keys −27.8, hats −32.9. The mix peaks at −2.4 dBFS with 0 clipped samples, at −19.2 LUFS; `--master=-14` takes up to 4.2 dB off its peaks. A 32-bar track built from it, with a vibraphone melody (−26.4 LUFS alone on the hook) and a keys-only intro and outro, needed 7.1 dB of limiting as first balanced and 5.6 dB after the kick and hats came down 2 dB and the intro and outro keys up 4 dB: sections much quieter than the rest pull the whole-track loudness down, so mastering lifts and limits the loud ones more.

## Sources

1. Native Instruments, [What is boom bap?](https://www.native-instruments.com/en/blogs/blog/what-is-boom-bap): tempo, drums on 2 and 4, drum machines, jazz and soul samples. Production guides agree on 85 to 95 bpm and the snare on 2 and 4, and differ on swing amounts, which is why the swing figures come from [2].
2. Roger Linn, the MPC's designer, in [Roger Linn on swing, groove & the magic of the MPC's timing](https://attackmagazine.com/?p=10694), Attack Magazine, 2013: 66% as perfect triplet swing, 62% looser at 90 bpm, 54% loosening straight sixteenths.
3. Practitioner convention, e.g. eMastered, [Rap song structure](https://emastered.com/blog/rap-song-structure): 16-bar verses, 8-bar hooks, intros and outros, rare bridges.
