// Where Strudel's main branch is upstream, compared with what strudel.json pins.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pinName, type StrudelPin } from './pin.ts';

const run = promisify(execFile);

/** The commit a branch points at in a remote repository. */
export async function branchCommit(repository: string, branch: string): Promise<string | undefined> {
  const { stdout } = await run('git', ['ls-remote', repository, `refs/heads/${branch}`]);
  return stdout.trim().split('\t')[0] || undefined;
}

export type UpstreamStatus = { pinned: StrudelPin; head?: string };

export async function upstreamStatus(pin: StrudelPin): Promise<UpstreamStatus> {
  return { pinned: pin, head: await branchCommit(pin.repository, pin.branch) };
}

export function formatUpstream({ pinned, head }: UpstreamStatus): string {
  const lines = [`Pinned: Strudel ${pinName(pinned)}, which strudel.cc deploys from ${pinned.branch}.`];
  if (!head) lines.push(`Could not read ${pinned.branch} from ${pinned.repository}.`);
  else if (head === pinned.commit) lines.push(`Strudel ${pinned.branch} is still at ${head.slice(0, 7)}: up to date.`);
  else lines.push(`Strudel ${pinned.branch} has moved to ${head.slice(0, 7)}. Move to it with: node scripts/upgrade-strudel.ts`);
  return lines.join('\n');
}
