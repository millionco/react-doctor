import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isReadonlyRenderInput = (
  symbol: SymbolDescriptor,
  renderFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = getDirectConstInitializer(symbol);
  if (
    !initializer ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  let source = stripParenExpression(initializer);
  if (isNodeOfType(source, "LogicalExpression") && source.operator === "??") {
    const fallback = stripParenExpression(source.right);
    if (!isNodeOfType(fallback, "Literal") || typeof fallback.value === "object") return false;
    source = stripParenExpression(source.left);
  }
  if (isNodeOfType(source, "Literal")) {
    return source.value === null || typeof source.value !== "object";
  }
  const member = isNodeOfType(source, "MemberExpression") ? source : null;
  const parameter = member ? stripParenExpression(member.object) : source;
  if (
    !isNodeOfType(parameter, "Identifier") ||
    (member && (member.optional || getStaticPropertyName(member) === null))
  ) {
    return false;
  }
  const parameterSymbol = scopes.symbolFor(parameter);
  if (parameterSymbol?.kind !== "parameter" || parameterSymbol.scope.node !== renderFunction) {
    return false;
  }
  return parameterSymbol.references.every((reference) => {
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return false;
    if (!member) return true;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const property = referenceRoot.parent;
    if (
      !isNodeOfType(property, "MemberExpression") ||
      property.object !== referenceRoot ||
      property.optional ||
      getStaticPropertyName(property) === null ||
      isWithinAssignmentTarget(property)
    ) {
      return false;
    }
    const propertyRoot = findTransparentExpressionRoot(property);
    const use = propertyRoot.parent;
    return !isNodeOfType(use, "CallExpression") || use.callee !== propertyRoot;
  });
};
