import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { collectReturnedCleanupFunctions } from "../../../utils/collect-returned-cleanup-functions.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { serializeReferenceKey } from "../../../utils/serialize-reference-key.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  FINITE_COUNTDOWN_BODY_STATEMENT_COUNT,
  FINITE_COUNTDOWN_DECREMENT_COUNT,
  FINITE_COUNTDOWN_MINIMUM_REPEAT_COUNT,
  FINITE_COUNTDOWN_MINIMUM_ITERATION_COUNT,
  FINITE_COUNTDOWN_MAXIMUM_ITERATION_COUNT,
  FINITE_COUNTDOWN_TERMINAL_COUNT,
} from "./constants.js";

interface FiniteCountdownLoop {
  iterationCount: number;
  resetGuardKey: string | null;
}

interface FindFiniteCountdownLoopInput {
  whileStatement: EsTreeNodeOfType<"WhileStatement">;
  cleanupWrites: ReadonlyMap<string, boolean>;
  context: RuleContext;
  isStateDispatcherCall: (
    call: EsTreeNodeOfType<"CallExpression">,
    context: RuleContext,
  ) => boolean;
}

interface FiniteCountdownScopeFacts {
  readonly program: EsTreeNode;
  readonly dynamicScopeByEffect: WeakMap<EsTreeNode, boolean>;
}

const factsByScopes = new WeakMap<ScopeAnalysis, FiniteCountdownScopeFacts>();

