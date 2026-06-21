import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";

// Visit every direct child AST node of `node` (array entries and single
// nodes alike), skipping the `parent` back-reference. The shared traversal
// mechanics behind the recursive walkers in build/ and analysis/; callers
// own the recursion and any function-boundary stop.
export const forEachChildNode = (node: EsTreeNode, visit: (child: EsTreeNode) => void): void => {
  const record = node as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) if (isAstNode(item)) visit(item);
    } else if (isAstNode(child)) {
      visit(child);
    }
  }
};
