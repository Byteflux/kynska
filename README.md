# Kynska

Docs, skills and tooling for coding agents that make music with
[Strudel](https://strudel.cc), from first idea to finished piece.

Kynska holds only its own tooling. It contains no Strudel code, docs or
examples: the tooling fetches Strudel at a pinned version and generates
everything else locally, into `.cache/` and `out/`, which git ignores.

## Parts

| Part | What it does | Status |
|---|---|---|
| Patterns | Evaluates Strudel code headlessly and lists the events it produces, so an agent checks a pattern by its notes and timings instead of by listening | `kynska events` works |
| Knowledge | Generates agent-ready docs from Strudel's source: `llms.txt`, Markdown pages, and a per-function reference | planned |
| Skills | Instructions for music-making tasks that check their work with the tooling | planned |
| Evals | Tasks scored in code, built from Strudel's documented examples | planned |

## Use

Requires Node 24 or later. TypeScript runs directly, with no build step.

```bash
npm install
```

```bash
echo 's("bd(3,8), hh*4")' | node src/cli.ts events --cycles 2
```

```bash
node src/cli.ts events pattern.js --json
```

## Develop

```bash
npm run check
```

This runs the type check and the tests.
