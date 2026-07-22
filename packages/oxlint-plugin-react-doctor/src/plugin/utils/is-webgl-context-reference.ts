import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const WEBGL_CONTEXT_NAMES: ReadonlySet<string> = new Set(["experimental-webgl", "webgl", "webgl2"]);

export const isWebglContextReference = (
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
    return isWebglContextReference(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    !isNodeOfType(candidate.callee, "MemberExpression") ||
    getStaticPropertyName(candidate.callee) !== "getContext"
  ) {
    return false;
  }
  const contextName = candidate.arguments[0];
  const staticContextName =
    contextName && !isNodeOfType(contextName, "SpreadElement")
      ? stripParenExpression(contextName)
      : null;
  return Boolean(
    staticContextName &&
    isNodeOfType(staticContextName, "Literal") &&
    typeof staticContextName.value === "string" &&
    WEBGL_CONTEXT_NAMES.has(staticContextName.value),
  );
};
