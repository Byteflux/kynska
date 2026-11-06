// Strudel's source at one commit: a shallow git checkout in .cache/strudel/<sha>.
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CACHE_DIR } from '../paths.ts';
import type { StrudelPin } from './pin.ts';

const run = promisify(execFile);

async function headOf(dir: string): Promise<string | undefined> {
  try {
    return (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
  } catch {
    return undefined;
  }
}

/** A shallow checkout of one commit, fetched by its SHA and reused when already present. */
export async function fetchCommit(repository: string, commit: string, cacheDir = CACHE_DIR): Promise<string> {
  const dir = join(cacheDir, 'strudel', commit);
  if ((await headOf(dir)) === commit) return dir;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await run('git', ['-C', dir, 'init', '--quiet']);
  await run('git', ['-C', dir, 'fetch', '--quiet', '--depth', '1', repository, commit]);
  await run('git', ['-C', dir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD']);
  const head = await headOf(dir);
  if (head !== commit) throw new Error(`fetched ${head} from ${repository}, expected ${commit}`);
  return dir;
}

/** A shallow checkout of Strudel at the pinned commit. */
export function fetchStrudel(pin: StrudelPin, cacheDir = CACHE_DIR): Promise<string> {
  return fetchCommit(pin.repository, pin.commit, cacheDir);
}

/** When a commit in a checkout was made, ISO 8601. */
export async function commitDate(dir: string): Promise<string> {
  return (await run('git', ['-C', dir, 'log', '-1', '--format=%cI'])).stdout.trim();
}
