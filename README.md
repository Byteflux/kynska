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
| Patterns | Evaluates Strudel code headlessly, the way the strudel.cc REPL does: `events`, `check`, `diff`. JavaScript, Mondo notation and Tidal notation. |
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
throughout. Every command takes `--json`.

| Command | What it does |
|---|---|
| `events [file] [--cycles N]` | The events a pattern produces in the first N cycles (default 1) |
| `check [file] [--cycles N]` | Syntax, unknown functions and methods (with suggestions), undocumented and browser-only functions, evaluation and query errors, Strudel's own warnings, silence (default 4 cycles) |
| `diff <before> <after> [--cycles N]` | What changed between the events of two versions: changed, removed, added |
| `render [file] [--cycles N] [--out file.wav] [--tail S] [--sample-rate R]` | Renders N cycles (default 4) to a 16-bit WAV (default `./render.wav`) and reports level, loudness (LUFS), clipping, silence, and onsets against the pattern's events |
| `analyse <file.wav>` | The same measurements for any WAV file |
| `lookup <name>` | A function's reference entry: how to call it, parameters, examples, source; finds synonyms and full JSDoc names, and suggests names for typos |
| `lookup --tag <tag>` / `--module <module>` / `--tags` | Functions by tag or source module; the tags |
| `docs build` / `docs path` | Build everything in `out/` (below) / print where it is |
| `reference build` | Build `out/reference.json` only |
| `upstream` | Compare the pinned Strudel with its latest release and `main` |
| `mcp` | Serve `check`, `events`, `diff`, `lookup`, `render` and `docs_path` as MCP tools over stdio |

Exit codes: 0 success; 1 errors found (`check`), a difference (`diff`), an event
that failed to play (`render`, e.g. an unknown sound) or a failure; 2 bad usage.

### Generated docs

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
capped at 600 seconds of audio.

- **Sounds**: strudel.cc's default sample banks, and General MIDI soundfont
  instruments (`gm_*`), downloaded on first use and cached in `.cache/sounds/`.
  Soundfont instrument files are JavaScript that the loader runs with `eval`;
  Kynska only lets through files that are plain data.
- **Onsets**: detected by spectral flux and matched to the pattern's event times
  within 40 ms. On the scoring set (`node scripts/score-onsets.ts`) it finds
  every onset with 2 false onsets in 12 patterns. Slow-attack sounds (flute,
  strings, pads) can show missing onsets.

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

[`strudel.json`](strudel.json) pins the Strudel release Kynska builds against,
and `package.json` pins the matching `@strudel/*` packages and `superdough`. A
test fails when the two drift apart. Strudel added function tags (`@tags`) after
1.2.6, so `tagsCommit` names a later commit whose tags fill in the categories,
matched by function name.

```bash
kynska upstream
```

```bash
node scripts/upgrade-strudel.ts 1.2.7
```

The upgrade script moves the pin and the packages together, rebuilds the docs,
and runs the tests and every sweep below; it leaves the changes for review.

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

`npm run evals` scores a model on 24 tasks, alone (`baseline`) and with the
`strudel` skill plus a `kynska` tool (`kynska`):

- **transcribe** (16): write code producing these events; tasks generated from
  Strudel's documented examples; scored by event F1.
- **describe** (8): a musical brief in words; scored by criteria on the events.

```bash
KYNSKA_EVAL_BASE_URL=https://openrouter.ai/api/v1 KYNSKA_EVAL_API_KEY=... npm run evals -- --model anthropic/claude-sonnet-5.5
```

Any OpenAI-compatible API works. Results go to `out/evals/<run>/`: `summary.md`,
`results.jsonl`, and each conversation.
