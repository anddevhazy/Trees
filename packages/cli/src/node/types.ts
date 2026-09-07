import type { NodeMeta, TreeInput } from '@claude-trees/core';

export interface ProjectSummary {
  /** Directory name under ~/.claude/projects, e.g. "-Users-me-dev-app". */
  slug: string;
  /** Best-effort reconstruction of the real working directory. */
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
  /** Branch tips that are no longer reachable from the session's current leaf. */
  abandoned: number;
  startedAt: string | null;
  endedAt: string | null;
  cwd: string | null;
  gitBranch: string | null;
  bytes: number;
}

/** A turn with its full body — fetched on demand, never in the tree payload. */
export interface NodeDetail {
  id: string;
  sender: 'human' | 'assistant';
  createdAt: string;
  text: string;
  meta: NodeMeta;
  /** Tool calls with their arguments and a clipped result. */
  steps: Array<{
    name: string;
    target?: string;
    input: string;
    result?: string;
    isError?: boolean;
  }>;
}

export interface SessionTree {
  id: string;
  name: string;
  nodes: TreeInput[];
  currentLeafId: string | null;
  summary: SessionSummary;
}
