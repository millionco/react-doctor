import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NATIVE_TRANSITION_GLOBAL_CARRIER_PROPERTY_NAMES,
  NATIVE_TRANSITION_TUPLE_PROVIDER_NAMES,
} from "./constants.js";

const closedTupleProvidersByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedTransitionTupleProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = closedTupleProvidersByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      !isTypeScriptTypePosition(node) &&
      ["Array", "Symbol", "globalThis", "window", "self", "global"].includes(node.name)
    ) {
      const symbol = scopes.symbolFor(node);
      if (
        symbol &&
        symbol.bindingIdentifier !== node &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        closed = false;
        return false;
      }
    }
    if (!closed || isTypeScriptTypePosition(node)) return false;
    if (
      NATIVE_TRANSITION_TUPLE_PROVIDER_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      )
    ) {
      closed = false;
      return false;
    }
    if (!isProvenGlobalObjectReference(node, scopes)) return;
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== root ||
      parent.computed ||
      parent.optional ||
      NATIVE_TRANSITION_GLOBAL_CARRIER_PROPERTY_NAMES.has(getStaticPropertyName(parent) ?? "")
    ) {
      closed = false;
      return false;
    }
  });
  closedTupleProvidersByAnalysis.set(scopes, closed);
  return closed;
};
