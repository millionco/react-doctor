import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isReadonlyNamedReactCall = (
  node: EsTreeNode,
  apiName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  if (
    !symbol ||
    !isSymbolReadOnly(symbol) ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier")
  ) {
    return false;
  }
  const declaration = getImportDeclarationForSymbol(symbol);
  return Boolean(
    declaration?.source.value === "react" &&
    declaration.importKind !== "type" &&
    symbol.declarationNode.importKind !== "type" &&
    getImportedName(symbol.declarationNode) === apiName,
  );
};
