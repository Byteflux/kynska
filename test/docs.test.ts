import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertPage } from '../src/docs/convert.ts';
import { buildSite } from '../src/docs/site.ts';
import { readSidebar } from '../src/docs/sidebar.ts';
import { ReferenceIndex } from '../src/reference/lookup.ts';
import { entry, smallReference } from './fixtures.ts';

describe('readSidebar', () => {
  const config = `
export type Sidebar = Record<string, { text: string; link: string }[]>;
export const OTHER = 1 as const;
export const SIDEBAR: Record<string, Sidebar> = {
  de: { Workshop: [{ text: 'Intro', link: 'de/workshop/intro' }] },
  en: {
    Workshop: [
      { text: 'First Sounds', link: 'workshop/first-sounds' },
      // { text: 'Hidden', link: 'workshop/hidden' },
      { text: \`First Notes\`, link: 'workshop/first-notes' },
    ],
    'Making Sound': [{ text: 'Samples', link: 'learn/samples' }],
  },
};`;

  it('reads sections in order without running the file', () => {
    expect(readSidebar(config)).toEqual([
      {
        title: 'Workshop',
        links: [
          { text: 'First Sounds', link: 'workshop/first-sounds' },
          { text: 'First Notes', link: 'workshop/first-notes' },
        ],
      },
      { title: 'Making Sound', links: [{ text: 'Samples', link: 'learn/samples' }] },
    ]);
  });

  it('reads another language', () => {
    expect(readSidebar(config, 'de')[0].links[0].link).toBe('de/workshop/intro');
  });
});

