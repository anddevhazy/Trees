export type Sender = 'human' | 'assistant';

export interface ToolCall {
  name: string;
  /** The most identifying argument: a file path, a command, a URL. */
  target?: string;
}

/** Side effects and provenance for a turn. Populated by the Claude Code source. */
export interface NodeMeta {
  model?: string;
  tools?: ToolCall[];
  filesTouched?: string[];
  commands?: string[];
  /** True when `text` is a preview and the full body must be fetched. */
  truncated?: boolean;
}

/** The minimum a data source has to produce. */
export interface TreeInput {
  id: string;
  parentId: string | null;
  sender: Sender;
  text: string;
  createdAt: string;
  meta?: NodeMeta;
}

export interface TreeNode extends TreeInput {
  children: TreeNode[];
  /** 0 for the first message. */
  depth: number;
  /** Position among siblings, in the order claude.ai's `< 2/3 >` pager steps through. */
  siblingIndex: number;
  siblingCount: number;
  onCurrentPath: boolean;
  isCurrentLeaf: boolean;
  x: number;
  y: number;
}

export interface TreeSource {
  id: string;
  name: string;
  nodes: TreeInput[];
  currentLeafId: string | null;
}

export interface ConversationTree {
  id: string;
  name: string;
  roots: TreeNode[];
  byId: Map<string, TreeNode>;
  /** Root -> current leaf, in order. Mirrors what is on screen. */
  currentPath: TreeNode[];
  currentPathIds: Set<string>;
  width: number;
  height: number;
}
