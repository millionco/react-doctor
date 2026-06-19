import type { EsTreeNode } from "../src/ast/es-tree-node.js";
import { isAstNode } from "../src/ast/is-ast-node.js";

// Walks the AST setting each child's `.parent` to its owning parent node.
// `oxc-parser` emits an unparented AST, but the CFG's `enclosingFunction`
// walk relies on `node.parent`, so we re-attach here before analyzing a
// freshly parsed fixture.
export const attachParentReferences = (root: EsTreeNode): void => {
  const visit = (node: EsTreeNode, parent: EsTreeNode | null): void => {
    const writableNode = node as unknown as { parent?: EsTreeNode | null };
    writableNode.parent = parent;
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isAstNode(item)) visit(item, node);
        }
      } else if (isAstNode(child)) {
        visit(child, node);
      }
    }
  };
  visit(root, null);
};
