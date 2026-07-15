import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const collectFunctionChildrenReferences = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<EsTreeNode> | null => {
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "FunctionDeclaration")
  ) {
    return null;
  }
  const rawPropsParameter = functionNode.params[0];
  const propsParameter = isNodeOfType(rawPropsParameter, "AssignmentPattern")
    ? rawPropsParameter.left
    : rawPropsParameter;
  if (isNodeOfType(propsParameter, "ObjectPattern")) {
    const childrenProperty = propsParameter.properties.find(
      (property) =>
        isNodeOfType(property, "Property") &&
        getStaticPropertyKeyName(property, { allowComputedString: true }) === "children",
    );
    if (!childrenProperty || !isNodeOfType(childrenProperty, "Property")) return null;
    const childrenBinding = isNodeOfType(childrenProperty.value, "AssignmentPattern")
      ? childrenProperty.value.left
      : childrenProperty.value;
    if (!isNodeOfType(childrenBinding, "Identifier")) return null;
    const childrenSymbol = scopes.symbolFor(childrenBinding);
    if (
      !childrenSymbol ||
      childrenSymbol.references.length === 0 ||
      childrenSymbol.references.some((reference) => reference.flag !== "read")
    ) {
      return null;
    }
    return childrenSymbol.references.map((reference) => reference.identifier);
  }
  if (!isNodeOfType(propsParameter, "Identifier")) return null;
  const propsSymbol = scopes.symbolFor(propsParameter);
  if (!propsSymbol || propsSymbol.references.length === 0) return null;
  const childrenReferences: EsTreeNode[] = [];
  for (const reference of propsSymbol.references) {
    if (reference.flag !== "read") return null;
    const propertyPath: string[] = [];
    let expression = findTransparentExpressionRoot(reference.identifier);
    while (
      expression.parent &&
      isNodeOfType(expression.parent, "MemberExpression") &&
      expression.parent.object === expression
    ) {
      const propertyName = getStaticPropertyName(expression.parent);
      if (!propertyName) return null;
      propertyPath.push(propertyName);
      expression = findTransparentExpressionRoot(expression.parent);
    }
    if (propertyPath[0] !== "children") {
      if (propertyPath.length === 0) return null;
      continue;
    }
    if (propertyPath.length !== 1) return null;
    childrenReferences.push(expression);
  }
  return childrenReferences.length > 0 ? childrenReferences : null;
};
