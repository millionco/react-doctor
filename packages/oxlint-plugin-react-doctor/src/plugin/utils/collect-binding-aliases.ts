import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const collectBindingAliases = (
  bindingIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode[] => {
  const initialSymbol = scopes.symbolFor(bindingIdentifier);
  if (!initialSymbol) return [];
  const aliases = [initialSymbol.bindingIdentifier];
  const pendingSymbols = [initialSymbol];
  const visitedSymbolIds = new Set<number>();
  const discoveredSymbolIds = new Set([initialSymbol.id]);
  while (pendingSymbols.length > 0) {
    const symbol = pendingSymbols.pop();
    if (!symbol || visitedSymbolIds.has(symbol.id)) continue;
    visitedSymbolIds.add(symbol.id);
    for (const reference of symbol.references) {
      if (reference.flag !== "read") continue;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      let aliasInitializerRoot = referenceRoot;
      let declarator: EsTreeNode | null | undefined = aliasInitializerRoot.parent;
      while (
        isNodeOfType(declarator, "MemberExpression") &&
        declarator.object === aliasInitializerRoot
      ) {
        aliasInitializerRoot = findTransparentExpressionRoot(declarator);
        declarator = aliasInitializerRoot.parent;
      }
      const callCallee = isNodeOfType(declarator, "CallExpression")
        ? stripParenExpression(declarator.callee)
        : null;
      if (
        isNodeOfType(declarator, "CallExpression") &&
        declarator.arguments.some((argument) => argument === referenceRoot) &&
        isNodeOfType(callCallee, "Identifier") &&
        callCallee.name === "useRef"
      ) {
        aliasInitializerRoot = findTransparentExpressionRoot(declarator);
        declarator = aliasInitializerRoot.parent;
      }
      if (
        !isNodeOfType(declarator, "VariableDeclarator") ||
        declarator.init !== aliasInitializerRoot ||
        !isNodeOfType(declarator.id, "Identifier")
      ) {
        continue;
      }
      const aliasSymbol = scopes.symbolFor(declarator.id);
      if (!aliasSymbol || discoveredSymbolIds.has(aliasSymbol.id)) continue;
      discoveredSymbolIds.add(aliasSymbol.id);
      aliases.push(aliasSymbol.bindingIdentifier);
      pendingSymbols.push(aliasSymbol);
    }
  }
  return aliases;
};
