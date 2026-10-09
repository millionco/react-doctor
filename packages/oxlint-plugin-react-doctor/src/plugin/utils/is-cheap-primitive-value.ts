import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getSymbolTypeAnnotation } from "./get-symbol-type-annotation.js";
import { hasStableCallTarget } from "./has-stable-call-target.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isCheapPrimitiveValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  remainingDepth: number,
): boolean => {
  if (remainingDepth <= 0) return false;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    return (
      typeof candidate.value === "number" ||
      typeof candidate.value === "string" ||
      typeof candidate.value === "boolean"
    );
  }
  if (isNodeOfType(candidate, "BinaryExpression")) {
    return (
      isCheapPrimitiveValue(candidate.left, scopes, remainingDepth - 1) &&
      isCheapPrimitiveValue(candidate.right, scopes, remainingDepth - 1)
    );
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator !== "delete") {
    return isCheapPrimitiveValue(candidate.argument, scopes, remainingDepth - 1);
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || hasSymbolWriteBefore(symbol, candidate, scopes)) return false;
  const annotation = getSymbolTypeAnnotation(symbol);
  if (
    annotation &&
    (isNodeOfType(annotation, "TSNumberKeyword") ||
      isNodeOfType(annotation, "TSStringKeyword") ||
      isNodeOfType(annotation, "TSBooleanKeyword"))
  )
    return true;
  if (symbol.kind !== "const" || !symbol.initializer) return false;
  const propertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  const initializer = stripParenExpression(symbol.initializer);
  if (propertyName !== null) {
    if (
      propertyName !== "width" &&
      propertyName !== "height" &&
      propertyName !== "scale" &&
      propertyName !== "fontScale"
    )
      return false;
    if (
      !isNodeOfType(initializer, "CallExpression") ||
      !isNodeOfType(initializer.callee, "MemberExpression") ||
      getStaticPropertyName(initializer.callee) !== "get" ||
      !hasStableCallTarget(initializer, scopes)
    )
      return false;
    const importedApi = resolveImportedApiReference(initializer.callee.object, scopes);
    const dimensionTarget = initializer.arguments[0];
    return Boolean(
      importedApi?.source === "react-native" &&
      importedApi.importedName === "Dimensions" &&
      dimensionTarget &&
      isNodeOfType(dimensionTarget, "Literal") &&
      (dimensionTarget.value === "window" || dimensionTarget.value === "screen"),
    );
  }
  return isCheapPrimitiveValue(initializer, scopes, remainingDepth - 1);
};
