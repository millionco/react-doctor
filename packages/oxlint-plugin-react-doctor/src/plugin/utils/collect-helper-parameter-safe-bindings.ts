import { collectPatternNames } from "./collect-pattern-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

export const collectHelperParameterSafeBindings = (
  handlerBody: EsTreeNode,
  helperFunction: EsTreeNode,
  locallyScopedSafeBindings: Set<string>,
): Set<string> => {
  const parameterSafeBindings = new Set<string>();

  if (!isFunctionLike(helperFunction)) return parameterSafeBindings;

  const helperParameters = helperFunction.params ?? [];
  if (helperParameters.length === 0) return parameterSafeBindings;

  walkAst(handlerBody, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    if (!isNodeOfType(node.callee, "Identifier")) return;

    const callArguments = node.arguments ?? [];
    if (callArguments.length === 0) return;

    for (let argumentIndex = 0; argumentIndex < callArguments.length; argumentIndex++) {
      const argument = callArguments[argumentIndex];
      if (!isNodeOfType(argument, "Identifier")) continue;
      if (!locallyScopedSafeBindings.has(argument.name)) continue;

      const correspondingParameter = helperParameters[argumentIndex];
      if (!correspondingParameter) continue;

      collectPatternNames(correspondingParameter, parameterSafeBindings);
    }
  });

  return parameterSafeBindings;
};
