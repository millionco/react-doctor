import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactEffectHookCall } from "./is-react-effect-hook-call.js";

export const isEffectCallbackReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let callbackValue = findTransparentExpressionRoot(identifier);
  while (callbackValue.parent) {
    const parent = callbackValue.parent;
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        parent.test !== callbackValue &&
        (parent.consequent === callbackValue || parent.alternate === callbackValue)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.right === callbackValue ||
          (parent.left === callbackValue && parent.operator !== "&&"))) ||
      (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) === callbackValue)
    ) {
      callbackValue = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  const callExpression = callbackValue.parent;
  return Boolean(
    isNodeOfType(callExpression, "CallExpression") &&
    callExpression.arguments[0] === callbackValue &&
    isReactEffectHookCall(callExpression, scopes),
  );
};
