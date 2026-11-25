import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getStableLexicalBindingValue = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!symbol.initializer || symbol.references.some((reference) => reference.flag !== "read"))
    return null;
  const declaration = symbol.declarationNode;
  if (
    symbol.kind === "const" &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.id === symbol.bindingIdentifier
  )
    return stripParenExpression(symbol.initializer);
  if (symbol.kind !== "function" || !isNodeOfType(declaration, "FunctionDeclaration")) return null;
  const inner = scopes.ownScopeFor(declaration)?.symbolsByName.get(symbol.name);
  return inner?.declarationNode === declaration &&
    inner.references.every((reference) => reference.flag === "read")
    ? declaration
    : null;
};
