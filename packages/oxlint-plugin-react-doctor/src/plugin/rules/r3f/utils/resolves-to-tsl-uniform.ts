import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isApiCallFromModules } from "./is-api-call-from-modules.js";

const TSL_UNIFORM_MODULES: ReadonlySet<string> = new Set(["three/tsl", "three/webgpu"]);

export const resolvesToTslUniform = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isApiCallFromModules(candidate, "uniform", TSL_UNIFORM_MODULES, scopes)) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
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
  return resolvesToTslUniform(symbol.initializer, scopes, visitedSymbolIds);
};
