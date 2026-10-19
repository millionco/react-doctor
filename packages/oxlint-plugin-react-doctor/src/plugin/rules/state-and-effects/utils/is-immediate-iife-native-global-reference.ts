import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const isImmediateIifeNativeGlobalReference = (
  identifier: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier") || identifier.name !== name) return false;
  if (scopes.isGlobalReference(identifier)) return true;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
    !hasRuntimeValueBinding(symbol),
  );
};
