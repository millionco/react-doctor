import { DIRECT_EVAL_BOOLEAN_ASSIGNMENT_MAX_CHARACTERS } from "../constants/thresholds.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPotentialDirectEvalCall } from "./is-potential-direct-eval-call.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { parseSourceText } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface DirectEvalBooleanAssignment {
  readonly name: string;
  readonly value: boolean;
}

export const readDirectEvalBooleanAssignment = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): DirectEvalBooleanAssignment | null => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional || !isPotentialDirectEvalCall(call)) {
    return null;
  }
  const [rawArgument, otherArgument] = call.arguments;
  const argument = rawArgument && stripParenExpression(rawArgument);
  if (
    otherArgument ||
    !isNodeOfType(argument, "Literal") ||
    typeof argument.value !== "string" ||
    argument.value.length > DIRECT_EVAL_BOOLEAN_ASSIGNMENT_MAX_CHARACTERS ||
    !isProvenUnmodifiedGlobalNamespaceReference(call.callee, "eval", scopes, undefined, true)
  ) {
    return null;
  }
  const program = parseSourceText({
    filename: "direct-eval.js",
    sourceText: argument.value,
    shouldAttachParentReferences: false,
  });
  if (!isNodeOfType(program, "Program")) return null;
  const [statement, otherStatement] = program.body;
  if (otherStatement || !isNodeOfType(statement, "ExpressionStatement")) return null;
  const assignment = stripParenExpression(statement.expression);
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "Identifier")
  ) {
    return null;
  }
  const replacement = stripParenExpression(assignment.right);
  if (
    !isFunctionLike(replacement) ||
    replacement.async ||
    replacement.params.length !== 0 ||
    (isNodeOfType(replacement, "FunctionExpression") && replacement.generator)
  ) {
    return null;
  }
  let result: EsTreeNode | null | undefined = replacement.body;
  if (isNodeOfType(result, "BlockStatement")) {
    const [returned, otherBodyStatement] = result.body;
    if (otherBodyStatement || !isNodeOfType(returned, "ReturnStatement")) return null;
    result = returned.argument;
  }
  const value = result && stripParenExpression(result);
  return isNodeOfType(value, "Literal") && typeof value.value === "boolean"
    ? { name: assignment.left.name, value: value.value }
    : null;
};
