// The GitHub Pages site: the built docs as they are (agents fetch llms.txt and
// follow its links), Strudel's licence text, and an index page for people.
// Nothing here is committed: CI builds it and deploys it as a Pages artifact.
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StrudelPin } from '../reference/pin.ts';
import { KYNSKA_URL, sourceUrl, STRUDEL_LICENCE } from './build.ts';

/** What the site serves from `out/`, after `kynska docs build`. */
export const SITE_FILES = ['llms.txt', 'llms-full.txt', 'reference.json', 'docs'];

export type SiteOptions = { outDir: string; siteDir: string; pin: StrudelPin; licenceText: string };

export async function buildSite({ outDir, siteDir, pin, licenceText }: SiteOptions): Promise<string[]> {
  for (const f of SITE_FILES) {
    await stat(join(outDir, f)).catch(() => {
      throw new Error(`${join(outDir, f)} is missing: build the docs first with: kynska docs build`);
    });
  }
  await rm(siteDir, { recursive: true, force: true });
  await mkdir(siteDir, { recursive: true });
  for (const f of SITE_FILES) await cp(join(outDir, f), join(siteDir, f), { recursive: true, dereference: true });
  await writeFile(join(siteDir, 'LICENSE.txt'), licenceText);
  await writeFile(join(siteDir, 'index.html'), indexPage(pin));
  return [...SITE_FILES, 'LICENSE.txt', 'index.html'];
}

export function indexPage(pin: StrudelPin): string {
  const source = sourceUrl(pin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strudel docs for agents</title>
<meta name="description" content="Strudel ${pin.version}'s documentation as Markdown for coding agents and LLMs, with an llms.txt index.">
<link rel="alternate" type="text/plain" href="llms.txt" title="llms.txt">
<style>
  :root { --bg: #fff; --fg: #1b1b1f; --muted: #5c5c66; --link: #0b57d0; --rule: #e3e3e8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #131316; --fg: #e6e6ea; --muted: #a0a0aa; --link: #8ab4f8; --rule: #2c2c33; } }
  body { background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; margin: 0; }
  main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1rem 3rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
  p, li { color: var(--fg); }
  .muted { color: var(--muted); }
  a { color: var(--link); }
  code { font: .92em ui-monospace, monospace; }
  ul { padding-left: 1.2rem; }
  li { margin: .35rem 0; }
  footer { border-top: 1px solid var(--rule); margin-top: 2.5rem; padding-top: 1rem; font-size: .9rem; color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>Strudel docs for agents</h1>
<p>The documentation of <a href="https://strudel.cc">Strudel</a> ${pin.version}, the live coding environment for music in the browser, converted to Markdown for coding agents and language models by <a href="${KYNSKA_URL}">Kynska</a>. Playable examples become code blocks, and the function reference is written out in full.</p>

<h2>Files</h2>
<ul>
  <li><a href="llms.txt"><code>llms.txt</code></a>: an index of every page with a one-line summary, in the <a href="https://llmstxt.org">llms.txt</a> format. Agents start here.</li>
  <li><a href="llms-full.txt"><code>llms-full.txt</code></a>: every page in one file (about 70k tokens).</li>
  <li><a href="docs/reference.md"><code>docs/reference.md</code></a>: every documented function, with how to call it, its parameters and examples (about 60k tokens).</li>
  <li><a href="reference.json"><code>reference.json</code></a>: the same reference as data.</li>
</ul>
<p class="muted">Pages are served as plain Markdown. The community showcase, the example tunes and the German workshop translation are left out: they have licences of their own.</p>

<h2>Licence</h2>
<p>Strudel and its documentation are licensed ${STRUDEL_LICENCE}, and so are these converted docs: <a href="LICENSE.txt">the licence text</a>. They are built from <a href="${source}">Strudel's source at commit ${pin.commit.slice(0, 7)}</a> by <a href="${KYNSKA_URL}">Kynska</a>, whose own code is MIT-licensed.</p>

<footer>Built from Strudel ${pin.version} (${pin.commit.slice(0, 7)}) on every change to Kynska's main branch.</footer>
</main>
</body>
</html>
`;
}
