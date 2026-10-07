import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const TYPED_ARRAY_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "BigInt64Array",
  "BigUint64Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
]);

const getStaticNonnegativeInteger = (expression: EsTreeNode): number | null => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "Literal") &&
    typeof candidate.value === "number" &&
    Number.isInteger(candidate.value) &&
    candidate.value >= 0
  ) {
    return candidate.value;
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "+") {
    const argument = stripParenExpression(candidate.argument);
    if (!isNodeOfType(argument, "Literal")) return null;
    const value = argument.value;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
  }
  return null;
};

export const getStaticArrayLikeLength = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
    if (!symbol || !initializer || visitedSymbolIds.has(symbol.id)) return null;
    visitedSymbolIds.add(symbol.id);
    return getStaticArrayLikeLength(initializer, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.every((element) => element && !isNodeOfType(element, "SpreadElement"))
      ? candidate.elements.length
      : null;
  }
  if (!isNodeOfType(candidate, "NewExpression")) return null;
  const callee = stripParenExpression(candidate.callee);
  if (
    !isNodeOfType(callee, "Identifier") ||
    !TYPED_ARRAY_CONSTRUCTOR_NAMES.has(callee.name) ||
    !scopes.isGlobalReference(callee)
  ) {
    return null;
  }
  const source = candidate.arguments[0];
  if (!source || isNodeOfType(source, "SpreadElement")) return 0;
  return (
    getStaticNonnegativeInteger(source) ??
    getStaticArrayLikeLength(source, scopes, visitedSymbolIds)
  );
};
