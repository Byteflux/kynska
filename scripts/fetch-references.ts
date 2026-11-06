// Fetches the reference excerpts in test/references/ from the Mutopia Project:
// node scripts/fetch-references.ts
// Each piece's metadata (.rdf) must say it is in the public domain; any other
// licence stops the script, so nothing under a share-alike or attribution licence
// lands in this MIT repository. Writes each excerpt as a MIDI file and SOURCES.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../src/paths.ts';
import { excerptMidi } from '../src/score/excerpt.ts';
import { readReferenceScore } from '../src/score/reference-score.ts';

const BASE = 'https://www.mutopiaproject.org/ftp/';

/** dir: the piece's folder under ftp/; bars: the excerpt; covers: what it tests. */
export const PIECES: { name: string; dir: string; bars: [number, number]; covers: string }[] = [
  { name: 'old-hundredth', dir: 'BourgeoisL/Old100', bars: [1, 4], covers: 'four-part hymn, chords' },
  { name: 'easter-hymn', dir: 'Anonymous/Easter', bars: [1, 4], covers: 'hymn, voices moving apart' },
  { name: 'slumber-my-darling', dir: 'FosterSC/slumber', bars: [1, 8], covers: 'song with accompaniment' },
  { name: 'greensleeves', dir: 'Traditional/greensleeves', bars: [1, 8], covers: 'hymn tune in a compound metre' },
  { name: 'brahms-lullaby', dir: 'BrahmsJ/LullabyBrahms-C', bars: [1, 8], covers: '3/4, pickup' },
  { name: 'gymnopedie-1', dir: 'SatieE/gymnopedie_1', bars: [1, 8], covers: '3/4, held bass and chords' },
  { name: 'entertainer', dir: 'JoplinS/entertainer', bars: [5, 8], covers: '2/4 ragtime, syncopation, ties' },
  { name: 'menuet-k2', dir: 'MozartWA/KV2/menuet_k2', bars: [1, 8], covers: '3/4 minuet, two hands' },
  { name: 'fur-elise', dir: 'BeethovenLv/WoO59/fur_Elise_WoO59', bars: [1, 8], covers: '3/8, pickup, two hands' },
  { name: 'chopin-prelude-4', dir: 'ChopinFF/O28/Chop-28-4', bars: [1, 4], covers: 'repeated chords under a held melody' },
  { name: 'old-french-song', dir: 'TchaikovskyPI/O39/16OldFrenchSong', bars: [1, 8], covers: 'melody over an accompaniment' },
  { name: 'tambourin', dir: 'RameauJP/tambourin', bars: [1, 8], covers: '2/4, drone bass' },
  { name: 'carcassi-op60-3', dir: 'CarcassiM/O60/carcassi-op60-03', bars: [1, 4], covers: 'guitar arpeggios' },
  { name: 'musical-joke', dir: 'MozartWA/KV522/k522-mv1', bars: [1, 8], covers: 'horns and strings, several tracks' },
  { name: 'clair-de-lune', dir: 'DebussyC/L75/debussy_Ste_Bergamesq_Clair', bars: [1, 4], covers: '9/8, ties across beats' },
  { name: 'moonlight-duo', dir: 'BeethovenLv/O27/moonlight-guitar-duo', bars: [1, 4], covers: 'triplets' },
  { name: 'wtk-prelude-1-duo', dir: 'BachJS/BWV846/wtk1-prelude1-guitar-duo', bars: [1, 4], covers: 'arpeggios with held notes' },
];

const field = (rdf: string, name: string) => new RegExp(`<mp:${name}>([^<]*)</mp:${name}>`).exec(rdf)?.[1]?.trim() ?? '';

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

const out = join(ROOT, 'test', 'references');
await mkdir(out, { recursive: true });
const rows: string[] = [];
for (const piece of PIECES) {
  const id = piece.dir.split('/').pop()!;
  const folder = `${BASE}${piece.dir}/`;
  const rdf = await (await get(`${folder}${id}.rdf`)).text();
  const licence = field(rdf, 'licence');
  if (licence !== 'Public Domain') throw new Error(`${piece.name}: licence is "${licence}", not Public Domain`);
  const midFile = field(rdf, 'midFile');
  if (!midFile.endsWith('.mid')) throw new Error(`${piece.name}: the MIDI is "${midFile}", not a single .mid file`);
  const score = readReferenceScore(new Uint8Array(await (await get(`${folder}${midFile}`)).arrayBuffer()), midFile);
  const excerpt = excerptMidi(score, piece.bars);
  await writeFile(join(out, `${piece.name}.mid`), excerpt);
  const check = readReferenceScore(excerpt, piece.name);
  console.log(`${piece.name}: bars ${piece.bars.join('-')} of ${score.bars.length}, ${check.parts.length} parts, ${check.parts.reduce((n, p) => n + p.notes.length, 0)} notes`);
  rows.push(`| ${piece.name}.mid | ${field(rdf, 'title')} | ${field(rdf, 'composer')} | ${piece.bars.join('-')} | ${piece.covers} | [${field(rdf, 'id')}](${folder}) |`);
}
await writeFile(
  join(out, 'SOURCES.md'),
  [
    '# Reference excerpts',
    '',
    'Excerpts of MIDI files from the [Mutopia Project](https://www.mutopiaproject.org/), each from a piece whose metadata says it is in the public domain. `node scripts/fetch-references.ts` fetches them again and checks each licence.',
    '',
    '| File | Title | Composer | Bars | Covers | Mutopia |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n'),
);
