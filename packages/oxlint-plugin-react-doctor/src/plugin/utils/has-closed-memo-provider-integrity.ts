import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isReactNamespaceImport } from "./is-react-api-call.js";
import { walkAst } from "./walk-ast.js";

const providerIntegrityByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedMemoProviderIntegrity = (scopes: ScopeAnalysis): boolean => {
  const cachedIntegrity = providerIntegrityByAnalysis.get(scopes);
  if (cachedIntegrity !== undefined) return cachedIntegrity;
  let hasProviderExposure = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasProviderExposure) return false;
    if (!isNodeOfType(node, "MemberExpression")) return;
    const propertyName = getStaticPropertyName(node);
    const consumer = node.parent;
    if (
      propertyName === "prototype" ||
      propertyName === "__proto__" ||
      propertyName === "constructor" ||
      ((propertyName === null ||
        propertyName === "map" ||
        propertyName === "from" ||
        propertyName === "useMemo") &&
        ((isNodeOfType(consumer, "AssignmentExpression") && consumer.left === node) ||
          (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === node) ||
          (isNodeOfType(consumer, "UnaryExpression") &&
            consumer.operator === "delete" &&
            consumer.argument === node)))
    )
      hasProviderExposure = true;
  });
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0 && !hasProviderExposure) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) break;
    pendingScopes.push(...currentScope.children);
    for (const reference of currentScope.references) {
      const identifier = reference.identifier;
      if (
        isProvenGlobalObjectReference(identifier, scopes) ||
        (isNodeOfType(identifier, "Identifier") &&
          (identifier.name === "eval" ||
            identifier.name === "Function" ||
            identifier.name === "Object" ||
            identifier.name === "Reflect") &&
          scopes.isGlobalReference(identifier))
      ) {
        hasProviderExposure = true;
        break;
      }
      const isArrayNamespace = isProvenGlobalNamespaceReference(identifier, "Array", scopes);
      if (!isArrayNamespace && !isReactNamespaceImport(identifier, scopes)) continue;
      const member = identifier.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== identifier ||
        (isArrayNamespace && getStaticPropertyName(member) !== "from") ||
        !isNodeOfType(member.parent, "CallExpression") ||
        member.parent.callee !== member
      ) {
        hasProviderExposure = true;
        break;
      }
    }
  }
  const hasIntegrity = !hasProviderExposure;
  providerIntegrityByAnalysis.set(scopes, hasIntegrity);
  return hasIntegrity;
};
