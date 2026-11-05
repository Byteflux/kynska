import { readFile } from 'node:fs/promises';
import { PIN_FILE } from '../paths.ts';

/**
 * The Strudel release Kynska builds against (strudel.json). It must match the
 * @strudel/* versions in package.json, so the reference documents exactly the
 * functions the pattern tools run.
 */
export type StrudelPin = {
  version: string;
  repository: string;
  tag: string;
  commit: string;
};

export async function readPin(file = PIN_FILE): Promise<StrudelPin> {
  const pin = JSON.parse(await readFile(file, 'utf8')) as StrudelPin;
  for (const key of ['version', 'repository', 'tag', 'commit'] as const) {
    if (typeof pin[key] !== 'string' || !pin[key]) throw new Error(`${file}: missing "${key}"`);
  }
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) throw new Error(`${file}: "commit" must be a full 40-character SHA`);
  return pin;
}
