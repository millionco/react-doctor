import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isR3fApiCall } from "./is-r3f-api-call.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";

export const resolveR3fCallback = (
  callExpression: EsTreeNode,
  hookName: string,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isR3fApiCall(callExpression, hookName, scopes)) return null;
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callback = callExpression.arguments[0];
  if (!callback || isNodeOfType(callback, "SpreadElement")) return null;
  return resolveLocalReactCallback(callback, scopes);
};
