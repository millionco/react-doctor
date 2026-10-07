import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUppercaseName } from "./is-uppercase-name.js";

export const isArrayReturnedByUnreferencedObjectFactory = (
  arrayExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let returnedExpression = findTransparentExpressionRoot(arrayExpression);
  while (returnedExpression.parent) {
    const parent = returnedExpression.parent;
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === returnedExpression || parent.alternate === returnedExpression)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.left === returnedExpression || parent.right === returnedExpression))
    ) {
      returnedExpression = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  const returnParent = returnedExpression.parent;
  const factory =
    returnParent && isNodeOfType(returnParent, "ReturnStatement")
      ? findEnclosingFunction(returnParent)
      : returnParent;
  if (
    !isFunctionLike(factory) ||
    factory.async ||
    factory.generator ||
    (isNodeOfType(factory, "FunctionExpression") &&
      factory.id &&
      isUppercaseName(factory.id.name)) ||
    (returnParent === factory && factory.body !== returnedExpression)
  ) {
    return false;
  }
  const factoryRoot = findTransparentExpressionRoot(factory);
  const property = factoryRoot.parent;
  if (
    !property ||
    !isNodeOfType(property, "Property") ||
    property.kind !== "init" ||
    property.value !== factoryRoot
  ) {
    return false;
  }
  const propertyName = getResolvedStaticPropertyName(property, scopes);
  if (!propertyName || isUppercaseName(propertyName) || /^render(?:$|[A-Z])/.test(propertyName)) {
    return false;
  }
  const objectExpression = property.parent;
  if (!objectExpression || !isNodeOfType(objectExpression, "ObjectExpression")) return false;
  const objectRoot = findTransparentExpressionRoot(objectExpression);
  const declarator = objectRoot.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== objectRoot ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return false;
  }
  const declaration = declarator.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const"
  ) {
    return false;
  }
  const declarationParent = declaration.parent;
  const moduleParent =
    declarationParent && isNodeOfType(declarationParent, "ExportNamedDeclaration")
      ? declarationParent.parent
      : declarationParent;
  if (!moduleParent || !isNodeOfType(moduleParent, "Program")) return false;
  const objectSymbol = scopes.symbolFor(declarator.id);
  return Boolean(
    objectSymbol &&
    objectSymbol.references.every((reference) =>
      isNodeOfType(reference.identifier.parent, "ExportSpecifier"),
    ),
  );
};
