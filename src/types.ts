export type Sender = 'human' | 'assistant';

export interface RawContentBlock {
  type: string;
  text?: string;
  name?: string;
}

export interface RawMessage {
  uuid: string;
  parent_message_uuid: string;
  sender: Sender;
  index: number;
  created_at: string;
  content?: RawContentBlock[];
  text?: string;
}

export interface RawConversation {
  uuid: string;
  name: string;
  current_leaf_message_uuid: string | null;
  chat_messages: RawMessage[];
}

export interface TreeNode {
  id: string;
  parentId: string | null;
  sender: Sender;
  text: string;
  createdAt: string;
  children: TreeNode[];
  /** 0 for the first message in the conversation. */
  depth: number;
  /** Position among siblings, in the same order claude.ai's `< 2/3 >` pager uses. */
  siblingIndex: number;
  siblingCount: number;
  onCurrentPath: boolean;
  isCurrentLeaf: boolean;
  x: number;
  y: number;
}

export interface ConversationTree {
  conversationId: string;
  name: string;
  roots: TreeNode[];
  byId: Map<string, TreeNode>;
  /** Root -> current leaf, in order. Mirrors the messages rendered on screen. */
  currentPath: TreeNode[];
  currentPathIds: Set<string>;
  width: number;
  height: number;
}
