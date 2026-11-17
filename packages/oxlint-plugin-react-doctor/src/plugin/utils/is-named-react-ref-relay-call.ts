import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isNamedReactRefRelayCall = (
  node: EsTreeNode,
  importedName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(node.callee);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  return (
    declaration?.source.value === "react" &&
    declaration.importKind !== "type" &&
    symbol.declarationNode.importKind !== "type" &&
    getStaticKeyName(symbol.declarationNode.imported) === importedName
  );
};
