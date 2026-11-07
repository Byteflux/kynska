# Kynska

Docs, skills and tooling for coding agents that make music with
[Strudel](https://strudel.cc), from first idea to finished piece, proven by
measurement rather than by ear.

Kynska holds only its own tooling. It contains no Strudel code, docs or
examples: the tooling fetches Strudel at a pinned version and generates
everything else locally, into `.cache/` and `out/`, which git ignores.

## Parts

| Part | What it does |
|---|---|
| Patterns | Evaluates Strudel code headlessly, the way the strudel.cc REPL does: `events`, `check`, `diff`, and `compare` against a reference song's MIDI file. JavaScript, Mondo notation and Tidal notation. |
| Audio | Renders code to WAV with Strudel's own audio engine (synths, samples, soundfonts, effects) and measures it: level, loudness, clipping, silence, onsets: `render`, `analyse`. |
| Knowledge | Agent-ready docs from Strudel's docs site and source: `docs build`, `lookup`, `llms.txt`. |
| Skill | [`skills/strudel`](skills/strudel/SKILL.md): compose, arrange, mix, translate Tidal and debug, each step proven with the tools. |
| Agents | A Claude Code plugin (the skill plus an MCP server with the tools), and `kynska mcp` for any MCP client. |
| Evals | Tasks scored in code, comparing a model alone with the model plus Kynska: [`evals/`](evals/run.ts). |

## Install

Requires Node 24 or later. TypeScript runs directly, with no build step.

```bash
git clone git@github.com:Byteflux/kynska.git && cd kynska
```

```bash
npm install && npm link
```

```bash
kynska docs build
```

`npm link` puts `kynska` on your PATH. `docs build` fetches the pinned Strudel
source into `.cache/` and writes the docs and the function reference into `out/`.

### Claude Code

With `kynska` installed as above, add the plugin (the `strudel` skill, and the
tools as an MCP server that runs `kynska mcp`):

```
/plugin install kynska --marketplace Byteflux/kynska
```

Any other MCP client: run `kynska mcp` as a stdio server.

## Commands

Code is read from a file, or from stdin when the file is `-` or omitted. It is
JavaScript, which can use ``mondo`...` `` and (after `await initTidal()`)
``tidal`...` `` inline; `--mondo` or a `.mondo` file reads it as Mondo notation
throughout. Every command takes `--json`. Sections are lengths in cycles, in order, as
`arrange()` takes them: `--sections intro=4,A=16,B=12,outro=8`; given alone, they set
how many cycles to render or list.

| Command | What it does |
|---|---|
| `events [file] [--cycles N]` | The events a pattern produces in the first N cycles (default 1) |
| `check [file] [--cycles N]` | Syntax, unknown functions and methods (with suggestions), undocumented and browser-only functions, evaluation and query errors, Strudel's own warnings, silence (default 4 cycles) |
| `diff <before> <after> [--cycles N]` | What changed between the events of two versions: changed, removed, added |
| `form [file] [--cycles N] [--sections S]` | Which layer (`$:` or named label) plays which sounds in which cycles; with sections, events per layer per section and the note names each section uses |
| `harmony [file] [--cycles N] [--sections S] [--beats-per-cycle B]` | The key of each section (Krumhansl–Kessler key profiles over note durations) and every note outside it with its usual reason, key changes between sections, the chord at each change over the bass, how often each other layer plays a chord tone on the beat, and clashes: a note a minor 2nd or 9th above a note another layer holds, not itself in the chord, by bar and beat |
| `render [file] [--cycles N \| --from A --to B] [--sections S] [--layers] [--master=LUFS] [--out file.wav] [--tail S] [--sample-rate R]` | Renders N cycles (default 4), or cycles A to B, to a 16-bit WAV (default `./render.wav`) and reports level (and the cycle of the peak), loudness (LUFS), clipping, silence, and onsets against the pattern's events; `--sections` adds them per section, `--layers` renders each layer alone and measures it beside the mix, `--master=-14` writes the file mastered to that loudness |
| `analyse <file.wav> [--sections S --cps C]` | The same measurements for any WAV file |
| `notes <reference.mid> [--bars A-B] [--parts 1,2]` | A MIDI file's parts, metre and tempo, and each bar as one cycle of mini-notation where it can be (otherwise beat, notes and length) |
| `compare <file> <reference.mid> [--bars A-B] [--beats-per-cycle Q] [--offset C] [--transpose=S] [--tolerance Q]` | How faithfully a piece plays a reference song: notes matched by pitch and onset in beats, the tempo checked apart (within 2%), recall, precision and F1 per reference part and per layer, and every changed, missing or extra note by bar and beat. Finds where bar 1 starts and how many quarter notes a cycle holds unless given |
| `lookup <name>` | A function's reference entry: how to call it, parameters, examples, source; finds synonyms and full JSDoc names, and suggests names for typos |
| `lookup --tag <tag>` / `--module <module>` / `--tags` | Functions by tag or source module; the tags |
| `docs build` / `docs path` | Build everything in `out/` (below) / print where it is |
| `reference build` | Build `out/reference.json` only |
| `upstream` | Compare the pinned Strudel commit with Strudel's `main` today |
| `mcp` | Serve `check`, `events`, `diff`, `form`, `harmony`, `notes`, `compare`, `lookup`, `render` and `docs_path` as MCP tools over stdio |

Exit codes: 0 success; 1 errors found (`check`), a difference (`diff`, `compare`), an event
that failed to play (`render`, e.g. an unknown sound) or a failure; 2 bad usage.

### Generated docs

The same docs are published at https://byteflux.github.io/kynska/: an agent
without Kynska installed can fetch
[`llms.txt`](https://byteflux.github.io/kynska/llms.txt) and follow its links. CI
builds and deploys the site from `main` after every check passes
(`scripts/build-site.ts`); it is never committed. Like Strudel, the converted docs
are licensed AGPL-3.0-or-later; the site carries the licence text and the Strudel
commit they come from.

| File | What it is |
|---|---|
| `out/llms.txt` | An index in the [llms.txt](https://llmstxt.org) format: every page in the site's sidebar order, with a one-line summary |
| `out/llms-full.txt` | Every page in one file (about 70k tokens) |
| `out/docs/<page>.md` | One Markdown file per page of strudel.cc's docs: playable examples become code blocks, embedded reference entries are written out, links between pages stay local |
| `out/docs/reference.md` | Every documented function (about 60k tokens) |
| `out/reference.json` | The same reference as data, with tags, and the names strudel.cc has from browser-only packages |

The community showcase and the site's example-tune player are left out: those
are community contributions with their own licences. The German workshop
translation is left out too.

### Rendering

`render` runs superdough, Strudel's audio engine, offline in Node through
[node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api), the same
way strudel.cc's "export" does. Each render runs in its own worker thread and is
capped at 600 seconds of audio. A render takes from a fifth to three quarters of the
audio's length, depending on the code (a 2-minute piece, 25 to 90 s), so `--from`/`--to`
drafts one section, and
`--layers` renders up to three layers at once.

- **Layers**: each `$:` or named label (`bass:`) is a layer. `--layers` renders each
  one alone by muting the others' labels, the way `_$:` does by hand.
- **Mastering**: Strudel has no limiter on the mix (every event goes to the output
  through its own chain), so a mix with drums cannot reach release loudness without
  clipping. `--master=-14` writes the file at that loudness, with a lookahead limiter
  holding peaks at -1 dBFS, and reports how much it limited. Only the file changes:
  strudel.cc plays the code unmastered.

- **Sounds**: strudel.cc's default sample banks, and General MIDI soundfont
  instruments (`gm_*`), downloaded on first use and cached in `.cache/sounds/`.
  Soundfont instrument files are JavaScript that the loader runs with `eval`;
  Kynska only lets through files that are plain data.
- **Onsets**: detected by spectral flux and matched to the pattern's event times
  within 40 ms. On the scoring set (`node scripts/score-onsets.ts`) it finds
  every onset with 2 false onsets in 12 patterns. Slow-attack sounds (flute,
  strings, pads) can show missing onsets. In a dense mix, reverb, delay, noise and
  overlapping layers read as onsets too; when most detected onsets have no event,
  the report says they were not checked, and `--layers` checks each layer instead.

### Notations

- **Mondo**: `@strudel/mondo` runs headlessly, inline or as whole programs.
- **Tidal**: `initTidal()` and ``tidal`...` `` load Strudel's Tidal port from the
  pinned source, with its Haskell parser. It is a partial port: some Tidal
  (for example `|+ n 12`, `0.25 ~> x`) runs differently or not at all.

### Headless limits

Functions that need a browser (Hydra, MIDI, motion sensors, CSound, Kabelsalat's
`K`, some visuals) are stood in for with no-ops: `check` warns `browser-only`,
naming the package, and their own effect is not checked.

## Strudel version

Kynska follows Strudel's `main` branch, which strudel.cc deploys on every push,
so code that passes Kynska's checks plays the same on strudel.cc. npm has only
Strudel's releases, which fall hundreds of commits behind `main`.

[`strudel.json`](strudel.json) pins one commit on `main`. After every
`npm install`, `scripts/link-strudel.ts` fetches that commit into `.cache/` and
links its packages into `node_modules`: the pattern packages run as their source,
and `superdough` is built with its own Vite config, as Strudel's releases are.
The third-party packages they import are Kynska's own dependencies, at the
versions Strudel's lockfile uses; linking stops and names any that are missing.
If a later `npm install <package>` removes the links, Kynska says so: run
`npm run link-strudel`.

```bash
kynska upstream
```

```bash
node scripts/upgrade-strudel.ts
```

The upgrade script moves the pin to `main`'s newest commit (or to a commit you
give it), links it, rebuilds the docs, and runs the tests, every sweep below and
the oracle evals. A scheduled workflow (`.github/workflows/track-strudel.yml`)
runs it every day and lands the move on `main` when every check passes, which
republishes the docs; when a check fails, the run fails and nothing is pushed.

## Develop

```bash
npm run check
```

This runs the type check and the tests. After `docs build`, these check the
tools against Strudel's own material (CI runs all of them):

| Command | What it checks |
|---|---|
| `npm run check:examples` | `check` on every documented example in the reference; they are known-good code, so an error is a false positive |
| `npm run check:docs` | `check` on every code block in the generated docs, except blocks Strudel's docs do not mean to run (listed in the script with the reason) |
| `node scripts/score-onsets.ts` | Onset detection on rendered patterns; fails below 97% found or above 6 false onsets |
| `npm run evals -- --agent oracle` | The eval tasks answered with their known solutions; every task scores 1 |

### Evals

`npm run evals` scores a model on 40 tasks, alone (`baseline`) and with the
`strudel` skill plus a `kynska` tool (`kynska`):

- **transcribe** (16): write code producing these events; tasks generated from
  Strudel's documented examples; scored by event F1.
- **describe** (8): a musical brief in words; scored by criteria on the events.
- **produce** (10): 8–16 bar production briefs, scored from the rendered audio
  and events: tempo, duration, loudness, peaks, clipping, section entrances,
  key, bass range, layer count and loudness contrast between sections. Four
  of them name a genre or a musical idea instead of the notes: a boom-bap
  beat (tempo in the genre's range, snare on 2 and 4, swung eighths, a minor
  key), a key change a whole step up, a melody over given chords (chord tones
  on the beat, no clashes, as `harmony` finds them) and a borrowed chord.
  Known solutions use Roland TR-909 drums and built-in synths.
- **recreate** (6): four bars of a real piece from `test/references`, given to
  both conditions as a plain list of notes by bar and beat; scored by
  `compare`'s F1 against the excerpt's MIDI file, halved when the tempo is more
  than 2% off. The Kynska agent can also read that MIDI file with `notes` and
  check its code against it with `compare`.

```bash
KYNSKA_EVAL_BASE_URL=https://api.example.com/v1 KYNSKA_EVAL_API_KEY=... npm run evals -- --model <model>
```

```bash
node evals/run.ts --agent oracle
npm run evals -- --model <model> --repeats 3 --concurrency 4 --minutes 6
```

`--repeats N` runs every task and condition N times (default 1). `--conditions
baseline,kynska` chooses conditions and `--kinds transcribe,describe,produce,recreate`
task kinds; `--tasks id,id` runs only those tasks. The condition
`kynska-without-theory` is the Kynska agent without the theory page, the genre
cards and `harmony`, to measure what they add. `--transcribe N` changes the number of
transcription tasks (default 16). `--minutes M` is the Kynska agent's turn budget
in minutes (default 6), after which it is asked for final code. `--concurrency N`
caps concurrent jobs (default 4); whatever it is, at most two renders run at
once across the run, with each job's layer renders performed one at a time. `--temperature T`
(default 0.6), `--effort E` (`reasoning_effort`, default `medium`; `default`
leaves it out) and `--reasoning-tokens N` (a hard reasoning budget per reply,
default 16000; 0 leaves it out) apply to both conditions. A reasoning model at
temperature 0 can loop in its reasoning, and even at medium effort it can fall
into repeated self-checks and spend every reply token without answering; the
budget makes it answer. Replies are streamed, so long ones do not time out.

The baseline has no tools and returns code. The Kynska agent can draft renders,
measure sections and layers, use `form`, and master audio. Eval renders download
and cache sounds like the CLI does (set `KYNSKA_EVAL_OFFLINE=1` to use only
cached sounds on a machine with no network), write WAVs in temporary directories
and remove them after the run; each render is capped at 32 seconds including
tails. Production answers
from both conditions get the same final render, with mastering applied only
when the brief asks for it; on those briefs the mix before mastering must not
clip and must need at most 6 dB of limiting. Evaluation errors and unplayable sounds score zero.
The oracle uses known solutions without model or network calls and exits with
a failure status if any task scores below 1.

Any OpenAI-compatible API works. Results go to `out/evals/<run>/`: `summary.md`,
`results.jsonl`, and each conversation (separate files for each repeat).
The summary groups runs by condition and task kind, reporting mean scores,
the min–max of each repeat's mean score, perfect runs and failures to answer,
and how many of those failures were replies cut off by the token cap.
That range measures run-to-run spread rather than differences between tasks.
Its costs are per-run means:
turns, tool calls, tokens, elapsed seconds, render calls and rendered audio
seconds. Render costs include agent drafts and the final scoring render;
audio seconds include each solo layer and tails. Empty replies and agent errors
count as failures to answer; invalid code counts as an answer scoring zero.
`results.jsonl` keeps individual repeats and costs for closer comparisons.
