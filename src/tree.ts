import { ROOT_SENTINEL } from './api';
import type { ConversationTree, RawConversation, RawMessage, TreeNode } from './types';

/**
 * Conversations are deep and narrow, so the tree reads left-to-right: depth runs
 * along the wide axis of the overlay and branches fan out vertically.
 */
export const DEPTH_GAP = 46;
export const SIBLING_GAP = 26;
export const MARGIN = 36;

function messageText(message: RawMessage): string {
  const blocks = message.content ?? [];
  const text = blocks
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!.trim())
    .join('\n\n')
    .trim();
  if (text) return text;
  if (message.text?.trim()) return message.text.trim();

  // Turns that are pure tool use / thinking still deserve a node and a label.
  const kinds = [...new Set(blocks.map((block) => block.name ?? block.type))];
  return kinds.length ? `[${kinds.join(', ')}]` : '[empty]';
}

/**
 * Sibling order matters: it has to match the order claude.ai's `< 2/3 >` pager
 * steps through, otherwise branch switching clicks the wrong way. Edits append,
 * so creation time is the ordering.
 */
function sortSiblings(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (byTime) return byTime;
    return a.id.localeCompare(b.id);
  });
  nodes.forEach((node, index) => {
    node.siblingIndex = index;
    node.siblingCount = nodes.length;
  });
}

export function buildTree(conversation: RawConversation): ConversationTree {
  const byId = new Map<string, TreeNode>();

  for (const message of conversation.chat_messages) {
    byId.set(message.uuid, {
      id: message.uuid,
      parentId: null,
      sender: message.sender,
      text: messageText(message),
      createdAt: message.created_at,
      children: [],
      depth: 0,
      siblingIndex: 0,
      siblingCount: 1,
      onCurrentPath: false,
      isCurrentLeaf: false,
      x: 0,
      y: 0,
    });
  }

  const roots: TreeNode[] = [];
  for (const message of conversation.chat_messages) {
    const node = byId.get(message.uuid)!;
    const parent =
      message.parent_message_uuid && message.parent_message_uuid !== ROOT_SENTINEL
        ? byId.get(message.parent_message_uuid)
        : undefined;
    if (parent) {
      node.parentId = parent.id;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortSiblings(roots);
  for (const node of byId.values()) sortSiblings(node.children);

  // Depths, walked from the roots so an orphaned cycle can't hang us.
  const stack = [...roots];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    for (const child of node.children) {
      child.depth = node.depth + 1;
      stack.push(child);
    }
  }

  const currentPath = resolveCurrentPath(byId, roots, conversation.current_leaf_message_uuid);
  const currentPathIds = new Set(currentPath.map((node) => node.id));
  for (const node of currentPath) node.onCurrentPath = true;
  if (currentPath.length) currentPath[currentPath.length - 1].isCurrentLeaf = true;

  const { width, height } = layout(roots);

  return {
    conversationId: conversation.uuid,
    name: conversation.name || 'Untitled',
    roots,
    byId,
    currentPath,
    currentPathIds,
    width,
    height,
  };
}

function resolveCurrentPath(
  byId: Map<string, TreeNode>,
  roots: TreeNode[],
  leafId: string | null,
): TreeNode[] {
  let leaf = leafId ? byId.get(leafId) : undefined;

  // Fall back to the newest branch if the API gave us no usable leaf.
  if (!leaf && roots.length) {
    let node: TreeNode | undefined = roots[roots.length - 1];
    while (node?.children.length) node = node.children[node.children.length - 1];
    leaf = node;
  }
  if (!leaf) return [];

  const path: TreeNode[] = [];
  for (let node: TreeNode | undefined = leaf; node; node = node.parentId ? byId.get(node.parentId) : undefined) {
    path.push(node);
    if (path.length > 10_000) break;
  }
  return path.reverse();
}

/**
 * Tidy-ish layout: every leaf gets its own row, every parent centres against its
 * children. Good enough for conversation trees, which are deep and narrow.
 */
function layout(roots: TreeNode[]): { width: number; height: number } {
  let nextLeafRow = 0;
  let maxDepth = 0;

  const place = (node: TreeNode): void => {
    maxDepth = Math.max(maxDepth, node.depth);
    node.x = MARGIN + node.depth * DEPTH_GAP;
    if (node.children.length === 0) {
      node.y = MARGIN + nextLeafRow * SIBLING_GAP;
      nextLeafRow += 1;
      return;
    }
    for (const child of node.children) place(child);
    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    node.y = (first.y + last.y) / 2;
  };

  for (const root of roots) place(root);

  return {
    width: MARGIN * 2 + maxDepth * DEPTH_GAP,
    height: MARGIN * 2 + Math.max(0, nextLeafRow - 1) * SIBLING_GAP,
  };
}

/** Root -> node, inclusive. */
export function pathTo(tree: ConversationTree, id: string): TreeNode[] {
  const path: TreeNode[] = [];
  let node = tree.byId.get(id);
  while (node) {
    path.push(node);
    node = node.parentId ? tree.byId.get(node.parentId) : undefined;
  }
  return path.reverse();
}

/** Nodes with more than one child are exactly the points where you edited a message. */
export function countForks(tree: ConversationTree): number {
  let forks = 0;
  for (const node of tree.byId.values()) if (node.children.length > 1) forks += 1;
  return forks + (tree.roots.length > 1 ? 1 : 0);
}

export function countLeaves(tree: ConversationTree): number {
  let leaves = 0;
  for (const node of tree.byId.values()) if (node.children.length === 0) leaves += 1;
  return leaves;
}
