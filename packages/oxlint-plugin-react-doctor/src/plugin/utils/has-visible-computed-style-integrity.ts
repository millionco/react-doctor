import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { walkAst } from "./walk-ast.js";

const integrityByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const REFLECTIVE_GLOBAL_NAMES = new Set(["Object", "Reflect", "eval", "Function", "Window"]);
const PROVIDER_ESCAPE_MEMBER_NAMES = new Set(["constructor", "prototype", "__proto__"]);
const GLOBAL_SELF_MEMBER_NAMES = new Set(["window", "globalThis", "self", "global"]);

export const hasVisibleComputedStyleIntegrity = (scopes: ScopeAnalysis): boolean => {
  const cachedIntegrity = integrityByAnalysis.get(scopes);
  if (cachedIntegrity !== undefined) return cachedIntegrity;
  let hasExposure = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasExposure) return false;
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (propertyName === null || PROVIDER_ESCAPE_MEMBER_NAMES.has(propertyName))
        hasExposure = true;
      return;
    }
    if (!isNodeOfType(node, "MemberExpression")) return;
    const propertyName = getStaticPropertyName(node);
    if (propertyName !== null && PROVIDER_ESCAPE_MEMBER_NAMES.has(propertyName)) {
      hasExposure = true;
      return false;
    }
    if (propertyName !== null && propertyName !== "getComputedStyle") return;
    if (isWithinAssignmentTarget(node)) hasExposure = true;
  });
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0 && !hasExposure) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) break;
    pendingScopes.push(...currentScope.children);
    for (const reference of currentScope.references) {
      const identifier = reference.identifier;
      if (
        isNodeOfType(identifier, "Identifier") &&
        REFLECTIVE_GLOBAL_NAMES.has(identifier.name) &&
        scopes.isGlobalReference(identifier)
      ) {
        hasExposure = true;
        break;
      }
      const referenceRoot = findTransparentExpressionRoot(identifier);
      const consumer = referenceRoot.parent;
      if (
        isNodeOfType(identifier, "Identifier") &&
        identifier.name === "getComputedStyle" &&
        scopes.isGlobalReference(identifier)
      ) {
        if (
          reference.flag !== "read" ||
          !isNodeOfType(consumer, "CallExpression") ||
          consumer.callee !== referenceRoot ||
          consumer.optional
        ) {
          hasExposure = true;
          break;
        }
        continue;
      }
      if (!isProvenGlobalObjectReference(identifier, scopes)) continue;
      if (
        reference.flag !== "read" ||
        !isNodeOfType(consumer, "MemberExpression") ||
        consumer.object !== referenceRoot
      ) {
        hasExposure = true;
        break;
      }
      const propertyName = getStaticPropertyName(consumer);
      if (
        propertyName === null ||
        GLOBAL_SELF_MEMBER_NAMES.has(propertyName) ||
        REFLECTIVE_GLOBAL_NAMES.has(propertyName)
      ) {
        hasExposure = true;
        break;
      }
      if (propertyName !== "getComputedStyle") continue;
      const memberRoot = findTransparentExpressionRoot(consumer);
      const memberConsumer = memberRoot.parent;
      if (
        !isNodeOfType(memberConsumer, "CallExpression") ||
        memberConsumer.callee !== memberRoot ||
        memberConsumer.optional
      ) {
        hasExposure = true;
        break;
      }
    }
  }
  const hasIntegrity = !hasExposure;
  integrityByAnalysis.set(scopes, hasIntegrity);
  return hasIntegrity;
};
