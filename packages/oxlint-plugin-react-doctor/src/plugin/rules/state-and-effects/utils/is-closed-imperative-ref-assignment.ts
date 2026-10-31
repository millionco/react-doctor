import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isImperativeRefCommandInput } from "./is-imperative-ref-command-input.js";
import { isClosedReactCommandHookCall } from "./is-closed-react-command-hook-call.js";

export const isClosedImperativeRefAssignment = (
  statement: EsTreeNode,
  ownerFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  invocation: EsTreeNode | null,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const assignment = statement.expression;
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
    return false;
  const member = assignment.left;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "current" ||
    !isNodeOfType(member.object, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(member.object);
  if (
    !symbol ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    findEnclosingFunction(symbol.declarationNode) !== ownerFunction
  )
    return false;
  const declaredInitializer = getDirectConstInitializer(symbol);
  if (!declaredInitializer) return false;
  const initializer = stripParenExpression(declaredInitializer);
  if (
    !initializer ||
    !isClosedReactCommandHookCall(initializer, "useRef", scopes) ||
    !isNodeOfType(initializer, "CallExpression") ||
    !isImperativeRefCommandInput(
      assignment.right,
      ownerFunction,
      scopes,
      initializer.arguments[0],
      invocation,
    )
  )
    return false;
  return symbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    if (reference.flag !== "read") return false;
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const access = receiver.parent;
    return (
      isNodeOfType(access, "MemberExpression") &&
      stripParenExpression(access.object) === receiver &&
      !access.computed &&
      !access.optional &&
      isNodeOfType(access.property, "Identifier") &&
      access.property.name === "current"
    );
  });
};
