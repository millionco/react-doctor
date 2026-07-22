import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const CPU_TYPED_ARRAY_CONSTRUCTORS: ReadonlySet<string> = new Set([
  "BigInt64Array",
  "BigUint64Array",
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

export const isCpuTypedArray = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isCpuTypedArray(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "NewExpression")) return false;
  const callee = stripParenExpression(candidate.callee);
  return (
    isNodeOfType(callee, "Identifier") &&
    CPU_TYPED_ARRAY_CONSTRUCTORS.has(callee.name) &&
    scopes.isGlobalReference(callee)
  );
};
