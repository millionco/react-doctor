import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isR3fReactApiCall } from "./is-r3f-react-api-call.js";

export const isInsideStableR3fReactHookInitializer = (
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
      (isR3fReactApiCall(hookCall, "useState", scopes, {
        allowGlobalReactNamespace: true,
      }) ||
        (isR3fReactApiCall(hookCall, "useMemo", scopes, {
          allowGlobalReactNamespace: true,
        }) &&
          Boolean(hookCall.arguments[1]) &&
          !isNodeOfType(hookCall.arguments[1], "SpreadElement")))
    ) {
      return true;
    }
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return false;
};
