import type { TreeInput } from '@claude-trees/core';

export interface ProjectSummary {
  slug: string;
  path: string;
  sessions: number;
  lastActive: string | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  firstPrompt: string;
  messages: number;
  forks: number;
  abandoned: number;
  startedAt: string | null;
  endedAt: string | null;
  cwd: string | null;
  gitBranch: string | null;
  bytes: number;
}

export interface SessionPayload {
  id: string;
  name: string;
  nodes: TreeInput[];
  currentLeafId: string | null;
  summary: SessionSummary;
  /** How many transcript files were grafted together (forks of one chat). */
  mergedSessions: number;
}

export interface NodeDetail {
  id: string;
  sender: 'human' | 'assistant';
  createdAt: string;
  text: string;
  meta: {
    model?: string;
    filesTouched?: string[];
    commands?: string[];
  };
  steps: Array<{ name: string; target?: string; input: string; result?: string; isError?: boolean }>;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  projects: () => get<ProjectSummary[]>('/api/projects'),
  sessions: (slug: string) =>
    get<SessionSummary[]>(`/api/projects/${encodeURIComponent(slug)}/sessions`),
  session: (slug: string, id: string) =>
    get<SessionPayload>(`/api/sessions/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`),
  node: (slug: string, id: string, nodeId: string) =>
    get<NodeDetail>(
      `/api/sessions/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}`,
    ),
};
