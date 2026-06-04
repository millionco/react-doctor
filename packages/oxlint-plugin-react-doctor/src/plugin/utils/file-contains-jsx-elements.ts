import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const fileContainsJsxElements = (
  programNode: EsTreeNode,
  tagNames: ReadonlyArray<string>,
): Set<string> => {
  const targetTagNames = new Set(tagNames);
  const foundTagNames = new Set<string>();
  walkAst(programNode, (child: EsTreeNode) => {
    if (foundTagNames.size === targetTagNames.size) return false;
    if (
      isNodeOfType(child, "JSXOpeningElement") &&
      isNodeOfType(child.name, "JSXIdentifier") &&
      targetTagNames.has(child.name.name)
    ) {
      foundTagNames.add(child.name.name);
    }
  });
  return foundTagNames;
};
