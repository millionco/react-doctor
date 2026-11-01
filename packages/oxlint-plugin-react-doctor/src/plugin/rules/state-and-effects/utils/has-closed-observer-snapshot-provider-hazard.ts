import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { OBSERVER_SNAPSHOT_UNSUPPORTED_PROPERTIES } from "../../../constants/dom.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getGlobalRequireModuleSource } from "../../../utils/get-global-require-module-source.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";

interface ObserverSnapshotProviderOptions {
  context: RuleContext;
  observerIndex: EsTreeNode;
}

export const hasClosedObserverSnapshotProviderHazard = ({
  context,
  observerIndex,
}: ObserverSnapshotProviderOptions): boolean => {
  const { scopes } = context;
  let hasHazard = false;
  walkAst(scopes.rootScope.node, (candidate) => {
    if (
      isNodeOfType(candidate, "Identifier") &&
      !isTypeScriptTypePosition(candidate) &&
      [
        "Object",
        "Reflect",
        "Function",
        "require",
        "module",
        "process",
        "globalThis",
        "window",
        "self",
        "global",
      ].includes(candidate.name)
    ) {
      const symbol = scopes.symbolFor(candidate);
      if (
        symbol &&
        symbol.bindingIdentifier !== candidate &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        hasHazard = true;
        return false;
      }
    }
    if (hasHazard || isTypeScriptTypePosition(candidate)) return false;
    if (
      isNodeOfType(candidate, "WithStatement") ||
      isNodeOfType(candidate, "ImportExpression") ||
      isProvenGlobalObjectReference(candidate, scopes) ||
      ["Object", "Reflect", "eval", "Function", "module", "process"].some((name) =>
        isProvenGlobalNamespaceReference(candidate, name, scopes),
      ) ||
      getGlobalRequireModuleSource(candidate, scopes) === "react"
    ) {
      hasHazard = true;
      return false;
    }
    if (
      isNodeOfType(candidate, "ImportDeclaration") &&
      candidate.source.value === "react" &&
      candidate.importKind !== "type" &&
      candidate.specifiers.some((specifier) => !isNodeOfType(specifier, "ImportSpecifier"))
    ) {
      hasHazard = true;
      return false;
    }
    const isPropertyAccess =
      isNodeOfType(candidate, "MemberExpression") ||
      (isNodeOfType(candidate, "Property") && isNodeOfType(candidate.parent, "ObjectPattern"));
    if (isPropertyAccess) {
      const propertyName = getResolvedStaticPropertyName(candidate, scopes);
      if (
        (isNodeOfType(candidate, "MemberExpression") && isMemberMutationTarget(candidate)) ||
        (propertyName === null && candidate.computed && candidate !== observerIndex) ||
        (propertyName !== null && OBSERVER_SNAPSHOT_UNSUPPORTED_PROPERTIES.has(propertyName))
      ) {
        hasHazard = true;
        return false;
      }
    }
    if (!isNodeOfType(candidate, "Identifier") || !scopes.isGlobalReference(candidate)) return;
    if (candidate.name === "require") {
      hasHazard = true;
      return false;
    }
    const namespace = candidate.name;
    if (!["Array", "document", "IntersectionObserver"].includes(namespace)) return;
    const referenceRoot = findTransparentExpressionRoot(candidate);
    const parent = referenceRoot.parent;
    if (namespace === "IntersectionObserver") {
      if (!isNodeOfType(parent, "NewExpression") || parent.callee !== referenceRoot) {
        hasHazard = true;
      }
      return;
    }
    const call = parent?.parent;
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== referenceRoot ||
      parent.computed ||
      parent.optional ||
      getResolvedStaticPropertyName(parent, scopes) !==
        (namespace === "Array" ? "from" : "querySelectorAll") ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== parent ||
      call.optional
    ) {
      hasHazard = true;
    }
  });
  return hasHazard;
};
