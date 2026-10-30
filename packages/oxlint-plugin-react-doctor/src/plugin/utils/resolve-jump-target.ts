import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

const LOOP_NODE_TYPES: ReadonlySet<string> = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);

export const resolveJumpTarget = (
  jump: EsTreeNodeOfType<"BreakStatement" | "ContinueStatement">,
): EsTreeNode | null => {
  let ancestor = jump.parent;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (jump.label) {
      if (isNodeOfType(ancestor, "LabeledStatement") && ancestor.label.name === jump.label.name) {
        if (jump.type === "BreakStatement") return ancestor;
        let target: EsTreeNode = ancestor.body;
        while (isNodeOfType(target, "LabeledStatement")) target = target.body;
        return LOOP_NODE_TYPES.has(target.type) ? target : null;
      }
    } else if (
      LOOP_NODE_TYPES.has(ancestor.type) ||
      (jump.type === "BreakStatement" && isNodeOfType(ancestor, "SwitchStatement"))
    )
      return ancestor;
    ancestor = ancestor.parent;
  }
  return null;
};
