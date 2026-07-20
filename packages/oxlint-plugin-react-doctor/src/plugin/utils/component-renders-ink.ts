import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveInkJsxElementName } from "./resolve-ink-api-name.js";
import { walkAst } from "./walk-ast.js";

export const componentRendersInk = (componentNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let doesRenderInk = false;
  walkAst(componentNode, (descendantNode) => {
    if (
      descendantNode !== componentNode &&
      (/Function/.test(descendantNode.type) || isNodeOfType(descendantNode, "JSXAttribute"))
    ) {
      return false;
    }
    if (
      isNodeOfType(descendantNode, "JSXOpeningElement") &&
      resolveInkJsxElementName(descendantNode, scopes)
    ) {
      doesRenderInk = true;
      return false;
    }
  });
  return doesRenderInk;
};
