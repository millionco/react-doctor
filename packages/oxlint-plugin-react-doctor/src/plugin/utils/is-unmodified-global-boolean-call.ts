import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface UnmodifiedGlobalBooleanCallInput {
  node: EsTreeNode;
  scopes: ScopeAnalysis;
}

const booleanMutationByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasBooleanMutation = (scopes: ScopeAnalysis): boolean => {
  const cached = booleanMutationByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) continue;
    pendingScopes.push(...scope.children);
    for (const reference of scope.references) {
      const identifier = reference.identifier;
      if (
        isNodeOfType(identifier, "Identifier") &&
        identifier.name === "Boolean" &&
        scopes.isGlobalReference(identifier) &&
        (reference.flag !== "read" || isWithinAssignmentTarget(identifier))
      ) {
        booleanMutationByAnalysis.set(scopes, true);
        return true;
      }
      if (
        isProvenGlobalObjectReference(identifier, scopes) &&
        (reference.flag !== "read" || isWithinAssignmentTarget(identifier))
      ) {
        booleanMutationByAnalysis.set(scopes, true);
        return true;
      }
      const receiver = findTransparentExpressionRoot(identifier);
      const member = receiver.parent;
      if (
        member &&
        isNodeOfType(member, "MemberExpression") &&
        stripParenExpression(member.object) === stripParenExpression(receiver) &&
        isProvenGlobalObjectReference(receiver, scopes) &&
        (getStaticPropertyName(member) === "Boolean" || getStaticPropertyName(member) === null) &&
        isWithinAssignmentTarget(member)
      ) {
        booleanMutationByAnalysis.set(scopes, true);
        return true;
      }
    }
  }
  booleanMutationByAnalysis.set(scopes, false);
  return false;
};

export const isUnmodifiedGlobalBooleanCall = ({
  node,
  scopes,
}: UnmodifiedGlobalBooleanCallInput): boolean => {
  const expression = stripParenExpression(node);
  return (
    isNodeOfType(expression, "CallExpression") &&
    !expression.optional &&
    isProvenGlobalNamespaceReference(expression.callee, "Boolean", scopes) &&
    !hasBooleanMutation(scopes)
  );
};
