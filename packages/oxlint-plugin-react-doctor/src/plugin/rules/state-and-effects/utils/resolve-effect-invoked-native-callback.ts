import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { enclosingComponentOrHookScope } from "../../../utils/enclosing-component-or-hook-scope.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isClosedReactNamedHookCall } from "./is-closed-react-named-hook-call.js";
import {
  NATIVE_CALLBACK_HOOK_ARGUMENT_COUNT,
  NATIVE_EFFECT_CALLBACK_PARAMETER_COUNT,
} from "./constants.js";

const isDirectEffectCall = (call: EsTreeNode, effectCallback: EsTreeNode): boolean => {
  let ancestor = call.parent;
  while (ancestor && ancestor !== effectCallback) {
    if (
      isFunctionLike(ancestor) ||
      isNodeOfType(ancestor, "ClassBody") ||
      isNodeOfType(ancestor, "StaticBlock")
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return ancestor === effectCallback;
};

export const resolveEffectInvokedNativeCallback = (
  invocation: EsTreeNode,
  effectCall: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isNodeOfType(invocation, "CallExpression") || invocation.optional) return null;
  const identifier = stripParenExpression(invocation.callee);
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return null;
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return null;
  const callbackCall = stripParenExpression(initializer);
  if (
    !isNodeOfType(callbackCall, "CallExpression") ||
    callbackCall.arguments.length !== NATIVE_CALLBACK_HOOK_ARGUMENT_COUNT ||
    callbackCall.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isClosedReactNamedHookCall(callbackCall, "useCallback", context.scopes)
  ) {
    return null;
  }
  if (
    invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isDirectEffectCall(invocation, effectCallback) ||
    !isNodeOfType(effectCall, "CallExpression") ||
    effectCall.arguments.length !== NATIVE_CALLBACK_HOOK_ARGUMENT_COUNT ||
    effectCall.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") ||
    effectCallback.async ||
    effectCallback.params.length !== NATIVE_EFFECT_CALLBACK_PARAMETER_COUNT ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    !isClosedReactNamedHookCall(effectCall, "useEffect", context.scopes) ||
    !isNodeReachableWithinFunction(invocation, context) ||
    !isNodeReachableWithinFunction(effectCall, context)
  ) {
    return null;
  }
  const [, effectDependencies] = effectCall.arguments;
  if (
    getEffectCallback(effectCall, context.scopes) !== effectCallback ||
    !isNodeOfType(effectDependencies, "ArrayExpression") ||
    effectDependencies.elements.some((element) => isNodeOfType(element, "SpreadElement"))
  ) {
    return null;
  }
  let hasOwnReturn = false;
  walkAst(effectCallback.body, (node) => {
    if (node !== effectCallback.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement")) hasOwnReturn = true;
  });
  if (hasOwnReturn) return null;
  const [callback, callbackDependencies] = callbackCall.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(callbackDependencies, "ArrayExpression") ||
    callbackDependencies.elements.some((element) => isNodeOfType(element, "SpreadElement"))
  ) {
    return null;
  }
  const owner = enclosingComponentOrHookScope(effectCall, context.scopes.ownScopeFor);
  if (!owner || findEnclosingFunction(symbol.declarationNode) !== owner.functionNode) return null;
  for (const reference of symbol.references) {
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return null;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const parent = referenceRoot.parent;
    if (
      parent === effectDependencies &&
      effectDependencies.elements.some((element) => element === referenceRoot)
    ) {
      continue;
    }
    if (
      !isNodeOfType(parent, "CallExpression") ||
      parent.callee !== referenceRoot ||
      parent.optional ||
      parent.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
      !isDirectEffectCall(parent, effectCallback)
    ) {
      return null;
    }
  }
  return callback;
};
