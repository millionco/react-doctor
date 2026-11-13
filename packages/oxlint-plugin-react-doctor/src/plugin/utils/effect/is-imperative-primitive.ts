import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { IMPERATIVE_CERTIFICATE_MAX_DEPTH } from "./imperative-state/constants.js";

export interface ImperativePrimitiveEnvironment {
  readonly scopes: ScopeAnalysis;
  readonly primitiveSymbols: ReadonlySet<SymbolDescriptor>;
}

export const isImperativePrimitive = (
  rawNode: EsTreeNode,
  environment: ImperativePrimitiveEnvironment,
  visitedSymbols: ReadonlySet<SymbolDescriptor> = new Set(),
  depth = 0,
): boolean => {
  if (depth >= IMPERATIVE_CERTIFICATE_MAX_DEPTH) return false;
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "Literal"))
    return (
      !("regex" in node) &&
      (node.value === null || ["string", "number", "boolean", "bigint"].includes(typeof node.value))
    );
  if (isNodeOfType(node, "Identifier")) {
    const symbol = environment.scopes.symbolFor(node);
    if (!symbol) return node.name === "undefined" && environment.scopes.isGlobalReference(node);
    if (symbol.references.some((reference) => reference.flag !== "read")) return false;
    if (environment.primitiveSymbols.has(symbol)) return true;
    if (symbol.kind !== "const" || !symbol.initializer || visitedSymbols.has(symbol)) return false;
    return isImperativePrimitive(
      symbol.initializer,
      environment,
      new Set([...visitedSymbols, symbol]),
      depth + 1,
    );
  }
  if (isNodeOfType(node, "ConditionalExpression"))
    return (
      isImperativePrimitive(node.test, environment, visitedSymbols, depth + 1) &&
      isImperativePrimitive(node.consequent, environment, visitedSymbols, depth + 1) &&
      isImperativePrimitive(node.alternate, environment, visitedSymbols, depth + 1)
    );
  if (isNodeOfType(node, "LogicalExpression") || isNodeOfType(node, "BinaryExpression"))
    return (
      node.operator !== "in" &&
      node.operator !== "instanceof" &&
      isImperativePrimitive(node.left, environment, visitedSymbols, depth + 1) &&
      isImperativePrimitive(node.right, environment, visitedSymbols, depth + 1)
    );
  if (isNodeOfType(node, "UnaryExpression"))
    return (
      node.operator !== "delete" &&
      isImperativePrimitive(node.argument, environment, visitedSymbols, depth + 1)
    );
  if (isNodeOfType(node, "TemplateLiteral"))
    return node.expressions.every((expression) =>
      isImperativePrimitive(expression, environment, visitedSymbols, depth + 1),
    );
  return false;
};
