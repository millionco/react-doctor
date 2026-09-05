import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const collectHelperParameterSafeBindings = (
  callExpression: EsTreeNode,
  helperFunction: EsTreeNode,
  locallyScopedSafeBindings: Set<string>,
): Set<string> => {
  const parameterSafeBindings = new Set<string>();

  if (!isNodeOfType(callExpression, "CallExpression") || !isFunctionLike(helperFunction)) {
    return parameterSafeBindings;
  }

  const helperParameters = helperFunction.params ?? [];
  if (helperParameters.length === 0) return parameterSafeBindings;

  for (let argumentIndex = 0; argumentIndex < callExpression.arguments.length; argumentIndex++) {
    const argument = callExpression.arguments[argumentIndex];
    if (!isNodeOfType(argument, "Identifier")) continue;
    if (!locallyScopedSafeBindings.has(argument.name)) continue;

    const correspondingParameter = helperParameters[argumentIndex];
    if (!isNodeOfType(correspondingParameter, "Identifier")) continue;

    parameterSafeBindings.add(correspondingParameter.name);
  }

  return parameterSafeBindings;
};
