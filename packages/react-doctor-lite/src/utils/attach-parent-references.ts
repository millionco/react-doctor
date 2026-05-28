import { isAstNode } from "./is-ast-node.js";
import type { EsTreeNode } from "oxlint-plugin-react-doctor";

// oxlint sets `node.parent` on every node before invoking JS plugins; the
// rules walk those links. oxc-parser emits an unparented tree, so we wire the
// references up once before dispatching visitors.
export const attachParentReferences = (root: EsTreeNode): void => {
  const visit = (node: EsTreeNode, parent: EsTreeNode | null): void => {
    (node as { parent?: EsTreeNode | null }).parent = parent;
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
