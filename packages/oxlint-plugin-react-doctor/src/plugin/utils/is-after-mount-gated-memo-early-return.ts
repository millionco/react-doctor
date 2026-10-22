import {
  MOUNT_GATE_CALLBACK_PARAMETER_COUNT,
  MOUNT_GATE_FIRST_ARGUMENT_INDEX,
  MOUNT_GATE_INITIAL_STATE_ARGUMENT_COUNT,
  MOUNT_GATE_RETURN_STATEMENT_COUNT,
  MOUNT_GATE_STATE_SETTER_INDEX,
  MOUNT_GATE_STATE_TUPLE_LENGTH,
} from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isUnmodifiedLocalReactStateCall } from "./is-unmodified-local-react-state-call.js";
import { readInitialStateBoolean } from "./read-initial-state-boolean.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isAfterMountGatedMemoEarlyReturn = (
  node: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const callback = findEnclosingFunction(node);
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !callback ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== MOUNT_GATE_CALLBACK_PARAMETER_COUNT ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return false;
  }
  const isNativeHookCall = (call: EsTreeNode, apiName: string): boolean => {
    if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
    const identifier = getRootIdentifier(stripParenExpression(call.callee));
    const symbol = identifier ? context.scopes.symbolFor(identifier) : null;
    const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
    return Boolean(
      declaration?.source.value === "react" &&
      declaration.importKind !== "type" &&
      !(
        isNodeOfType(symbol?.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type"
      ) &&
      isProvenUnmodifiedReactApiCall(call, apiName, context.scopes) &&
      !hasReactDefaultProviderMutation(apiName, context.scopes),
    );
  };
  const callbackRoot = findTransparentExpressionRoot(callback);
  const memoCall = callbackRoot.parent;
  if (
    !isNodeOfType(memoCall, "CallExpression") ||
    memoCall.arguments[MOUNT_GATE_FIRST_ARGUMENT_INDEX] !== callbackRoot ||
    findEnclosingFunction(memoCall) !== owner ||
    !isNativeHookCall(memoCall, "useMemo")
  ) {
    return false;
  }
  const isClosedFalseState = (identifier: EsTreeNode): boolean => {
    const stateSymbol = context.scopes.symbolFor(identifier);
    const declarator = stateSymbol?.declarationNode;
    if (
      !stateSymbol ||
      stateSymbol.kind !== "const" ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.id, "ArrayPattern") ||
      declarator.id.elements.length !== MOUNT_GATE_STATE_TUPLE_LENGTH ||
      declarator.id.elements[MOUNT_GATE_FIRST_ARGUMENT_INDEX] !== stateSymbol.bindingIdentifier ||
      !declarator.init ||
      !isNodeOfType(declarator.init, "CallExpression") ||
      declarator.init.arguments.length !== MOUNT_GATE_INITIAL_STATE_ARGUMENT_COUNT ||
      findEnclosingFunction(declarator.init) !== owner ||
      !isUnmodifiedLocalReactStateCall(declarator.init, context.scopes) ||
      !isNativeHookCall(declarator.init, "useState") ||
      stateSymbol.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      )
    ) {
      return false;
    }
    const initialValue = stripParenExpression(
      declarator.init.arguments[MOUNT_GATE_FIRST_ARGUMENT_INDEX],
    );
    const setterBinding = declarator.id.elements[MOUNT_GATE_STATE_SETTER_INDEX];
    if (
      !isNodeOfType(initialValue, "Literal") ||
      initialValue.value !== false ||
      !isNodeOfType(setterBinding, "Identifier")
    ) {
      return false;
    }
    const setterSymbol = context.scopes.symbolFor(setterBinding);
    return Boolean(
      setterSymbol &&
      setterSymbol.references.every((reference) => {
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier))
          return false;
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const setterCall = referenceRoot.parent;
        const effectCallback = findEnclosingFunction(reference.identifier);
        if (
          !isNodeOfType(setterCall, "CallExpression") ||
          setterCall.optional ||
          setterCall.callee !== referenceRoot ||
          setterCall.arguments.length !== MOUNT_GATE_INITIAL_STATE_ARGUMENT_COUNT ||
          isNodeOfType(setterCall.arguments[MOUNT_GATE_FIRST_ARGUMENT_INDEX], "SpreadElement") ||
          !effectCallback ||
          !isFunctionLike(effectCallback) ||
          effectCallback.async ||
          effectCallback.generator ||
          effectCallback.params.length !== MOUNT_GATE_CALLBACK_PARAMETER_COUNT
        ) {
          return false;
        }
        const effectRoot = findTransparentExpressionRoot(effectCallback);
        const effectCall = effectRoot.parent;
        return Boolean(
          isNodeOfType(effectCall, "CallExpression") &&
          effectCall.arguments[MOUNT_GATE_FIRST_ARGUMENT_INDEX] === effectRoot &&
          findEnclosingFunction(effectCall) === owner &&
          isNativeHookCall(effectCall, "useEffect"),
        );
      }),
    );
  };
  const ancestors = new Set<EsTreeNode>();
  let current: EsTreeNode | null | undefined = node;
  while (current && current !== callback) {
    ancestors.add(current);
    current = current.parent;
  }
  for (const statement of callback.body.body) {
    if (ancestors.has(statement)) return false;
    if (!isNodeOfType(statement, "IfStatement")) continue;
    let hasFalseState = false;
    const hasSupportedBooleanInputs = (expression: EsTreeNode): boolean => {
      const candidate = stripParenExpression(expression);
      if (isNodeOfType(candidate, "Literal")) return true;
      if (isNodeOfType(candidate, "Identifier")) {
        if (readInitialStateBoolean(candidate, context.scopes) === null) return true;
        if (candidate.name === "undefined" && context.scopes.isGlobalReference(candidate))
          return true;
        if (!isClosedFalseState(candidate)) return false;
        hasFalseState = true;
        return true;
      }
      if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
        return hasSupportedBooleanInputs(candidate.argument);
      }
      return Boolean(
        isNodeOfType(candidate, "LogicalExpression") &&
        (candidate.operator === "&&" || candidate.operator === "||") &&
        hasSupportedBooleanInputs(candidate.left) &&
        hasSupportedBooleanInputs(candidate.right),
      );
    };
    if (!hasSupportedBooleanInputs(statement.test) || !hasFalseState) continue;
    const initialCondition = readInitialStateBoolean(statement.test, context.scopes);
    const isDirectCallbackReturn = (branch: EsTreeNode): boolean =>
      isNodeOfType(branch, "ReturnStatement") ||
      (isNodeOfType(branch, "BlockStatement") &&
        branch.body.length === MOUNT_GATE_RETURN_STATEMENT_COUNT &&
        isNodeOfType(branch.body[MOUNT_GATE_FIRST_ARGUMENT_INDEX], "ReturnStatement"));
    if (initialCondition === true && isDirectCallbackReturn(statement.consequent)) return true;
    if (
      initialCondition === false &&
      statement.alternate &&
      isDirectCallbackReturn(statement.alternate)
    ) {
      return true;
    }
  }
  return false;
};
