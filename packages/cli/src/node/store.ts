import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadDetail, readCwd, scanSession, type SessionScan } from './parse.js';
import { PROJECTS_DIR, slugToDisplayPath } from './paths.js';
import type { NodeDetail, ProjectSummary, SessionSummary } from './types.js';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'claude-trees');
const CACHE_FILE = path.join(CACHE_DIR, 'summaries.json');

/**
 * Bump when the parser changes shape. Entries are keyed on the transcript's
 * mtime and size, which say nothing about how it was interpreted, so without
 * this a parser fix would keep serving summaries computed by the old one.
 */
const SCHEMA = 2;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  summary: SessionSummary;
}

/**
 * Scanning a transcript costs a full read, and one of these files can be tens
 * of megabytes, so session summaries are cached against the file's mtime and
 * size. A session that is still being written re-scans on its next change.
 */
class SummaryCache {
  private entries = new Map<string, CacheEntry>();
  private loaded = false;
  private dirty = false;

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as {
        schema?: number;
        entries?: Record<string, CacheEntry>;
      };
      if (raw.schema === SCHEMA && raw.entries) this.entries = new Map(Object.entries(raw.entries));
    } catch {
      // No cache yet, or it is unreadable; rebuilding is cheap enough.
    }
  }

  get(key: string, stat: fs.Stats): SessionSummary | null {
    this.load();
    const hit = this.entries.get(key);
    if (!hit || hit.mtimeMs !== stat.mtimeMs || hit.size !== stat.size) return null;
    return hit.summary;
  }

  set(key: string, stat: fs.Stats, summary: SessionSummary): void {
    this.load();
    this.entries.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, summary });
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(
      CACHE_FILE,
      JSON.stringify({ schema: SCHEMA, entries: Object.fromEntries(this.entries) }),
    );
  }
}

const cache = new SummaryCache();

/** Parsed sessions are large, so only the last couple stay resident. */
const recent = new Map<string, { key: string; scan: SessionScan }>();
const RECENT_LIMIT = 2;

export function sessionFile(slug: string, sessionId: string): string {
  return path.join(PROJECTS_DIR, slug, `${sessionId}.jsonl`);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let dirs: fs.Dirent[];
  try {
    dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: ProjectSummary[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(PROJECTS_DIR, dir.name);
    const files = (await fsp.readdir(full)).filter((name) => name.endsWith('.jsonl'));
    if (!files.length) continue;

    let lastActive = 0;
    let newest = files[0];
    for (const file of files) {
      const stat = await fsp.stat(path.join(full, file)).catch(() => null);
      if (!stat) continue;
      if (stat.mtimeMs > lastActive) newest = file;
      lastActive = Math.max(lastActive, stat.mtimeMs);
    }

    // The slug is a lossy encoding of the directory ("my-app" and "my/app"
    // collapse together), so prefer the real cwd recorded inside a session.
    const cwd = await readCwd(path.join(full, newest));

    projects.push({
      slug: dir.name,
      path: cwd ?? slugToDisplayPath(dir.name),
      sessions: files.length,
      lastActive: lastActive ? new Date(lastActive).toISOString() : null,
    });
  }

  return projects.sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
}

export async function listSessions(slug: string): Promise<SessionSummary[]> {
  const dir = path.join(PROJECTS_DIR, slug);
  const files = (await fsp.readdir(dir).catch(() => [])).filter((name) => name.endsWith('.jsonl'));

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;
    const id = file.replace(/\.jsonl$/, '');
    const key = `${slug}/${id}`;

    const cached = cache.get(key, stat);
    if (cached) {
      summaries.push(cached);
      continue;
    }
    const scan = await scanSession(full, id);
    cache.set(key, stat, scan.summary);
    summaries.push(scan.summary);
  }

  await cache.flush();
  return summaries.sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
}

export async function getSession(slug: string, sessionId: string): Promise<SessionScan> {
  const file = sessionFile(slug, sessionId);
  const stat = await fsp.stat(file);
  const key = `${slug}/${sessionId}/${stat.mtimeMs}/${stat.size}`;

  const hit = recent.get(sessionId);
  if (hit?.key === key) return hit.scan;

  const scan = await scanSession(file, sessionId);
  recent.set(sessionId, { key, scan });
  while (recent.size > RECENT_LIMIT) {
    const oldest = recent.keys().next().value;
    if (oldest === undefined) break;
    recent.delete(oldest);
  }

  cache.set(`${slug}/${sessionId}`, stat, scan.summary);
  await cache.flush();
  return scan;
}

export async function getNodeDetail(
  slug: string,
  sessionId: string,
  nodeId: string,
): Promise<NodeDetail | null> {
  const scan = await getSession(slug, sessionId);
  const rawUuids = scan.rawByNode.get(nodeId);
  if (!rawUuids) return null;
  return loadDetail(sessionFile(slug, sessionId), nodeId, rawUuids);
}
