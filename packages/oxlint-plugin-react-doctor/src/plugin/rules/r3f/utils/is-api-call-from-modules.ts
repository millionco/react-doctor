import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const isNamespaceImportSymbolFromModules = (
  identifier: EsTreeNode,
  moduleSources: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = resolveConstIdentifierAlias(identifier, scopes);
  const importSource = symbol && getImportDeclarationForSymbol(symbol)?.source.value;
  return Boolean(
    symbol &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
    typeof importSource === "string" &&
    moduleSources.has(importSource),
  );
};

export const isApiCallFromModules = (
  node: EsTreeNode,
  apiName: string,
  moduleSources: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(callee, scopes);
    const importSource = symbol && getImportDeclarationForSymbol(symbol)?.source.value;
    return Boolean(
      symbol &&
      typeof importSource === "string" &&
      moduleSources.has(importSource) &&
      getImportedName(symbol.declarationNode) === apiName,
    );
  }
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== apiName) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    isNamespaceImportSymbolFromModules(receiver, moduleSources, scopes)
  );
};
