import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const fileContainsJsxElements = (
  programNode: EsTreeNode,
  tagNames: ReadonlyArray<string>,
): Set<string> => {
  const target = new Set(tagNames);
  const found = new Set<string>();
  walkAst(programNode, (child: EsTreeNode) => {
    if (found.size === target.size) return false;
    if (
      isNodeOfType(child, "JSXOpeningElement") &&
      isNodeOfType(child.name, "JSXIdentifier") &&
      target.has(child.name.name)
    ) {
      found.add(child.name.name);
    }
  });
  return found;
};
