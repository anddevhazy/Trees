import type { TreeInput } from '@claude-trees/core';
import { turnSignature } from './parse.js';
import type { SessionScan } from './parse.js';

/** Where a merged node's full content has to be read back from. */
export interface NodeOrigin {
  sessionId: string;
  rawUuids: string[];
}

export interface MergedTree {
  nodes: TreeInput[];
  currentLeafId: string | null;
  origins: Map<string, NodeOrigin>;
  /** Sessions that contributed, trunk first. */
  sessionIds: string[];
}

/**
 * Grafts forked copies of one conversation into a single tree.
 *
 * Forking a session writes a whole new transcript that repeats the shared
 * prefix with fresh uuids, so on disk the branches look like unrelated
 * conversations. The repeated turns keep their original timestamps and text,
 * which is what lets them be matched back up: walk each copy from the root,
 * reuse any turn that matches one already merged, and hang the rest off the
 * last turn they had in common.
 */
export function mergeScans(scans: SessionScan[], focusSessionId: string): MergedTree {
  const nodes = new Map<string, TreeInput>();
  const origins = new Map<string, NodeOrigin>();
  /** parent node id (or '' for roots) -> signature -> node id */
  const childIndex = new Map<string, Map<string, string>>();

  const indexFor = (parentId: string | null): Map<string, string> => {
    const key = parentId ?? '';
    let index = childIndex.get(key);
    if (!index) childIndex.set(key, (index = new Map()));
    return index;
  };

  let focusLeaf: string | null = null;

  for (const scan of scans) {
    const childrenOf = new Map<string | null, TreeInput[]>();
    for (const node of scan.nodes) {
      const list = childrenOf.get(node.parentId);
      if (list) list.push(node);
      else childrenOf.set(node.parentId, [node]);
    }

    /** original node id in this scan -> merged node id */
    const mapped = new Map<string, string>();
    const stack: Array<{ node: TreeInput; mergedParent: string | null }> = (
      childrenOf.get(null) ?? []
    ).map((node) => ({ node, mergedParent: null }));

    while (stack.length) {
      const { node, mergedParent } = stack.pop()!;
      const index = indexFor(mergedParent);
      const signature = turnSignature(node);

      let mergedId = index.get(signature);
      if (!mergedId) {
        mergedId = node.id;
        // Two sessions can reuse a uuid for different turns; keep ids unique.
        while (nodes.has(mergedId)) mergedId = `${scan.id}:${mergedId}`;
        index.set(signature, mergedId);
        nodes.set(mergedId, { ...node, id: mergedId, parentId: mergedParent });
        origins.set(mergedId, {
          sessionId: scan.id,
          rawUuids: scan.rawByNode.get(node.id) ?? [],
        });
      }
      mapped.set(node.id, mergedId);

      for (const child of childrenOf.get(node.id) ?? []) {
        stack.push({ node: child, mergedParent: mergedId });
      }
    }

    if (scan.id === focusSessionId && scan.currentLeafId) {
      focusLeaf = mapped.get(scan.currentLeafId) ?? null;
    }
  }

  return {
    nodes: [...nodes.values()],
    currentLeafId: focusLeaf,
    origins,
    sessionIds: scans.map((scan) => scan.id),
  };
}
