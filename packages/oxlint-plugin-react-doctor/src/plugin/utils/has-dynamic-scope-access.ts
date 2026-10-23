import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { walkAst } from "./walk-ast.js";

const dynamicScopeByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasDynamicScopeAccess = (scopes: ScopeAnalysis): boolean => {
  const cached = dynamicScopeByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let hasDynamicScope = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasDynamicScope) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isProvenGlobalNamespaceReference(node, "eval", scopes)
    )
      hasDynamicScope = true;
    if (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.referenceFor(node)) {
      const binding = scopes.symbolFor(node);
      if (binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding))
        hasDynamicScope = true;
    }
  });
  dynamicScopeByAnalysis.set(scopes, hasDynamicScope);
  return hasDynamicScope;
};
