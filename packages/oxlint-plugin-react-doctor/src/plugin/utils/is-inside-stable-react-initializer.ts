import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";

const STABLE_INITIALIZER_HOOKS: ReadonlySet<string> = new Set(["useMemo", "useState"]);

export const isInsideStableReactInitializer = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let functionNode = findEnclosingFunction(node);
  while (functionNode) {
    const parent = functionNode.parent;
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments[0] === functionNode &&
      isReactApiCall(parent, STABLE_INITIALIZER_HOOKS, scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      return true;
    }
    functionNode = findEnclosingFunction(functionNode);
  }
  return false;
};
