import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";

interface IsInsideStableReactInitializerOptions {
  isReactHookCall?: (node: EsTreeNode, apiName: string) => boolean;
}

export const isInsideStableReactInitializer = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  options: IsInsideStableReactInitializerOptions = {},
): boolean => {
  const isHookCall = (hookCall: EsTreeNode, apiName: string): boolean =>
    options.isReactHookCall?.(hookCall, apiName) ??
    isReactApiCall(hookCall, apiName, scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    });
  let enclosingFunction = findEnclosingFunction(node);
  while (enclosingFunction) {
    const callbackRoot = findTransparentExpressionRoot(enclosingFunction);
    const hookCall = callbackRoot.parent;
    if (
      isNodeOfType(hookCall, "CallExpression") &&
      hookCall.arguments[0] === callbackRoot &&
      (isHookCall(hookCall, "useState") ||
        (isHookCall(hookCall, "useMemo") &&
          hookCall.arguments[1] !== undefined &&
          !isNodeOfType(hookCall.arguments[1], "SpreadElement")))
    ) {
      return true;
    }
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return false;
};
