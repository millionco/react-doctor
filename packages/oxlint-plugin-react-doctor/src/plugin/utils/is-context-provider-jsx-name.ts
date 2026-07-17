import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

const isContextNamedImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (symbol?.kind !== "import") return false;
  const importedName = getImportedName(symbol.declarationNode);
  return identifier.name.endsWith("Context") || Boolean(importedName?.endsWith("Context"));
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
  return isKnownContextIdentifier(node, contextBindings, scopes, false);
};
