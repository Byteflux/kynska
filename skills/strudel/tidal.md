# Translate TidalCycles code

Strudel runs Tidal notation itself, so a translation can be **proven** rather than eyeballed: run the original through Strudel's Tidal parser and compare its events with your translation's.

## The proof

1. Keep the original as written, in its own file, without `$:` (its `d1 $` already registers it):
   ```js
   await initTidal()
   tidal`d1 $ every 2 (fast 2) $ s "bd sn" # speed 2`
   ```
2. Write the translation in another file:
   ```js
   $: s("bd sn").every(2, fast(2)).speed(2)
   ```
3. `kynska diff original.js translation.js --cycles 8` should report "No differences". Otherwise its changed, removed and added lines show where the translation departs; fix and repeat.

## Common mappings

| Tidal | Strudel |
|---|---|
| `d1 $ x` | `$: x` |
| `sound "bd sn"`, `s "bd sn"` | `s("bd sn")` |
| `# speed 2`, `# gain 0.8` | `.speed(2)`, `.gain(0.8)` |
| `n "0 2 4" # s "superpiano"` | `n("0 2 4").s("superpiano")` |
| `every 2 (fast 2) $ x` | `x.every(2, fast(2))` |
| `|+ n 12` | `.add(12)` before naming the control, e.g. `n("0 2 4").add(12)` |

## Where the proof stops

Strudel's Tidal parser is a partial port. At Strudel 1.2.6 it parses `|+ n 12` as setting every `n` to 12, where Tidal adds 12, and it cannot parse `0.25 ~> x`. When `tidal\`…\`` disagrees with what the Tidal code means, follow the meaning: write the expected events yourself (as in the main steps) and prove the translation against those. Strudel's own comparison page: `docs/learn/strudel-vs-tidal.md`.
