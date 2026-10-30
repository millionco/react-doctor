import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isStoredFunctionLocalBinding = (
  identifier: EsTreeNode,
  symbol: SymbolDescriptor,
  initializationValue: EsTreeNode,
): boolean => {
  const functionOwner = findEnclosingFunction(identifier);
  if (
    (!isNodeOfType(functionOwner, "ArrowFunctionExpression") &&
      !isNodeOfType(functionOwner, "FunctionExpression")) ||
    functionOwner.async ||
    (functionOwner.type === "FunctionExpression" &&
      (functionOwner.generator || functionOwner.id)) ||
    findEnclosingFunction(symbol.bindingIdentifier) !== functionOwner
  ) {
    return false;
  }
  const functionValue = findTransparentExpressionRoot(functionOwner);
  const property = functionValue.parent;
  return Boolean(
    isNodeOfType(property, "Property") &&
    property.kind === "init" &&
    !property.computed &&
    !property.method &&
    property.value === functionValue &&
    property.parent === stripParenExpression(initializationValue),
  );
};
