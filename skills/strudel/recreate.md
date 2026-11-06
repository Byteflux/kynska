# Recreate an existing song

A song that exists has a right answer: its notes. Prove the piece plays them against a reference MIDI file with `kynska compare`, not against your memory of the song or your reading of a score. Checks against a spec you wrote yourself pass even when you misread the song.

## The reference

- **A MIDI file of the song.** One exported from notation (MuseScore, LilyPond, the Mutopia Project) is exact. One played in by hand has notes a little off the beat: compare it with `--tolerance 1/8`.
- **A copyrighted song's MIDI stays local.** Use it to compare; never commit it to a repository.
- **No MIDI file**, only a PDF score, a recording or memory: say so in your report. Without a reference, nothing checks the notes against the song.

## Steps

1. **Read it**: `kynska notes song.mid` prints the parts, metre and tempo, the `setcpm` that plays one bar per cycle, and each bar as one cycle of mini-notation, ready to paste. `--bars 9-16` for a section, `--parts 1,3` for some parts.
   - Voices that overlap in a bar are joined with `,`: `[c5,e5] [c5,e5] e5@2, ~@4 c5 b4 a4 b4` plays both lines in one cycle.
   - A line headed `bars 9-10` is held over the bar line: it covers both bars, so slow it by its number of bars.
   - Bar numbers count from the file's first beat: a song that starts with a pickup has the pickup inside bar 1.
2. **Write it**: `setcpm` as `notes` prints, and one `$:` layer per part you keep. Each part ends with an `as one layer` line that plays all its bars exactly: start from it rather than retyping bars, then arrange, cut or change it. To build a part bar by bar instead, one cycle per bar: `arrange([1, note("bar 1")], [1, note("bar 2")], [2, note("bars 3-4").slow(2)])`, or `note("<[bar 1] [bar 2]>")` while no line spans bars.
3. **`kynska compare song.js song.mid`** until it says every reference note is played and nothing else, or until every difference left is one you chose (an arrangement that drops a part, adds drums, or moves a part an octave).
   - It reports recall (reference notes the piece plays), precision (piece notes in the reference) and F1, per reference part and per layer, then each difference by bar and beat: `~` a changed note, `-` a missing one, `+` an extra one.
   - Notes are compared in beats, so they can match at the wrong speed. The tempo is checked apart: more than 2% off the reference fails the comparison with a warning that gives the `setcpm` to use. Four bars written into one cycle at the one-bar `setcpm` play four times too fast: slow them, `.slow(4)`.
   - It finds where bar 1 starts in the piece (an intro before it is fine) and how many bars one cycle holds; `--offset` and `--beats-per-cycle` set them. `--bars 9-16` compares a section.
   - A warning that notes match at another transposition means the piece is in another key or octave. When that is meant, compare with `--transpose=-12` (the number it gives).
   - Note lengths that differ are listed apart and do not fail the match.
4. **Render and mix** as [mix.md](mix.md) says.

Done when `compare` exits 0 for the bars you recreated, or you report each remaining difference as a choice. Report the F1 and the bars compared with the music.

## Where it stops

`compare` checks pitches and rhythm only: not the instruments, the sound or the mix. Drums match by name: General MIDI drum keys become `bd`, `sd`, `hh`, `oh`, `cp`, `rim`, `cr`, `rd`, `lt`, `mt`, `ht`, `cb`, `tb`, `sh`, and any other `perc`.
