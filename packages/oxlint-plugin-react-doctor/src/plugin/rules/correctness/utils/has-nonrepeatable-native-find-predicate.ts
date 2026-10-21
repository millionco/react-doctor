import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isClosedNativeArrayFindReceiver } from "./is-closed-native-array-find-receiver.js";
import {
  FIND_METHOD_NAMES,
  REPEATED_FIND_COUNTER_INITIAL_VALUE,
  REPEATED_FIND_COUNTER_MATCH_VALUE,
  REPEATED_FIND_GUARD_METHOD_NAMES,
  REPEATED_FIND_SINGLE_ITEM_COUNT,
} from "./native-array-find/constants.js";

interface CapturedScalarTransition {
  readonly symbol: SymbolDescriptor;
  readonly kind: "counter" | "toggle";
  readonly identifiers: ReadonlyArray<EsTreeNode>;
}

const getRepeatedPredicateReceiver = (
  call: EsTreeNodeOfType<"CallExpression">,
  isGuard: boolean,
): EsTreeNodeOfType<"Identifier"> | null => {
  const member = stripParenExpression(call.callee);
  const methodNames = isGuard ? REPEATED_FIND_GUARD_METHOD_NAMES : FIND_METHOD_NAMES;
  if (
    call.optional ||
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    !methodNames.has(getStaticPropertyName(member) ?? "")
  )
    return null;
  const receiver = stripParenExpression(member.object);
  return isNodeOfType(receiver, "Identifier") ? receiver : null;
};

const getRepeatedPredicateCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  otherCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  const [argument, ...remainingArguments] = call.arguments;
  if (!argument || remainingArguments.length > 0) return null;
  let callback = stripParenExpression(argument);
  if (isNodeOfType(callback, "Identifier")) {
    const symbol = context.scopes.symbolFor(callback);
    const initializer = symbol && getDirectConstInitializer(symbol);
    const declaration = symbol?.declarationNode.parent;
    const [otherArgument] = otherCall.arguments;
    if (
      !symbol ||
      !initializer ||
      !otherArgument ||
      !isNodeOfType(declaration, "VariableDeclaration") ||
      isNodeOfType(declaration.parent, "ExportNamedDeclaration") ||
      !symbol.references.every(
        (reference) =>
          isTypeScriptTypePosition(reference.identifier) ||
          (reference.flag === "read" &&
            (reference.identifier === callback ||
              reference.identifier === stripParenExpression(otherArgument))),
      )
    )
      return null;
    callback = stripParenExpression(initializer);
  }
  if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return null;
  const [parameter, ...remainingParameters] = callback.params;
  if (parameter || remainingParameters.length > 0) return null;
  return callback;
};

const getCapturedScalarTransition = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression">,
  context: RuleContext,
): CapturedScalarTransition | null => {
  const returnedExpression = getSingleReturnExpression(callback);
  if (!returnedExpression) return null;
  const expression = stripParenExpression(returnedExpression);
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    expression.operator === "===" &&
    isNodeOfType(expression.right, "Literal") &&
    expression.right.value === REPEATED_FIND_COUNTER_MATCH_VALUE
  ) {
    const increment = stripParenExpression(expression.left);
    if (
      isNodeOfType(increment, "UpdateExpression") &&
      increment.operator === "++" &&
      increment.prefix &&
      isNodeOfType(increment.argument, "Identifier")
    ) {
      const symbol = context.scopes.symbolFor(increment.argument);
      if (symbol) return { symbol, kind: "counter", identifiers: [increment.argument] };
    }
  }
  if (
    isNodeOfType(expression, "AssignmentExpression") &&
    expression.operator === "=" &&
    isNodeOfType(expression.left, "Identifier")
  ) {
    const negation = stripParenExpression(expression.right);
    if (
      isNodeOfType(negation, "UnaryExpression") &&
      negation.operator === "!" &&
      isNodeOfType(negation.argument, "Identifier")
    ) {
      const symbol = context.scopes.symbolFor(expression.left);
      if (symbol && context.scopes.symbolFor(negation.argument) === symbol) {
        return {
          symbol,
          kind: "toggle",
          identifiers: [expression.left, negation.argument],
        };
      }
    }
  }
  return null;
};

export const hasNonrepeatableNativeFindPredicate = (
  guardCall: EsTreeNodeOfType<"CallExpression">,
  findCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (
    guardCall === findCall ||
    findEnclosingFunction(guardCall) !== findEnclosingFunction(findCall)
  ) {
    return false;
  }
  const guardReceiver = getRepeatedPredicateReceiver(guardCall, true);
  const findReceiver = getRepeatedPredicateReceiver(findCall, false);
  if (!guardReceiver || !findReceiver) return false;
  const receiverSymbol = context.scopes.symbolFor(guardReceiver);
  if (!receiverSymbol || context.scopes.symbolFor(findReceiver) !== receiverSymbol) return false;
  if (
    !isClosedNativeArrayFindReceiver(guardReceiver, context, { includeRepeatedGuardMethods: true })
  ) {
    return false;
  }
  const initializer = getDirectConstInitializer(receiverSymbol);
  const array = initializer && stripParenExpression(initializer);
  if (
    !isNodeOfType(array, "ArrayExpression") ||
    array.elements.length !== REPEATED_FIND_SINGLE_ITEM_COUNT
  ) {
    return false;
  }
  const [element] = array.elements;
  if (!element || isNodeOfType(element, "SpreadElement")) return false;
  if (
    !receiverSymbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" &&
          (reference.identifier === guardReceiver || reference.identifier === findReceiver)),
    )
  )
    return false;
  const guardCallback = getRepeatedPredicateCallback(guardCall, findCall, context);
  const findCallback = getRepeatedPredicateCallback(findCall, guardCall, context);
  if (!guardCallback || !findCallback) return false;
  const guardTransition = getCapturedScalarTransition(guardCallback, context);
  const findTransition = getCapturedScalarTransition(findCallback, context);
  if (
    !guardTransition ||
    !findTransition ||
    guardTransition.kind !== findTransition.kind ||
    guardTransition.symbol !== findTransition.symbol
  )
    return false;
  const scalarSymbol = guardTransition.symbol;
  const scalarDeclaration = scalarSymbol.declarationNode;
  const containingFunction = findEnclosingFunction(guardCall);
  const scalarInitializer =
    scalarSymbol.initializer && stripParenExpression(scalarSymbol.initializer);
  if (
    scalarSymbol.kind !== "let" ||
    !isNodeOfType(scalarDeclaration, "VariableDeclarator") ||
    scalarDeclaration.id !== scalarSymbol.bindingIdentifier ||
    !isNodeOfType(scalarDeclaration.parent, "VariableDeclaration") ||
    isNodeOfType(scalarDeclaration.parent.parent, "ExportNamedDeclaration") ||
    findEnclosingFunction(scalarDeclaration) !== containingFunction ||
    !isNodeOfType(scalarInitializer, "Literal") ||
    scalarInitializer.value !==
      (guardTransition.kind === "counter" ? REPEATED_FIND_COUNTER_INITIAL_VALUE : false)
  )
    return false;
  const allowedIdentifiers = new Set([
    ...guardTransition.identifiers,
    ...findTransition.identifiers,
  ]);
  return scalarSymbol.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      allowedIdentifiers.has(reference.identifier),
  );
};
