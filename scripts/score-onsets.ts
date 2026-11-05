// Score onset detection on rendered patterns: onsets found and extras.
import { detectOnsets, matchOnsets } from '../src/audio/analyse.ts';
import { renderCode } from '../src/audio/render.ts';

const patterns = [
  'note("c3 e3 g3 b3").s("sawtooth")',
  's("bd sd [~ bd] sd, hh*8")',
  'note("<[c3,e3,g3] [f3,a3,c4]>").s("piano")',
  'n("0 1 2 3 4 5 6 7").scale("C:minor").s("triangle")',
  'note("c2*8").s("sawtooth").lpf(400)',
  's("bd*4").bank("RolandTR909")',
  'note("c4 c4 c4 c4").s("sine")',
  'note("c3 [e3 g3]").s("supersaw").room(0.5)',
  'n("0 2 4 7").scale("C:major").s("piano").slow(2)',
  'note("c3 ~ e3 ~").s("square").decay(0.1).sustain(0)',
  's("hh*16").gain(".4 1")',
  's("[bd sd]*2, ~ cp").bank("RolandTR808")',
];
const frac = (f: string) => {
  const [n, d = '1'] = f.split('/');
  return Number(n) / Number(d);
};
let expected = 0;
let matched = 0;
let extra = 0;
for (const code of patterns) {
  const r = await renderCode(code, { cycles: 2 });
  const m = matchOnsets(detectOnsets(r.channels, r.sampleRate), r.events.map((e) => frac(e.begin) / r.cps));
  expected += m.expected;
  matched += m.matched;
  extra += m.extra.length;
  console.log(`${m.matched}/${m.expected} +${m.extra.length}`.padEnd(10), code);
}
console.log(`total ${matched}/${expected}, ${extra} extra`);
process.exit(0);
