import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { STRING_STATE_TUPLE_PROVIDER_NAMES } from "./constants.js";

const closedTupleProvidersByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedStateTupleProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = closedTupleProvidersByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const reference = findTransparentExpressionRoot(node);
      const member = reference.parent;
      const isGlobalCarrier = ["globalThis", "window", "self", "global"].includes(node.name);
      const providerName = isGlobalCarrier
        ? isNodeOfType(member, "MemberExpression") && member.object === reference
          ? getStaticPropertyName(member)
          : null
        : node.name;
      const hasOpaqueCarrierUse =
        isGlobalCarrier &&
        !(
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference &&
          getStaticPropertyName(member) !== null
        ) &&
        !(
          isNodeOfType(member, "UnaryExpression") &&
          (member.operator === "typeof" || member.operator === "void")
        );
      const symbol =
        hasOpaqueCarrierUse ||
        (providerName && ["Array", "Symbol", "Object", "Reflect"].includes(providerName))
          ? scopes.symbolFor(node)
          : null;
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
    if (isTypeScriptTypePosition(node)) return false;
    if (
      STRING_STATE_TUPLE_PROVIDER_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      ) ||
      (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "__proto__") ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        getStaticPropertyKeyName(node, { allowComputedString: true }) === "__proto__")
    )
      closed = false;
  });
  closedTupleProvidersByAnalysis.set(scopes, closed);
  return closed;
};
