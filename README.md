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
| Knowledge | Generates agent-ready docs from Strudel's source | `reference build`, `lookup`; pages and `llms.txt` planned |
| Skills | Instructions for music-making tasks that check their work with the tooling | planned |
| Evals | Tasks scored in code, built from Strudel's documented examples | planned |

## Strudel version

[`strudel.json`](strudel.json) pins the Strudel release Kynska builds against,
and `package.json` pins the `@strudel/*` packages to the same version, so the
reference documents exactly the functions the pattern tools run. A test fails
when the two drift apart.

## Use

Requires Node 24 or later. TypeScript runs directly, with no build step.

```bash
npm install
```

Build the function reference once (fetches the pinned Strudel source into `.cache/`):

```bash
node src/cli.ts reference build
```

Code is read from a file, or from stdin when the file is `-` or omitted. Every
command takes `--json`.

| Command | What it does |
|---|---|
| `events [file] [--cycles N]` | The events a pattern produces in the first N cycles (default 1) |
| `check [file] [--cycles N]` | Syntax, unknown functions and methods (with suggestions), undocumented and browser-only functions, evaluation and query errors, Strudel's own warnings, silence (default 4 cycles) |
| `diff <before> <after> [--cycles N]` | What changed between the events of two versions: changed, removed, added |
| `lookup <name>` | A function's reference entry: how to call it, parameters, examples, source; finds synonyms and suggests names for typos |
| `lookup --tag <tag>` / `--module <module>` | Functions by tag or source module |
| `reference build` | Builds `out/reference.json` from the pinned Strudel source |

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
node src/cli.ts lookup cutoff
```

Exit codes: 0 success; 1 errors found (`check`), a difference (`diff`) or a
failure; 2 bad usage.

### Headless limits

Functions that need a browser (MIDI, motion sensors, CSound, Kabelsalat's `K`,
some visuals) are stood in for with no-ops: `check` warns `browser-only`, and
their own effect is not checked. Code that only works with the real thing
(say, calling the function `midikeys()` returns) gets a warning, not an error.

## Develop

```bash
npm run check
```

This runs the type check and the tests. After building the reference,

```bash
npm run check:examples
```

runs `check` on every documented Strudel example; they are known-good code, so
an error there is a false positive in `check`.
