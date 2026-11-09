import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isRuntimeGlobalReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "Identifier") || !scopes.referenceFor(node)) return false;
  if (scopes.isGlobalReference(node)) return true;
  const symbol = scopes.symbolFor(node);
  return Boolean(symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol));
};
