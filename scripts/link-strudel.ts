// Links Strudel's packages at the commit strudel.json pins into node_modules:
// node scripts/link-strudel.ts. npm runs it after every install (postinstall).
import { linkStrudel } from '../src/reference/link.ts';
import { pinName, readPin } from '../src/reference/pin.ts';

const pin = await readPin();
const { linked } = await linkStrudel(pin);
console.log(`Linked Strudel ${pinName(pin)}: ${linked.join(', ')}`);
