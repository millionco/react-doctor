import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { resolveCleanupFunctions } from "../../../utils/collect-returned-cleanup-functions.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isGlobalBrowserFunctionCall } from "../../../utils/is-global-browser-function-call.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasClosedFrameCancellationProvider } from "./has-closed-frame-cancellation-provider.js";

interface EnclosingRafCleanupHelperInput {
  cleanupFunction: EsTreeNode;
  effectCallback: EsTreeNode;
  schedulingCalls: ReadonlyArray<EsTreeNodeOfType<"CallExpression">>;
  scopes: ScopeAnalysis;
}

export const isClosedEnclosingRafCleanupHelper = ({
  cleanupFunction,
  effectCallback,
  schedulingCalls,
  scopes,
}: EnclosingRafCleanupHelperInput): boolean => {
  if (
    !isFunctionLike(effectCallback) ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    !isNodeOfType(cleanupFunction, "ArrowFunctionExpression") ||
    cleanupFunction.async ||
    cleanupFunction.generator ||
    cleanupFunction.params.length !== 0 ||
    !isNodeOfType(cleanupFunction.body, "BlockStatement") ||
    !isNodeOfType(cleanupFunction.parent, "ReturnStatement") ||
    cleanupFunction.parent.argument !== cleanupFunction ||
    cleanupFunction.parent.parent !== effectCallback.body
  )
    return false;
  let hasLexicalEvalReference = false;
  walkAst(effectCallback.body, (node) => {
    if (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node))
      hasLexicalEvalReference = true;
  });
  if (hasLexicalEvalReference) return false;
  const firstStatement = cleanupFunction.body.body[0];
  const invocation = isNodeOfType(firstStatement, "ExpressionStatement")
    ? stripParenExpression(firstStatement.expression)
    : null;
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.arguments.length !== 0 ||
    !isNodeOfType(invocation.callee, "Identifier")
  )
    return false;
  const helperSymbol = scopes.symbolFor(invocation.callee);
  const declaration = helperSymbol?.declarationNode;
  const helperFunctions = resolveCleanupFunctions(invocation.callee, invocation, scopes);
  const helperFunction = helperFunctions[0];
  if (
    !helperSymbol ||
    helperSymbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== helperSymbol.bindingIdentifier ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.parent !== effectCallback.body ||
    helperFunctions.length !== 1 ||
    !isNodeOfType(helperFunction, "ArrowFunctionExpression") ||
    declaration.init !== helperFunction ||
    helperFunction.async ||
    helperFunction.generator ||
    helperFunction.params.length !== 0 ||
    !isNodeOfType(helperFunction.body, "BlockStatement")
  )
    return false;
  for (const reference of helperSymbol.references) {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const call = identifier.parent;
    if (
      reference.flag !== "read" ||
      isWithinAssignmentTarget(reference.identifier) ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== identifier ||
      call.optional ||
      call.arguments.length !== 0
    )
      return false;
  }
  const firstCall = schedulingCalls[0];
  const firstAssignment = firstCall && findTransparentExpressionRoot(firstCall).parent;
  if (
    !isNodeOfType(firstAssignment, "AssignmentExpression") ||
    firstAssignment.operator !== "=" ||
    !isNodeOfType(firstAssignment.left, "Identifier")
  )
    return false;
  const handleSymbol = scopes.symbolFor(firstAssignment.left);
  const handleDeclaration = handleSymbol?.declarationNode;
  if (
    !handleSymbol ||
    handleSymbol.kind !== "let" ||
    !isNodeOfType(handleDeclaration, "VariableDeclarator") ||
    handleDeclaration.id !== handleSymbol.bindingIdentifier ||
    !isNodeOfType(handleDeclaration.init, "Literal") ||
    handleDeclaration.init.value !== 0 ||
    !isNodeOfType(handleDeclaration.parent, "VariableDeclaration") ||
    handleDeclaration.parent.parent !== effectCallback.body
  )
    return false;
  const helperStatementIndex = effectCallback.body.body.findIndex(
    (statement) => statement === declaration.parent,
  );
  const handleStatementIndex = effectCallback.body.body.findIndex(
    (statement) => statement === handleDeclaration.parent,
  );
  const cleanupReturnIndex = effectCallback.body.body.findIndex(
    (statement) => statement === cleanupFunction.parent,
  );
  if (
    helperStatementIndex < 0 ||
    handleStatementIndex < 0 ||
    cleanupReturnIndex <= helperStatementIndex ||
    cleanupReturnIndex <= handleStatementIndex
  )
    return false;
  const handleWrites = new Set<EsTreeNode>();
  for (const schedulingCall of schedulingCalls) {
    const assignment = findTransparentExpressionRoot(schedulingCall).parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      !isNodeOfType(assignment.left, "Identifier") ||
      scopes.symbolFor(assignment.left) !== handleSymbol
    )
      return false;
    handleWrites.add(assignment.left);
  }
  const helperStatements = helperFunction.body.body;
  const firstHelperStatement = helperStatements[0];
  let cancellationStatements = helperStatements;
  let selectedTest: EsTreeNode | null = null;
  if (isNodeOfType(firstHelperStatement, "IfStatement")) {
    const test = stripParenExpression(firstHelperStatement.test);
    if (
      helperStatements.length !== 1 ||
      firstHelperStatement.alternate ||
      !isNodeOfType(firstHelperStatement.consequent, "BlockStatement") ||
      !isNodeOfType(test, "BinaryExpression") ||
      test.operator !== "!==" ||
      !isNodeOfType(test.left, "Identifier") ||
      scopes.symbolFor(test.left) !== handleSymbol ||
      !isNodeOfType(test.right, "Literal") ||
      test.right.value !== 0
    )
      return false;
    selectedTest = test;
    cancellationStatements = firstHelperStatement.consequent.body;
  }
  const cancelStatement = cancellationStatements[0];
  const cancelCall = isNodeOfType(cancelStatement, "ExpressionStatement")
    ? stripParenExpression(cancelStatement.expression)
    : null;
  if (
    !isNodeOfType(cancelCall, "CallExpression") ||
    cancelCall.optional ||
    cancelCall.arguments.length !== 1 ||
    !isNodeOfType(cancelCall.arguments[0], "Identifier") ||
    scopes.symbolFor(cancelCall.arguments[0]) !== handleSymbol
  )
    return false;
  const cancelCallee = stripParenExpression(cancelCall.callee);
  const cancelReceiver = isNodeOfType(cancelCallee, "MemberExpression")
    ? stripParenExpression(cancelCallee.object)
    : null;
  const isCanonicalCancel =
    isGlobalBrowserFunctionCall(cancelCall, "cancelAnimationFrame", scopes) ||
    (isNodeOfType(cancelCallee, "MemberExpression") &&
      !cancelCallee.optional &&
      getStaticPropertyName(cancelCallee) === "cancelAnimationFrame" &&
      isNodeOfType(cancelReceiver, "Identifier") &&
      cancelReceiver.name === "self" &&
      scopes.isGlobalReference(cancelReceiver));
  if (!isCanonicalCancel) return false;
  if (selectedTest) {
    const resetStatement = cancellationStatements[1];
    const reset = isNodeOfType(resetStatement, "ExpressionStatement")
      ? stripParenExpression(resetStatement.expression)
      : null;
    if (
      cancellationStatements.length !== 2 ||
      !isNodeOfType(reset, "AssignmentExpression") ||
      reset.operator !== "=" ||
      !isNodeOfType(reset.left, "Identifier") ||
      scopes.symbolFor(reset.left) !== handleSymbol ||
      !isNodeOfType(reset.right, "Literal") ||
      reset.right.value !== 0
    )
      return false;
    handleWrites.add(reset.left);
  } else if (cancellationStatements.length !== 1) return false;
  for (const reference of handleSymbol.references) {
    if (handleWrites.has(reference.identifier)) continue;
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return false;
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const parent = identifier.parent;
    if (parent === cancelCall && cancelCall.arguments[0] === identifier) continue;
    if (
      !isNodeOfType(parent, "BinaryExpression") ||
      (parent.operator !== "===" && parent.operator !== "!==") ||
      parent.left !== identifier ||
      !isNodeOfType(parent.right, "Literal") ||
      parent.right.value !== 0
    )
      return false;
  }
  return hasClosedFrameCancellationProvider(effectCallback, scopes);
};
