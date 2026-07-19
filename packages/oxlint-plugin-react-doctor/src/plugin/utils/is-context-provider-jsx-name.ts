import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

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

const isKnownContextIdentifier = (
  identifier: EsTreeNode,
  contextBindings: ReadonlySet<number>,
  scopes: ScopeAnalysis,
  allowContextNamedImport: boolean,
): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  if (allowContextNamedImport && isContextNamedImport(identifier, scopes)) return true;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(symbol && contextBindings.has(symbol.id));
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
