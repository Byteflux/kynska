// Runs `kynska check` on every example in out/reference.json. Strudel's own
// documented examples are known-good code, so any error here is most likely a
// false positive in check. Run after `kynska reference build`, e.g. when the
// Strudel pin moves: node scripts/check-examples.ts
import { checkCode } from '../src/patterns/check.ts';
import { loadReference, ReferenceIndex } from '../src/reference/lookup.ts';

const reference = new ReferenceIndex(await loadReference());
const warnings: Record<string, number> = {};
const failures: string[] = [];
let total = 0;
for (const fn of reference.reference.functions) {
  for (const [i, example] of fn.examples.entries()) {
    total++;
    const result = await checkCode(example, { reference, cycles: 2 });
    for (const d of result.diagnostics) {
      if (d.severity === 'warning') warnings[d.code] = (warnings[d.code] ?? 0) + 1;
      else failures.push(`${fn.name} example ${i + 1}: [${d.code}] ${d.message}`);
    }
  }
}
console.log(`${total} examples, ${failures.length} errors`);
console.log(`warnings: ${Object.entries(warnings).map(([code, n]) => `${code} ${n}`).join(', ') || 'none'}`);
for (const failure of failures) console.log(`  ${failure}`);
process.exit(failures.length ? 1 : 0);
