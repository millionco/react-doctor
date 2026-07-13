import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export type FreshRenderValueKind = "object" | "array" | "function" | "JSX" | "instance";

export interface ResolvedFreshRenderValue {
  readonly bindingName: string | null;
  readonly kind: FreshRenderValueKind;
}

const classifyFreshRenderValue = (expression: EsTreeNode): FreshRenderValueKind | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ObjectExpression")) return "object";
  if (isNodeOfType(candidate, "ArrayExpression")) return "array";
  if (
    isNodeOfType(candidate, "ArrowFunctionExpression") ||
    isNodeOfType(candidate, "FunctionExpression")
  ) {
    return "function";
  }
  if (isNodeOfType(candidate, "JSXElement") || isNodeOfType(candidate, "JSXFragment")) {
    return "JSX";
  }
  if (isNodeOfType(candidate, "NewExpression")) return "instance";
  return null;
};

export const resolveFreshRenderValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): ResolvedFreshRenderValue | null => {
  const directKind = classifyFreshRenderValue(expression);
  if (directKind) return { bindingName: null, kind: directKind };

  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.scope.kind === "module" ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  const resolved = resolveFreshRenderValue(symbol.initializer, scopes, visitedSymbolIds);
  return resolved ? { bindingName: candidate.name, kind: resolved.kind } : null;
};
