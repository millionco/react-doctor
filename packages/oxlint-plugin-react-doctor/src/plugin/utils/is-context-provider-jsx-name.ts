import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
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
  contextBindings: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  if (isContextNamedImport(identifier, scopes)) return true;
  if (!contextBindings.has(identifier.name)) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  return binding?.scopeOwner.type === "Program";
};

export const isContextProviderJsxName = (
  node: EsTreeNode,
  contextBindings: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(node, "JSXMemberExpression")) {
    return (
      node.property.name === "Provider" &&
      isKnownContextIdentifier(node.object, contextBindings, scopes)
    );
  }
  return isKnownContextIdentifier(node, contextBindings, scopes);
};
