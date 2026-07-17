import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";

export const isInsideStableReactHookInitializer = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let enclosingFunction = findEnclosingFunction(node);
  while (enclosingFunction) {
    const callbackRoot = findTransparentExpressionRoot(enclosingFunction);
    const hookCall = callbackRoot.parent;
    if (
      isNodeOfType(hookCall, "CallExpression") &&
      hookCall.arguments[0] === callbackRoot &&
      (isReactApiCall(hookCall, "useState", scopes, { allowGlobalReactNamespace: true }) ||
        (isReactApiCall(hookCall, "useMemo", scopes, { allowGlobalReactNamespace: true }) &&
          Boolean(hookCall.arguments[1]) &&
          !isNodeOfType(hookCall.arguments[1], "SpreadElement")))
    ) {
      return true;
    }
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return false;
};
