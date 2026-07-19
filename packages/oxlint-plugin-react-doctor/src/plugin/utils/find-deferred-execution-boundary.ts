import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

const SYNCHRONOUS_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
]);

const isInvokedAtDefinitionSite = (functionNode: EsTreeNode): boolean => {
  const functionExpression = findTransparentExpressionRoot(functionNode);
  const parent = functionExpression.parent;
  if (
    !parent ||
    (!isNodeOfType(parent, "CallExpression") && !isNodeOfType(parent, "NewExpression"))
  ) {
    return false;
  }
  if (parent.callee === functionExpression) return true;
  if (!isNodeOfType(parent, "CallExpression") || !isNodeOfType(parent.callee, "MemberExpression")) {
    return false;
  }
  const methodName = getStaticPropertyName(parent.callee);
  if (
    methodName === "from" &&
    isNodeOfType(parent.callee.object, "Identifier") &&
    parent.callee.object.name === "Array" &&
    !findVariableInitializer(parent.callee.object, "Array")
  ) {
    return true;
  }
  return Boolean(methodName && SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(methodName));
};

export const findDeferredExecutionBoundary = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor) && !isInvokedAtDefinitionSite(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};
