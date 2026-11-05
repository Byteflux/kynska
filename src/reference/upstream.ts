// Where Strudel is upstream, compared with what strudel.json pins.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StrudelPin } from './pin.ts';

const run = promisify(execFile);

/** Packages pinned to the Strudel version in package.json; an upgrade moves them together. */
export const PINNED_PACKAGES = ['@strudel/core', '@strudel/mini', '@strudel/tonal', '@strudel/transpiler', '@strudel/xen', 'superdough'];

/** The latest version of a package on npm. */
export async function latestVersion(pkg: string): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`npm registry: ${pkg} ${response.status}`);
  const data = (await response.json()) as { 'dist-tags': { latest: string } };
  return data['dist-tags'].latest;
}

/** Whether npm has this exact version of a package. */
export async function hasVersion(pkg: string, version: string): Promise<boolean> {
  const response = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}/${version}`, { signal: AbortSignal.timeout(20_000) });
  return response.ok;
}

async function lsRemote(repository: string, ref: string): Promise<string | undefined> {
  const { stdout } = await run('git', ['ls-remote', repository, ref, `${ref}^{}`]);
  const lines = stdout.trim().split('\n').filter(Boolean);
  // An annotated tag lists the tag object and, with ^{}, the commit it points at.
  const peeled = lines.find((l) => l.endsWith('^{}')) ?? lines[0];
  return peeled?.split('\t')[0];
}

/** The commit a release was published from: the @strudel/core@<version> tag. */
export function releaseCommit(repository: string, version: string): Promise<string | undefined> {
  return lsRemote(repository, `refs/tags/@strudel/core@${version}`);
}

export function mainCommit(repository: string): Promise<string | undefined> {
  return lsRemote(repository, 'refs/heads/main');
}

export type UpstreamStatus = {
  pinned: StrudelPin;
  latestRelease: string;
  main?: string;
};

export async function upstreamStatus(pin: StrudelPin): Promise<UpstreamStatus> {
  const [latestRelease, main] = await Promise.all([latestVersion('@strudel/core'), mainCommit(pin.repository)]);
  return { pinned: pin, latestRelease, main };
}

export function formatUpstream(status: UpstreamStatus): string {
  const { pinned, latestRelease, main } = status;
  const short = (sha?: string) => sha?.slice(0, 7) ?? 'unknown';
  const lines = [`Pinned: Strudel ${pinned.version} (${short(pinned.commit)})${pinned.tagsCommit ? `, tags from ${short(pinned.tagsCommit)}` : ''}`];
  lines.push(
    latestRelease === pinned.version
      ? `Latest release on npm: ${latestRelease}, the pinned one.`
      : `Latest release on npm: ${latestRelease}. Upgrade with: node scripts/upgrade-strudel.ts ${latestRelease}`,
  );
  if (main) {
    const tagsCurrent = pinned.tagsCommit === main;
    lines.push(`Strudel main: ${short(main)}${pinned.tagsCommit ? (tagsCurrent ? ' (tags are from it)' : ' (newer than the tags; the upgrade script refreshes them)') : ''}`);
  }
  return lines.join('\n');
}
