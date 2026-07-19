import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isContextNamedImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (symbol?.kind !== "import") return false;
  const importedName = getImportedName(symbol.declarationNode);
  return identifier.name.endsWith("Context") || Boolean(importedName?.endsWith("Context"));
};

const isContextModuleNamedImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isContextNamedImport(identifier, scopes)) return false;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol) return false;
  const moduleSource = getImportDeclarationForSymbol(symbol)?.source.value;
  return typeof moduleSource === "string" && moduleSource.split("/").at(-1) === "context";
};

const isContextFromDynamicImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol?.initializer ||
    (symbol.kind !== "const" && symbol.kind !== "let") ||
    !symbol.references.every((reference) => reference.flag === "read")
  ) {
    return false;
  }
  const propertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (!propertyName) return false;
  if (!propertyName.endsWith("Context") && !identifier.name.endsWith("Context")) return false;
  const initializer = stripParenExpression(symbol.initializer);
  if (!isNodeOfType(initializer, "AwaitExpression")) return false;
  return isNodeOfType(stripParenExpression(initializer.argument), "ImportExpression");
};

const isKnownContextIdentifier = (
  identifier: EsTreeNode,
  contextBindings: ReadonlySet<number>,
  scopes: ScopeAnalysis,
  allowContextNamedImport: boolean,
): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  if (
    allowContextNamedImport &&
    (isContextNamedImport(identifier, scopes) || isContextFromDynamicImport(identifier, scopes))
  ) {
    return true;
  }
  const symbol = scopes.symbolFor(identifier);
  if (!symbol) return false;
  return (
    contextBindings.has(symbol.id) ||
    symbol.scope.symbols.some(
      (candidate) => candidate.name === identifier.name && contextBindings.has(candidate.id),
    )
  );
};

export const isContextProviderJsxName = (
  node: EsTreeNode,
  contextBindings: ReadonlySet<number>,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(node, "JSXMemberExpression")) {
    return (
      node.property.name === "Provider" &&
      isKnownContextIdentifier(node.object, contextBindings, scopes, true)
    );
  }
  return (
    isContextModuleNamedImport(node, scopes) ||
    isKnownContextIdentifier(node, contextBindings, scopes, false)
  );
};
