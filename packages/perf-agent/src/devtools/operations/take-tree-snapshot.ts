import type { DevtoolsElementTree } from "../../types/element-tree.js";
import type { ReactProfilerSnapshotNode } from "../../types/profiling-export.js";

/**
 * Walks the reconstructed element tree from a root into the `snapshots` map the
 * DevTools profiling export expects (id → node). Mirrors the Store's
 * `_takeProfilingSnapshotRecursive`.
 */
export const takeTreeSnapshot = (
  tree: DevtoolsElementTree,
  rootID: number,
): Map<number, ReactProfilerSnapshotNode> => {
  const snapshots = new Map<number, ReactProfilerSnapshotNode>();
  const visit = (id: number): void => {
    const node = tree.get(id);
    if (node === undefined) return;
    snapshots.set(id, {
      id: node.id,
      children: node.children.slice(),
      displayName: node.displayName,
      hocDisplayNames: node.hocDisplayNames,
      key: node.key,
      type: node.type,
      compiledWithForget: node.compiledWithForget,
    });
    for (const childID of node.children) visit(childID);
  };
  visit(rootID);
  return snapshots;
};
