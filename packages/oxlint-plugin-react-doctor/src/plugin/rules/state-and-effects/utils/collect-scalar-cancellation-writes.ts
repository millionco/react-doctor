import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { serializeReferenceKey } from "../../../utils/serialize-reference-key.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export interface ScalarCancellationWrites {
  readonly hasDirectEval: boolean;
  readonly unsupportedTargets: ReadonlySet<string>;
  readonly assignedValues: ReadonlyMap<string, ReadonlySet<boolean>>;
}

export const collectScalarCancellationWrites = (
  scopes: ScopeAnalysis,
): ScalarCancellationWrites => {
  let hasDirectEval = false;
  const unsupportedTargets = new Set<string>();
  const assignedValues = new Map<string, Set<boolean>>();
  walkAst(scopes.rootScope.node, (candidate) => {
    const callee = isNodeOfType(candidate, "CallExpression")
      ? stripParenExpression(candidate.callee)
      : null;
    if (isNodeOfType(callee, "Identifier") && callee.name === "eval") hasDirectEval = true;
    if (!isNodeOfType(candidate, "Identifier")) return;
    const reference = scopes.referenceFor(candidate);
    if (!reference || reference.flag === "read") return;
    const targetKey = serializeReferenceKey({ node: candidate, scopes });
    if (!targetKey) return;
    const symbol = scopes.symbolFor(candidate);
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.id !== symbol.bindingIdentifier ||
      !isNodeOfType(declaration.init, "Literal") ||
      typeof declaration.init.value !== "boolean"
    ) {
      unsupportedTargets.add(targetKey);
      return;
    }
    if (symbol.bindingIdentifier === candidate) return;
    const assignment = candidate.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== candidate ||
      !isNodeOfType(assignment.right, "Literal") ||
      typeof assignment.right.value !== "boolean"
    ) {
      unsupportedTargets.add(targetKey);
      return;
    }
    const assignedBooleanValues = assignedValues.get(targetKey) ?? new Set<boolean>();
    assignedBooleanValues.add(assignment.right.value);
    assignedValues.set(targetKey, assignedBooleanValues);
  });
  return { hasDirectEval, unsupportedTargets, assignedValues };
};
