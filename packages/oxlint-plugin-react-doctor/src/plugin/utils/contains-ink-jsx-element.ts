import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveInkJsxElementName } from "./resolve-ink-api-name.js";
import { walkAst } from "./walk-ast.js";

export const containsInkJsxElement = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let didFindInkElement = false;
  walkAst(node, (descendantNode) => {
    if (
      isNodeOfType(descendantNode, "JSXOpeningElement") &&
      resolveInkJsxElementName(descendantNode, scopes)
    ) {
      didFindInkElement = true;
      return false;
    }
  });
  return didFindInkElement;
};
