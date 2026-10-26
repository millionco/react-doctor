import { getOwnedInputStatements } from "./get-owned-input-statements.js";
import { getExpressionStatementCall } from "./get-expression-statement-call.js";
import { OWNED_INPUT_RESTORATION_DEPENDENCY_HOOK_NAMES } from "./constants.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { OwnedInputState } from "./collect-owned-input-states.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isReactHookDependencyRead } from "./is-react-hook-dependency-read.js";
import { readOwnedInputNumber } from "./read-owned-input-number.js";

export interface OwnedInputFocusReset {
  readonly state: OwnedInputState;
  readonly targetInitializer: EsTreeNode;
}

interface ResolveOwnedInputFocusResetInput {
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly component: EsTreeNode;
  readonly states: readonly OwnedInputState[];
  readonly context: RuleContext;
  readonly allowStableCallback?: boolean;
  readonly allowUnguardedReset?: boolean;
}

export const resolveOwnedInputFocusReset = ({
  call,
  component,
  states,
  context,
  allowStableCallback = false,
  allowUnguardedReset = false,
}: ResolveOwnedInputFocusResetInput): OwnedInputFocusReset | null => {
  if (!isFunctionLike(component) || call.optional || call.arguments.length) return null;
  const callee = stripParenExpression(call.callee);
  const helper = isNodeOfType(callee, "Identifier") ? context.scopes.symbolFor(callee) : null;
  const program = findProgramRoot(component);
  if (
    !helper ||
    !program ||
    helper.kind !== "const" ||
    !isNodeOfType(helper.declarationNode, "VariableDeclarator") ||
    helper.declarationNode.parent?.parent !== component.body
  )
    return null;
  const allowedReads = new Set(
    helper.references
      .filter((reference) => {
        const identifier = findTransparentExpressionRoot(reference.identifier);
        const invocation = identifier.parent;
        if (
          isNodeOfType(invocation, "CallExpression") &&
          !invocation.optional &&
          invocation.callee === identifier &&
          !invocation.arguments.length
        )
          return true;
        return (
          allowStableCallback &&
          isReactHookDependencyRead(
            identifier,
            context.scopes,
            OWNED_INPUT_RESTORATION_DEPENDENCY_HOOK_NAMES,
          )
        );
      })
      .map((reference) => reference.identifier),
  );
  if (
    !hasOnlyAllowedSymbolReads({
      symbol: helper,
      allowedIdentifiers: allowedReads,
      program,
      scopes: context.scopes,
    })
  )
    return null;
  const initial = getDirectUnreassignedInitializer(helper);
  if (!initial) return null;
  let callback = stripParenExpression(initial);
  if (isNodeOfType(callback, "CallExpression")) {
    if (
      !allowStableCallback ||
      callback.optional ||
      !isProvenUnmodifiedReactApiCall(callback, "useCallback", context.scopes) ||
      hasReactDefaultProviderMutation("useCallback", context.scopes)
    )
      return null;
    const [body, dependencies, ...extraArguments] = callback.arguments;
    if (
      !body ||
      isNodeOfType(body, "SpreadElement") ||
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.length ||
      extraArguments.length
    )
      return null;
    callback = stripParenExpression(body);
  }
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return null;
  const statements = getOwnedInputStatements(callback.body);
  const [first, second, ...extraStatements] = statements;
  if (extraStatements.length) return null;
  let targetInitializer: EsTreeNode;
  let focus: EsTreeNodeOfType<"CallExpression"> | null;
  let reset: EsTreeNodeOfType<"CallExpression"> | null;
  if (
    isNodeOfType(first, "VariableDeclaration") &&
    first.kind === "const" &&
    isNodeOfType(second, "IfStatement") &&
    !second.alternate
  ) {
    const [targetDeclaration, ...extraDeclarations] = first.declarations;
    if (
      extraDeclarations.length ||
      !targetDeclaration ||
      !isNodeOfType(targetDeclaration.id, "Identifier") ||
      !targetDeclaration.init
    )
      return null;
    const target = context.scopes.symbolFor(targetDeclaration.id);
    const guard = stripParenExpression(second.test);
    if (!target || !isNodeOfType(guard, "Identifier") || context.scopes.symbolFor(guard) !== target)
      return null;
    const [focusStatement, resetStatement, ...extraWork] = getOwnedInputStatements(
      second.consequent,
    );
    focus = getExpressionStatementCall(focusStatement);
    reset = getExpressionStatementCall(resetStatement);
    if (!focus || !reset || extraWork.length || focus.arguments.length) return null;
    const method = stripParenExpression(focus.callee);
    if (
      !isNodeOfType(method, "MemberExpression") ||
      method.optional ||
      getStaticPropertyName(method) !== "focus"
    )
      return null;
    const receiver = stripParenExpression(method.object);
    if (!isNodeOfType(receiver, "Identifier") || context.scopes.symbolFor(receiver) !== target)
      return null;
    if (
      !hasOnlyAllowedSymbolReads({
        symbol: target,
        allowedIdentifiers: new Set([guard, receiver]),
        program,
        scopes: context.scopes,
      })
    )
      return null;
    targetInitializer = targetDeclaration.init;
  } else {
    if (!allowUnguardedReset || !isNodeOfType(first, "IfStatement") || first.alternate) return null;
    const [focusStatement, ...extraWork] = getOwnedInputStatements(first.consequent);
    focus = getExpressionStatementCall(focusStatement);
    reset = getExpressionStatementCall(second);
    if (!focus || !reset || extraWork.length || focus.arguments.length) return null;
    const guard = stripParenExpression(first.test);
    const method = stripParenExpression(focus.callee);
    if (
      !isNodeOfType(guard, "MemberExpression") ||
      guard.optional ||
      getStaticPropertyName(guard) !== "current" ||
      !isNodeOfType(method, "MemberExpression") ||
      method.optional ||
      getStaticPropertyName(method) !== "focus"
    )
      return null;
    const receiver = stripParenExpression(method.object);
    if (
      !isNodeOfType(receiver, "MemberExpression") ||
      receiver.optional ||
      getStaticPropertyName(receiver) !== "current"
    )
      return null;
    const guardedRef = stripParenExpression(guard.object);
    const focusedRef = stripParenExpression(receiver.object);
    if (!isNodeOfType(guardedRef, "Identifier") || !isNodeOfType(focusedRef, "Identifier"))
      return null;
    const reference = context.scopes.symbolFor(guardedRef);
    if (!reference || context.scopes.symbolFor(focusedRef) !== reference) return null;
    targetInitializer = first.test;
  }
  const setter = stripParenExpression(reset.callee);
  const state = isNodeOfType(setter, "Identifier")
    ? states.find((candidate) => candidate.setter === context.scopes.symbolFor(setter))
    : null;
  const [value, ...extraArguments] = reset.arguments;
  if (!state || !value || isNodeOfType(value, "SpreadElement") || extraArguments.length)
    return null;
  const initialNumber = readOwnedInputNumber(state.initial, context);
  const resetNumber = readOwnedInputNumber(value, context);
  if (initialNumber === null || resetNumber === null || !Object.is(initialNumber, resetNumber))
    return null;
  return { state, targetInitializer };
};
