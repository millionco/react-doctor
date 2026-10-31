import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isTanstackFileRouteComponent = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(functionNode) || functionNode.async || functionNode.generator) return false;
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const componentProperty = functionRoot.parent;
  if (
    !isNodeOfType(componentProperty, "Property") ||
    componentProperty.value !== functionRoot ||
    componentProperty.computed ||
    componentProperty.method ||
    componentProperty.kind !== "init" ||
    getStaticPropertyKeyName(componentProperty) !== "component"
  ) {
    return false;
  }
  const options = componentProperty.parent;
  if (!isNodeOfType(options, "ObjectExpression")) return false;
  const propertyNames = new Set<string>();
  for (const property of options.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    ) {
      return false;
    }
    const propertyName = getStaticPropertyKeyName(property);
    if (propertyName === null || propertyName === "__proto__" || propertyNames.has(propertyName)) {
      return false;
    }
    propertyNames.add(propertyName);
  }
  const optionsCall = options.parent;
  if (!isNodeOfType(optionsCall, "CallExpression") || optionsCall.optional) return false;
  const [optionsArgument, ...additionalOptionsArguments] = optionsCall.arguments;
  if (optionsArgument !== options || additionalOptionsArguments.length) return false;
  const factoryCall = optionsCall.callee;
  if (
    !isNodeOfType(factoryCall, "CallExpression") ||
    factoryCall.optional ||
    !isNodeOfType(factoryCall.callee, "Identifier")
  ) {
    return false;
  }
  const [pathArgument, ...additionalPathArguments] = factoryCall.arguments;
  if (
    !isNodeOfType(pathArgument, "Literal") ||
    typeof pathArgument.value !== "string" ||
    additionalPathArguments.length
  ) {
    return false;
  }
  const factorySymbol = scopes.symbolFor(factoryCall.callee);
  if (!factorySymbol || !isNodeOfType(factorySymbol.declarationNode, "ImportSpecifier")) {
    return false;
  }
  const importDeclaration = getImportDeclarationForSymbol(factorySymbol);
  if (
    !importDeclaration ||
    importDeclaration.importKind === "type" ||
    factorySymbol.declarationNode.importKind === "type" ||
    importDeclaration.source.value !== "@tanstack/react-router" ||
    getImportedName(factorySymbol.declarationNode) !== "createFileRoute"
  ) {
    return false;
  }
  return factorySymbol.references.every((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const call = referenceRoot.parent;
    return (
      reference.flag === "read" &&
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.callee === referenceRoot
    );
  });
};
