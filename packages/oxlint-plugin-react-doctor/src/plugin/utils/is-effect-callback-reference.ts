import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findCallbackSelectionRoot } from "./find-callback-selection-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactEffectHookCall } from "./is-react-effect-hook-call.js";

export const isEffectCallbackReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callbackValue = findCallbackSelectionRoot(identifier);
  const callExpression = callbackValue.parent;
  return Boolean(
    isNodeOfType(callExpression, "CallExpression") &&
    callExpression.arguments[0] === callbackValue &&
    isReactEffectHookCall(callExpression, scopes),
  );
};
