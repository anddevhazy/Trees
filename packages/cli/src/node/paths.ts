import os from 'node:os';
import path from 'node:path';

export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Claude Code encodes a working directory as a flat slug by replacing every
 * separator with "-", which is lossy: "/Users/me/my-app" and "/Users/me/my/app"
 * collapse to the same string. Sessions carry the real `cwd`, so the slug is
 * only ever a fallback label.
 */
export function slugToDisplayPath(slug: string): string {
  return slug.startsWith('-') ? `/${slug.slice(1).replace(/-/g, '/')}` : slug;
}

export function shortenPath(dir: string): string {
  const home = os.homedir();
  return dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
}