describe('convertPage', () => {
  const reference = new ReferenceIndex({
    ...smallReference,
    functions: [
      ...smallReference.functions,
      entry('slow', { longname: 'Pattern.slow', description: 'Slows down; see `fast`. Compares with a < b.', examples: ['s("bd sd").slow(2)'] }),
    ],
  });
  const pages = new Set(['learn/effects', 'learn/samples', 'workshop/first-sounds']);
  const convert = (source: string, slug = 'learn/effects') => convertPage(source, { slug, reference, pages });

  const page = `---
title: Audio effects
layout: ../../layouts/MainLayout.astro
---

import { MiniRepl } from '../../docs/MiniRepl';
import { JsDoc } from '../../docs/JsDoc';

# Audio Effects

Whether you use a synth or a sample, effects can be chained.

<MiniRepl client:idle tune={\`s("bd sd").lpf(800)\`} />

<Box>

A tip with \`code\`.

</Box>

<JsDoc client:idle name="Pattern.slow" h={0} />

See [samples](/learn/samples/#banks), [the workshop](../../workshop/first-sounds/) and [the blog](/blog/).

<img src="/img/flow.png" alt="Signal flow" />

<PitchSlider client:load />

{/* a comment */}
`;

  it('takes the title and first sentence', () => {
    const { title, summary } = convert(page);
    expect(title).toBe('Audio effects');
    expect(summary).toBe('Whether you use a synth or a sample, effects can be chained.');
  });

  it('turns playable examples into code blocks and drops imports and comments', () => {
    const { markdown } = convert(page);
    expect(markdown).toContain('```js\ns("bd sd").lpf(800)\n```');
    expect(markdown).not.toMatch(/import|MiniRepl|a comment/);
  });

  it('embeds reference entries by JSDoc full name, with plain-Markdown descriptions', () => {
    const { markdown, warnings } = convert(page);
    expect(markdown).toContain('Slows down; see `fast`. Compares with a < b.');
    expect(markdown).toContain('```js\ns("bd sd").slow(2)\n```');
    expect(markdown).not.toMatch(/^#+ slow$/m); // h={0}: no heading
    expect(warnings).toEqual([]);
  });

  it('keeps tips as quotes', () => {
    expect(convert(page).markdown).toContain('> A tip with `code`.');
  });

  it('links to generated pages locally and to everything else on strudel.cc', () => {
    const { markdown } = convert(page);
    expect(markdown).toContain('[samples](samples.md#banks)');
    expect(markdown).toContain('[the workshop](../workshop/first-sounds.md)');
    expect(markdown).toContain('[the blog](https://strudel.cc/blog/)');
    expect(markdown).toContain('![Signal flow](https://strudel.cc/img/flow.png)');
  });

  it('replaces interactive widgets with a note', () => {
    expect(convert(page).markdown).toContain('*The live page has a pitch slider here: <https://strudel.cc/learn/effects/>*');
  });

  it('adds a title when the page has none and writes Q&A answers out', () => {
    const { markdown } = convert('---\ntitle: Recap\n---\n\nSome text here that is long enough.\n\n<QA q="Click to see solution" client:visible>\n\nThe answer.\n\n</QA>\n');
    expect(markdown.startsWith('# Recap\n')).toBe(true);
    expect(markdown).toContain('**Solution:**\n\nThe answer.');
  });

  it('marks Mondo notation and leaves out the community tunes player', () => {
    const { markdown, warnings } = convert('# Mondo\n\n<MiniRepl mondo client:idle tune={`(s hh*8)`} />\n\n<MiniRepl client:idle tunes={examples} />\n');
    expect(markdown).toContain('```mondo\n(s hh*8)\n```');
    expect(markdown).toContain('The live page plays example tunes here');
    expect(warnings).toEqual([]);
  });

  it('warns about reference entries it cannot find', () => {
    const { warnings } = convert('# X\n\n<JsDoc name="nothingLikeThis" h={3} />\n');
    expect(warnings).toEqual([expect.stringMatching(/nothingLikeThis/)]);
  });
});

describe('buildSite', () => {
  const pin = { repository: 'https://codeberg.org/uzu/strudel.git', branch: 'main', commit: 'd198910a86fcaecd658ef528bfa6d7884e93490b', date: '2026-01-17T15:26:28-08:00' };

  async function builtDocs() {
    const outDir = await mkdtemp(join(tmpdir(), 'kynska-site-out-'));
    await mkdir(join(outDir, 'docs', 'learn'), { recursive: true });
    for (const [f, text] of [['llms.txt', '# Strudel\n'], ['llms-full.txt', 'all'], ['reference.json', '{}'], ['docs/reference.md', '# ref'], ['docs/learn/sounds.md', '# Sounds']]) {
      await writeFile(join(outDir, f), text);
    }
    return outDir;
  }

  it('serves the built docs as they are, with the licence text and an index page', async () => {
    const outDir = await builtDocs();
    const siteDir = join(outDir, '..', `${outDir.split('/').pop()}-site`);
    try {
      await buildSite({ outDir, siteDir, pin, licenceText: 'GNU AFFERO GENERAL PUBLIC LICENSE' });
      expect(await readFile(join(siteDir, 'llms.txt'), 'utf8')).toBe('# Strudel\n');
      expect(await readFile(join(siteDir, 'docs', 'learn', 'sounds.md'), 'utf8')).toBe('# Sounds');
      expect(await readFile(join(siteDir, 'LICENSE.txt'), 'utf8')).toBe('GNU AFFERO GENERAL PUBLIC LICENSE');
      const index = await readFile(join(siteDir, 'index.html'), 'utf8');
      expect(index).toContain('href="llms.txt"');
      expect(index).toContain('licensed AGPL-3.0-or-later');
      expect(index).toContain('href="https://codeberg.org/uzu/strudel/src/commit/d198910a86fcaecd658ef528bfa6d7884e93490b"');
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await rm(siteDir, { recursive: true, force: true });
    }
  });

  it('refuses to build before the docs are built', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kynska-site-empty-'));
    try {
      await expect(buildSite({ outDir, siteDir: join(outDir, 'site'), pin, licenceText: '' })).rejects.toThrow(/build the docs first/);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
