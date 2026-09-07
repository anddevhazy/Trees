import type { ConversationTree, TreeInput, TreeNode, TreeSource } from './types.js';

/**
 * Conversations are deep and narrow, so trees read left-to-right: depth runs
 * along the wide axis and branches fan out vertically.
 */
export const DEPTH_GAP = 46;
export const SIBLING_GAP = 26;
export const MARGIN = 36;

/**
 * Sibling order matters: for claude.ai it has to match the order the `< 2/3 >`
 * pager steps through, or branch switching clicks the wrong way. Edits append,
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

function toNode(input: TreeInput): TreeNode {
  return {
    ...input,
    children: [],
    depth: 0,
    siblingIndex: 0,
    siblingCount: 1,
    onCurrentPath: false,
    isCurrentLeaf: false,
    x: 0,
    y: 0,
  };
}

export function buildTree(source: TreeSource): ConversationTree {
  const byId = new Map<string, TreeNode>();
  for (const input of source.nodes) byId.set(input.id, toNode(input));

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  sortSiblings(roots);
  for (const node of byId.values()) sortSiblings(node.children);

  // Depths, walked from the roots so a cycle in bad data can't hang us.
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

  const currentPath = resolveCurrentPath(byId, roots, source.currentLeafId);
  for (const node of currentPath) node.onCurrentPath = true;
  if (currentPath.length) currentPath[currentPath.length - 1].isCurrentLeaf = true;

  const { width, height } = layout(roots);

  return {
    id: source.id,
    name: source.name,
    roots,
    byId,
    currentPath,
    currentPathIds: new Set(currentPath.map((node) => node.id)),
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

  // Fall back to the newest branch if there is no usable leaf pointer.
  if (!leaf && roots.length) {
    let node: TreeNode | undefined = roots[roots.length - 1];
    while (node?.children.length) node = node.children[node.children.length - 1];
    leaf = node;
  }
  if (!leaf) return [];

  const path: TreeNode[] = [];
  for (let node: TreeNode | undefined = leaf; node; ) {
    path.push(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
    if (path.length > 100_000) break;
  }
  return path.reverse();
}

/**
 * Tidy-ish layout: every leaf gets its own row, every parent centres against
 * its children. Iterative, because transcripts get thousands of turns deep.
 */
function layout(roots: TreeNode[]): { width: number; height: number } {
  let nextLeafRow = 0;
  let maxDepth = 0;

  for (const root of roots) {
    const stack: Array<{ node: TreeNode; entered: boolean }> = [{ node: root, entered: false }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const { node } = frame;
      if (!frame.entered) {
        frame.entered = true;
        maxDepth = Math.max(maxDepth, node.depth);
        node.x = MARGIN + node.depth * DEPTH_GAP;
        if (node.children.length === 0) {
          node.y = MARGIN + nextLeafRow * SIBLING_GAP;
          nextLeafRow += 1;
          stack.pop();
          continue;
        }
        for (let i = node.children.length - 1; i >= 0; i -= 1) {
          stack.push({ node: node.children[i], entered: false });
        }
        continue;
      }
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      node.y = (first.y + last.y) / 2;
      stack.pop();
    }
  }

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

/** The deepest node both branches share — where a diff should start. */
export function commonAncestor(
  tree: ConversationTree,
  a: string,
  b: string,
): { ancestor: TreeNode | null; left: TreeNode[]; right: TreeNode[] } {
  const left = pathTo(tree, a);
  const right = pathTo(tree, b);
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared].id === right[shared].id) {
    shared += 1;
  }
  return {
    ancestor: shared ? left[shared - 1] : null,
    left: left.slice(shared),
    right: right.slice(shared),
  };
}

/** Nodes with more than one child are exactly the points where the conversation forked. */
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
