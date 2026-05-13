import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const collectIdentifierNames = (expression: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  walkAst(expression, (child: EsTreeNode) => {
    if (isNodeOfType(child, "Identifier")) names.add(child.name);
  });
  return names;
};
