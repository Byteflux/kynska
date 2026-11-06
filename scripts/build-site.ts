// Builds the GitHub Pages site from the built docs: node scripts/build-site.ts [dir]
// (default site/). Run `kynska docs build` first. CI deploys the folder; it is not committed.
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { buildSite } from '../src/docs/site.ts';
import { OUT_DIR } from '../src/paths.ts';
import { fetchStrudel } from '../src/reference/build.ts';
import { readPin } from '../src/reference/pin.ts';

const siteDir = resolve(process.argv[2] ?? 'site');
const pin = await readPin();
// Strudel's own licence text, from the pinned checkout the docs were built from.
const licenceText = await readFile(join(await fetchStrudel(pin), 'LICENSE'), 'utf8');
const files = await buildSite({ outDir: OUT_DIR, siteDir, pin, licenceText });
console.log(`Built the site in ${relative(process.cwd(), siteDir) || siteDir}: ${files.join(', ')}`);
