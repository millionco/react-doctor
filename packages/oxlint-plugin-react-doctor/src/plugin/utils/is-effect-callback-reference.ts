import { EFFECT_HOOK_NAMES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isHookCall } from "./is-hook-call.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isEffectCallbackReference = (identifier: EsTreeNode): boolean => {
  let callbackValue = findTransparentExpressionRoot(identifier);
  while (callbackValue.parent) {
    const parent = callbackValue.parent;
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        parent.test !== callbackValue &&
        (parent.consequent === callbackValue || parent.alternate === callbackValue)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.left === callbackValue || parent.right === callbackValue)) ||
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
    isHookCall(callExpression, EFFECT_HOOK_NAMES),
  );
};
