import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";

// Walks the AST setting each child's `.parent` to its owning parent
// node. oxlint already attaches parents before invoking JS plugins
// for the file being linted, but cross-file parsing (used by rules
// that follow imports — see `parse-source-file.ts`) goes through
// `oxc-parser` directly, which emits an unparented AST. Our rules
// rely on `node.parent` for ancestor-walking, so we re-attach here.
//
// Also used by the test harness for the same reason — fixture
// parsing bypasses oxlint.
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
