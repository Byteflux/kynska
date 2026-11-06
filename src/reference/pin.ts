import { readFile } from 'node:fs/promises';
import { PIN_FILE } from '../paths.ts';

/**
 * The Strudel commit Kynska runs, documents and checks against (strudel.json): a
 * commit on Strudel's main branch, which strudel.cc deploys on every push. The
 * packages are linked from that commit's source (scripts/link-strudel.ts), so
 * the tools run the same code as the reference and docs describe.
 */
export type StrudelPin = {
  repository: string;
  /** The branch Kynska follows: main, as strudel.cc does. */
  branch: string;
  commit: string;
  /** When the commit was made (ISO 8601), for reports. */
  date: string;
};

const SHA = /^[0-9a-f]{40}$/;

export async function readPin(file = PIN_FILE): Promise<StrudelPin> {
  const pin = JSON.parse(await readFile(file, 'utf8')) as StrudelPin;
  for (const key of ['repository', 'branch', 'commit', 'date'] as const) {
    if (typeof pin[key] !== 'string' || !pin[key]) throw new Error(`${file}: missing "${key}"`);
  }
  if (!SHA.test(pin.commit)) throw new Error(`${file}: "commit" must be a full 40-character SHA`);
  if (Number.isNaN(Date.parse(pin.date))) throw new Error(`${file}: "date" must be an ISO 8601 date`);
  return pin;
}

/** "main at 530e963 (2026-11-01)": how reports and docs name the pinned Strudel. */
export const pinName = (pin: Pick<StrudelPin, 'branch' | 'commit' | 'date'>) => `${pin.branch} at ${pin.commit.slice(0, 7)} (${pin.date.slice(0, 10)})`;
