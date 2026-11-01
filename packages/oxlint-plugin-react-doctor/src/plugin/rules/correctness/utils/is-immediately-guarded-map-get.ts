import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { GUARDED_MAP_GET_ARGUMENT_COUNT, GUARDED_MAP_KEY_ARGUMENT_INDEX } from "./constants.js";
import { isClosedLocalMapReference } from "./is-closed-local-map-reference.js";

export const isImmediatelyGuardedMapGet = (
  assertion: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(assertion, "TSNonNullExpression")) return false;
  const assertedCall = stripParenExpression(assertion.expression);
  if (!isNodeOfType(assertedCall, "CallExpression") || assertedCall.optional) return false;
  const assertedMember = stripParenExpression(assertedCall.callee);
  if (
    !isNodeOfType(assertedMember, "MemberExpression") ||
    assertedMember.computed ||
    assertedMember.optional ||
    !isNodeOfType(assertedMember.property, "Identifier") ||
    assertedMember.property.name !== "get"
  ) {
    return false;
  }
  const receiver = stripParenExpression(assertedMember.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  let consequent: EsTreeNode = findTransparentExpressionRoot(assertion);
  let conditional = consequent.parent;
  while (conditional && !isNodeOfType(conditional, "ConditionalExpression")) {
    if (
      (isNodeOfType(conditional, "MemberExpression") && conditional.object === consequent) ||
      (isNodeOfType(conditional, "CallExpression") && conditional.callee === consequent)
    ) {
      consequent = findTransparentExpressionRoot(conditional);
      conditional = consequent.parent;
      continue;
    }
    return false;
  }
  if (
    !isNodeOfType(conditional, "ConditionalExpression") ||
    conditional.consequent !== consequent
  ) {
    return false;
  }
  const guardCall = stripParenExpression(conditional.test);
  if (!isNodeOfType(guardCall, "CallExpression") || guardCall.optional) return false;
  const guardMember = stripParenExpression(guardCall.callee);
  if (
    !isNodeOfType(guardMember, "MemberExpression") ||
    guardMember.computed ||
    guardMember.optional ||
    !isNodeOfType(guardMember.property, "Identifier") ||
    guardMember.property.name !== "get"
  ) {
    return false;
  }
  const guardReceiver = stripParenExpression(guardMember.object);
  const receiverSymbol = context.scopes.symbolFor(receiver);
  if (
    !receiverSymbol ||
    !isNodeOfType(guardReceiver, "Identifier") ||
    context.scopes.symbolFor(guardReceiver)?.id !== receiverSymbol.id ||
    assertedCall.arguments.length !== GUARDED_MAP_GET_ARGUMENT_COUNT ||
    guardCall.arguments.length !== GUARDED_MAP_GET_ARGUMENT_COUNT
  ) {
    return false;
  }
  const assertedKey = stripParenExpression(assertedCall.arguments[GUARDED_MAP_KEY_ARGUMENT_INDEX]);
  const guardKey = stripParenExpression(guardCall.arguments[GUARDED_MAP_KEY_ARGUMENT_INDEX]);
  if (isNodeOfType(assertedKey, "Identifier") && isNodeOfType(guardKey, "Identifier")) {
    const keySymbol = context.scopes.symbolFor(assertedKey);
    if (
      !keySymbol ||
      context.scopes.symbolFor(guardKey)?.id !== keySymbol.id ||
      !getDirectConstInitializer(keySymbol) ||
      keySymbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
  } else if (
    !isNodeOfType(assertedKey, "Literal") ||
    !isNodeOfType(guardKey, "Literal") ||
    "regex" in assertedKey ||
    "regex" in guardKey ||
    "bigint" in assertedKey ||
    "bigint" in guardKey ||
    !(
      assertedKey.value === null ||
      ["string", "number", "boolean"].includes(typeof assertedKey.value)
    ) ||
    !Object.is(assertedKey.value, guardKey.value)
  ) {
    return false;
  }
  return isClosedLocalMapReference(receiver, context);
};
