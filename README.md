# Kynska

Docs, skills and tooling for coding agents that make music with
[Strudel](https://strudel.cc), from first idea to finished piece.

Kynska holds only its own tooling. It contains no Strudel code, docs or
examples: the tooling fetches Strudel at a pinned version and generates
everything else locally, into `.cache/` and `out/`, which git ignores.

## Parts

| Part | What it does | Status |
|---|---|---|
| Patterns | Evaluates Strudel code headlessly, the way the strudel.cc REPL does, so an agent checks a pattern by its notes and timings instead of by listening | `events`, `check`, `diff` |
| Audio | Renders code to a WAV file with Strudel's own audio engine and measures it in code: level, loudness, clipping, silence, and whether sound starts where the events do | `render`, `analyse` |
| Knowledge | Generates agent-ready docs from Strudel's docs site and source | `docs build`, `reference build`, `lookup` |
| Skills | Instructions for music-making tasks that check their work with the tooling | planned |
| Evals | Tasks scored in code, built from Strudel's documented examples | planned |

## Strudel version

[`strudel.json`](strudel.json) pins the Strudel release Kynska builds against,
and `package.json` pins the `@strudel/*` packages and `superdough` to the same
version, so the reference documents exactly the functions the tools run. A test
fails when the two drift apart.

## Use

Requires Node 24 or later. TypeScript runs directly, with no build step.

```bash
npm install
```

Build the docs and the function reference (fetches the pinned Strudel source
into `.cache/`, writes `out/`):

```bash
node src/cli.ts docs build
```

Code is read from a file, or from stdin when the file is `-` or omitted. Every
command takes `--json`.

| Command | What it does |
|---|---|
| `events [file] [--cycles N]` | The events a pattern produces in the first N cycles (default 1) |
| `check [file] [--cycles N]` | Syntax, unknown functions and methods (with suggestions), undocumented and browser-only functions, evaluation and query errors, Strudel's own warnings, silence (default 4 cycles) |
| `diff <before> <after> [--cycles N]` | What changed between the events of two versions: changed, removed, added |
| `render [file] [--cycles N] [--out file.wav] [--tail S] [--sample-rate R]` | Renders N cycles (default 4) to a 16-bit WAV (default `out/render.wav`) and reports level, loudness (LUFS), clipping, silence, and onsets against the pattern's events |
| `analyse <file.wav>` | The same measurements for any WAV file |
| `lookup <name>` | A function's reference entry: how to call it, parameters, examples, source; finds synonyms and full JSDoc names, and suggests names for typos |
| `lookup --tag <tag>` / `--module <module>` | Functions by tag or source module |
| `docs build` | Builds everything in `out/` (below) |
| `reference build` | Builds `out/reference.json` only |

```bash
echo 's("bd(3,8), hh*4")' | node src/cli.ts events --cycles 2
```

```bash
echo 's("bd sd").lpff(800)' | node src/cli.ts check
```

```bash
node src/cli.ts diff before.js after.js --cycles 4
```

```bash
node src/cli.ts render song.js --cycles 8 --out song.wav
```

```bash
node src/cli.ts lookup cutoff
```

Exit codes: 0 success; 1 errors found (`check`), a difference (`diff`), an event
that failed to play (`render`, e.g. an unknown sound) or a failure; 2 bad usage.

### Generated docs

`docs build` writes:

| File | What it is |
|---|---|
| `out/llms.txt` | An index in the [llms.txt](https://llmstxt.org) format: every page in the site's sidebar order, with a one-line summary |
| `out/llms-full.txt` | Every page in one file (about 70k tokens) |
| `out/docs/<page>.md` | One Markdown file per page of strudel.cc's docs: playable examples become `js` code blocks, embedded reference entries are written out, links between pages stay local |
| `out/docs/reference.md` | Every documented function (about 60k tokens) |
| `out/reference.json` | The same reference as data, plus the names strudel.cc has from browser-only packages |

The community showcase and the site's example-tune player are left out: those
are community contributions with their own licences. The German workshop
translation is left out too.

### Rendering

`render` runs superdough, Strudel's audio engine, offline in Node through
[node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api), the same
way strudel.cc's "export" does. Synths, samples, effects (filters, reverb, delay,
distortion, phaser, ...) all render. Sample banks are the ones strudel.cc loads
by default; samples download on first use and are cached in `.cache/sounds/`.
Soundfont instruments (`gm_*`) are not loaded. Each render runs in its own worker
thread and is capped at 600 seconds of audio.

The onset check detects where sounds start (spectral flux) and matches them to
the pattern's event times within 40 ms. It is a heuristic: on the patterns it
was tuned on it found every onset with about one false onset in six patterns
(`node scripts/score-onsets.ts`).

### Headless limits

Functions that need a browser (Hydra, MIDI, motion sensors, CSound, Kabelsalat's
`K`, some visuals) are stood in for with no-ops: `check` warns `browser-only`,
naming the package, and their own effect is not checked. Code that only works
with the real thing (say, calling the function `midikeys()` returns) gets a
warning, not an error.

## Develop

```bash
npm run check
```

This runs the type check and the tests. After `docs build`, three sweeps check
the tools against Strudel's own material:

| Command | What it checks |
|---|---|
| `npm run check:examples` | `check` on every documented example in the reference; they are known-good code, so an error is a false positive |
| `npm run check:docs` | `check` on every code block in the generated docs, except blocks Strudel's docs do not mean to run (listed in the script with the reason) |
| `node scripts/score-onsets.ts` | Onset detection on a set of rendered patterns: onsets found and false onsets |