export const findFiniteCountdownLoop = ({
  whileStatement,
  cleanupWrites,
  context,
  isStateDispatcherCall,
}: FindFiniteCountdownLoopInput): FiniteCountdownLoop | null => {
  const owner = findEnclosingFunction(whileStatement);
  const test = stripParenExpression(whileStatement.test);
  if (
    !isNodeOfType(owner, "ArrowFunctionExpression") ||
    !owner.async ||
    owner.params.length !== 0 ||
    !isNodeOfType(owner.parent, "VariableDeclarator") ||
    owner.parent.init !== owner ||
    !isNodeOfType(owner.parent.parent, "VariableDeclaration") ||
    owner.parent.parent.kind !== "const" ||
    whileStatement.parent !== owner.body ||
    !isNodeOfType(whileStatement.body, "BlockStatement") ||
    whileStatement.body.body.length !== FINITE_COUNTDOWN_BODY_STATEMENT_COUNT ||
    !isNodeOfType(test, "BinaryExpression") ||
    test.operator !== ">" ||
    !isNodeOfType(test.left, "Identifier") ||
    !isNodeOfType(test.right, "Literal") ||
    test.right.value !== FINITE_COUNTDOWN_TERMINAL_COUNT
  )
    return null;
  const [firstStatement, waitStatement, decrementStatement] = whileStatement.body.body;
  if (
    !isNodeOfType(firstStatement, "ExpressionStatement") ||
    !(
      (isNodeOfType(firstStatement.expression, "CallExpression") &&
        isStateDispatcherCall(firstStatement.expression, context)) ||
      (isNodeOfType(firstStatement.expression, "AssignmentExpression") &&
        firstStatement.expression.operator === "=" &&
        isNodeOfType(firstStatement.expression.left, "Identifier") &&
        isNodeOfType(firstStatement.expression.right, "Literal") &&
        typeof firstStatement.expression.right.value === "boolean")
    ) ||
    !isNodeOfType(waitStatement, "ExpressionStatement") ||
    !isNodeOfType(waitStatement.expression, "AwaitExpression") ||
    !isNodeOfType(waitStatement.expression.argument, "CallExpression") ||
    !isNodeOfType(waitStatement.expression.argument.callee, "Identifier") ||
    waitStatement.expression.argument.callee.name === "eval" ||
    waitStatement.expression.argument.arguments.length !== 0 ||
    !isNodeOfType(decrementStatement, "ExpressionStatement") ||
    !isNodeOfType(decrementStatement.expression, "AssignmentExpression") ||
    decrementStatement.expression.operator !== "-=" ||
    !isNodeOfType(decrementStatement.expression.left, "Identifier") ||
    !isNodeOfType(decrementStatement.expression.right, "Literal") ||
    decrementStatement.expression.right.value !== FINITE_COUNTDOWN_DECREMENT_COUNT
  )
    return null;
  const decrementTarget = decrementStatement.expression.left;
  const counter = context.scopes.symbolFor(test.left);
  const declaration = counter?.declarationNode;
  if (
    !counter ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== counter.bindingIdentifier ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "let" ||
    declaration.parent.parent !== owner.body ||
    !isNodeOfType(declaration.init, "Literal") ||
    typeof declaration.init.value !== "number" ||
    !Number.isSafeInteger(declaration.init.value) ||
    declaration.init.value < FINITE_COUNTDOWN_MINIMUM_ITERATION_COUNT ||
    declaration.init.value > FINITE_COUNTDOWN_MAXIMUM_ITERATION_COUNT ||
    !nodeDominatesNode(declaration.init, whileStatement, context) ||
    context.scopes.symbolFor(decrementTarget) !== counter ||
    !hasCompleteSymbolReferences(counter, context.scopes.rootScope.node, context.scopes) ||
    counter.references.some(
      (reference) =>
        reference.identifier !== counter.bindingIdentifier &&
        reference.identifier !== test.left &&
        reference.identifier !== decrementTarget,
    )
  )
    return null;
  const effectCallback = findEnclosingFunction(owner);
  const effectCall = effectCallback?.parent;
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") ||
    effectCallback.async ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    !isNodeOfType(effectCall, "CallExpression") ||
    getEffectCallback(effectCall) !== effectCallback ||
    !isReactApiCall(effectCall, EFFECT_HOOK_NAMES, context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
    }) ||
    owner.parent.parent.parent !== effectCallback.body
  )
    return null;
  const ownerBinding = owner.parent.id;
  if (!isNodeOfType(ownerBinding, "Identifier")) return null;
  const ownerSymbol = context.scopes.symbolFor(ownerBinding);
  if (
    !ownerSymbol ||
    !hasCompleteSymbolReferences(ownerSymbol, context.scopes.rootScope.node, context.scopes)
  )
    return null;
  let invocationCount = 0;
  for (const reference of ownerSymbol.references) {
    const identifier = reference.identifier;
    if (identifier === ownerSymbol.bindingIdentifier) continue;
    const call = identifier.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== identifier ||
      call.optional ||
      call.arguments.length !== 0 ||
      findEnclosingFunction(call) !== effectCallback ||
      !nodeDominatesNode(owner.parent, call, context)
    )
      return null;
    const statement =
      isNodeOfType(call.parent, "UnaryExpression") && call.parent.operator === "void"
        ? call.parent.parent
        : call.parent;
    if (!isNodeOfType(statement, "ExpressionStatement") || statement.parent !== effectCallback.body)
      return null;
    invocationCount += 1;
  }
  if (invocationCount === 0) return null;
  const scopes = context.scopes;
  const program = scopes.rootScope.node;
  let scopeFacts = factsByScopes.get(scopes);
  if (!scopeFacts || scopeFacts.program !== program) {
    scopeFacts = { program, dynamicScopeByEffect: new WeakMap() };
    factsByScopes.set(scopes, scopeFacts);
  }
  let hasDynamicScope = scopeFacts.dynamicScopeByEffect.get(effectCallback);
  if (hasDynamicScope === undefined) {
    hasDynamicScope = false;
    walkAst(effectCallback, (candidate) => {
      const callee = isNodeOfType(candidate, "CallExpression")
        ? stripParenExpression(candidate.callee)
        : null;
      if (
        isNodeOfType(candidate, "WithStatement") ||
        (isNodeOfType(callee, "Identifier") && callee.name === "eval")
      )
        hasDynamicScope = true;
    });
    scopeFacts.dynamicScopeByEffect.set(effectCallback, hasDynamicScope);
  }
  if (hasDynamicScope) return null;
  const countdown = { iterationCount: declaration.init.value, resetGuardKey: null };
  if (isNodeOfType(firstStatement.expression, "CallExpression")) return countdown;
  const reset = firstStatement.expression;
  if (
    declaration.init.value < FINITE_COUNTDOWN_MINIMUM_REPEAT_COUNT ||
    !isNodeOfType(reset, "AssignmentExpression") ||
    !isNodeOfType(reset.left, "Identifier") ||
    !isNodeOfType(reset.right, "Literal") ||
    typeof reset.right.value !== "boolean"
  )
    return countdown;
  const resetValue = reset.right.value;
  const guard = context.scopes.symbolFor(reset.left);
  const guardKey = serializeReferenceKey({ node: reset.left, scopes: context.scopes });
  const cleanupValue = guardKey ? cleanupWrites.get(guardKey) : undefined;
  const guardDeclaration = guard?.declarationNode;
  if (
    !guard ||
    !guardKey ||
    typeof cleanupValue !== "boolean" ||
    cleanupValue === resetValue ||
    !isNodeOfType(guardDeclaration, "VariableDeclarator") ||
    guardDeclaration.id !== guard.bindingIdentifier ||
    !isNodeOfType(guardDeclaration.init, "Literal") ||
    guardDeclaration.init.value !== resetValue ||
    !isNodeOfType(guardDeclaration.parent, "VariableDeclaration") ||
    guardDeclaration.parent.kind !== "let" ||
    guardDeclaration.parent.parent !== effectCallback.body ||
    !nodeDominatesNode(guardDeclaration.init, owner.parent, context) ||
    !hasCompleteSymbolReferences(guard, context.scopes.rootScope.node, context.scopes)
  )
    return countdown;
  const guardOwner = effectCallback;
  const cleanups = collectReturnedCleanupFunctions(guardOwner, context.scopes);
  if (cleanups.length !== 1) return countdown;
  const cleanup = cleanups[0];
  if (
    !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
    cleanup.async ||
    cleanup.params.length !== 0 ||
    !isNodeOfType(cleanup.parent, "ReturnStatement") ||
    cleanup.parent.argument !== cleanup ||
    !isNodeOfType(cleanup.body, "BlockStatement") ||
    cleanup.body.body.length !== 1
  )
    return countdown;
  const cleanupStatement = cleanup.body.body[0];
  if (
    !isNodeOfType(cleanupStatement, "ExpressionStatement") ||
    !isNodeOfType(cleanupStatement.expression, "AssignmentExpression") ||
    cleanupStatement.expression.operator !== "=" ||
    !isNodeOfType(cleanupStatement.expression.left, "Identifier") ||
    context.scopes.symbolFor(cleanupStatement.expression.left) !== guard ||
    !isNodeOfType(cleanupStatement.expression.right, "Literal") ||
    cleanupStatement.expression.right.value !== cleanupValue
  )
    return countdown;
  const cleanupTarget = cleanupStatement.expression.left;
  if (
    guard.references.some(
      (reference) =>
        reference.flag !== "read" &&
        reference.identifier !== guard.bindingIdentifier &&
        reference.identifier !== reset.left &&
        reference.identifier !== cleanupTarget,
    )
  )
    return countdown;
  return { iterationCount: declaration.init.value, resetGuardKey: guardKey };
};
