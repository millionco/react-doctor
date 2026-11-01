import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNoOpStatement } from "../../../utils/is-no-op-statement.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  NATIVE_TRANSITION_ACTION_INDEX,
  NATIVE_TRANSITION_CALL_ARGUMENT_COUNT,
  NATIVE_TRANSITION_TUPLE_ELEMENT_COUNT,
} from "./constants.js";
import { hasClosedTransitionTupleProvider } from "./has-closed-transition-tuple-provider.js";
import { isClosedReactCommandHookCall } from "./is-closed-react-command-hook-call.js";

export const getNativeTransitionActionCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode | null => {
  if (call.optional || call.arguments.length !== NATIVE_TRANSITION_CALL_ARGUMENT_COUNT) {
    return null;
  }
  const callee = stripParenExpression(call.callee);
  const callback = stripParenExpression(call.arguments[0]);
  if (
    !isNodeOfType(callee, "Identifier") ||
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      (!isNodeOfType(callback, "FunctionExpression") || callback.id)) ||
    !callback.async ||
    callback.generator ||
    callback.params.length > 0
  ) {
    return null;
  }
  const invocationFrame = findEnclosingFunction(call);
  const callRoot = findTransparentExpressionRoot(call);
  const statement = callRoot.parent;
  if (
    !isFunctionLike(invocationFrame) ||
    invocationFrame.async ||
    invocationFrame.generator ||
    invocationFrame.params.length > 0 ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== callRoot ||
    statement.parent !== invocationFrame.body
  ) {
    return null;
  }
  const effectCall = findTransparentExpressionRoot(invocationFrame).parent;
  if (
    !isNodeOfType(effectCall, "CallExpression") ||
    effectCall.arguments[0] !== invocationFrame ||
    !isNodeOfType(invocationFrame.body, "BlockStatement") ||
    !isNodeReachableWithinFunction(call, context) ||
    !isNodeReachableWithinFunction(effectCall, context)
  ) {
    return null;
  }
  let hasNativeEffectProvider = false;
  for (const hookName of EFFECT_HOOK_NAMES) {
    if (isClosedReactCommandHookCall(effectCall, hookName, context.scopes)) {
      hasNativeEffectProvider = true;
      break;
    }
  }
  if (!hasNativeEffectProvider) return null;
  for (const preceding of invocationFrame.body.body) {
    if (preceding === statement) break;
    if (
      (isNodeOfType(preceding, "EmptyStatement") ||
        (isNodeOfType(preceding, "ExpressionStatement") &&
          (isNodeOfType(preceding.expression, "Literal") ||
            (isNodeOfType(preceding.expression, "UnaryExpression") &&
              preceding.expression.operator === "void" &&
              isNodeOfType(preceding.expression.argument, "Literal"))))) &&
      isNoOpStatement(preceding)
    ) {
      continue;
    }
    if (
      !isNodeOfType(preceding, "VariableDeclaration") ||
      preceding.declarations.some(
        (declaration) =>
          !isNodeOfType(declaration.id, "Identifier") ||
          !isNodeOfType(declaration.init, "Literal") ||
          "regex" in declaration.init,
      )
    ) {
      return null;
    }
  }
  const symbol = context.scopes.symbolFor(callee);
  if (!symbol || symbol.kind !== "const") return null;
  const declarator = symbol.declarationNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== NATIVE_TRANSITION_TUPLE_ELEMENT_COUNT ||
    !declarator.id.elements.every((element) => isNodeOfType(element, "Identifier")) ||
    declarator.id.elements[NATIVE_TRANSITION_ACTION_INDEX] !== symbol.bindingIdentifier ||
    !declarator.init
  ) {
    return null;
  }
  const owner = findEnclosingFunction(declarator);
  const initializer = stripParenExpression(declarator.init);
  if (
    !isFunctionLike(owner) ||
    declarator.parent?.parent !== owner.body ||
    effectCall.parent?.parent !== owner.body ||
    !isNodeOfType(effectCall.parent, "ExpressionStatement") ||
    !isAstDescendant(call, owner) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length > 0 ||
    !isClosedReactCommandHookCall(initializer, "useTransition", context.scopes) ||
    !hasClosedTransitionTupleProvider(context.scopes) ||
    symbol.scope.symbols.some(
      (otherSymbol) => otherSymbol !== symbol && otherSymbol.name === symbol.name,
    ) ||
    symbol.references.some((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return false;
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      return (
        reference.flag !== "read" ||
        isWithinAssignmentTarget(reference.identifier) ||
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== root ||
        parent.optional
      );
    })
  ) {
    return null;
  }
  return callback;
};
