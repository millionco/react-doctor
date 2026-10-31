import type { Reference } from "eslint-scope";
import { REACT_CALLBACK_FORWARDER_ARGUMENT_COUNT } from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getTransparentReactCallbackWrapperArgument } from "../../../utils/get-transparent-react-callback-wrapper-argument.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getCallExpr } from "./effect/ast.js";

export const isDirectReactCallbackStateForwarder = (
  call: EsTreeNode,
  callback: EsTreeNode | null,
  notificationReferences: ReadonlyArray<Reference>,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== REACT_CALLBACK_FORWARDER_ARGUMENT_COUNT
  )
    return false;
  const [argument] = call.arguments;
  if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
  const stateArgument = stripParenExpression(argument);
  const stateSymbol = isNodeOfType(stateArgument, "Identifier")
    ? context.scopes.symbolFor(stateArgument)
    : null;
  const stateDeclaration = stateSymbol?.declarationNode;
  const program = findProgramRoot(call);
  if (
    !program ||
    !stateSymbol ||
    stateSymbol.kind !== "const" ||
    !hasCompleteSymbolReferences(stateSymbol, program, context.scopes) ||
    stateSymbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    ) ||
    !isNodeOfType(stateDeclaration, "VariableDeclarator") ||
    !isNodeOfType(stateDeclaration.id, "ArrayPattern") ||
    !isNodeOfType(stateDeclaration.init, "CallExpression")
  )
    return false;
  const [stateBinding, setterBinding] = stateDeclaration.id.elements;
  const statePair = setterBinding ? resolveReactUseStatePair(setterBinding, context.scopes) : null;
  const stateReceiver = getRootIdentifier(stateDeclaration.init.callee);
  const stateProvider = stateReceiver ? context.scopes.symbolFor(stateReceiver) : null;
  if (
    stateBinding !== stateSymbol.bindingIdentifier ||
    statePair?.stateSymbol !== stateSymbol ||
    !stateProvider ||
    getImportDeclarationForSymbol(stateProvider)?.source.value !== "react" ||
    !isUnmodifiedLocalReactStateCall(stateDeclaration.init, context.scopes)
  )
    return false;
  const callee = stripParenExpression(call.callee);
  const symbol = resolveConstIdentifierAlias(callee, context.scopes);
  const initializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
  if (
    !isNodeOfType(callee, "Identifier") ||
    symbol?.kind !== "const" ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isNodeOfType(initializer.callee, "MemberExpression") ||
    initializer.callee.optional
  )
    return false;
  const equivalents = getEquivalentSymbols(callee, context.scopes);
  if (
    !equivalents.some((equivalent) => equivalent === symbol) ||
    !equivalents.every(
      (equivalent) =>
        hasCompleteSymbolReferences(equivalent, program, context.scopes) &&
        equivalent.references.every(
          (reference) =>
            reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
        ),
    )
  )
    return false;
  const namespace = getRootIdentifier(initializer.callee);
  const provider = namespace ? context.scopes.symbolFor(namespace) : null;
  const imported = provider ? getImportDeclarationForSymbol(provider) : null;
  if (
    !imported ||
    imported.source.value !== "react" ||
    imported.importKind === "type" ||
    (isNodeOfType(provider?.declarationNode, "ImportSpecifier") &&
      provider.declarationNode.importKind === "type") ||
    !isProvenUnmodifiedReactApiCall(initializer, "useCallback", context.scopes) ||
    hasReactDefaultProviderMutation("useCallback", context.scopes) ||
    getTransparentReactCallbackWrapperArgument(initializer, symbol, context.scopes) !== callback ||
    !callback ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== REACT_CALLBACK_FORWARDER_ARGUMENT_COUNT
  )
    return false;
  const [parameter] = callback.params;
  const parameterSymbol = isNodeOfType(parameter, "Identifier")
    ? context.scopes.symbolFor(parameter)
    : null;
  const returned = getSingleReturnExpression(callback);
  const forwarded = returned ? stripParenExpression(returned) : null;
  if (
    !parameterSymbol ||
    !hasCompleteSymbolReferences(parameterSymbol, program, context.scopes) ||
    !isNodeOfType(forwarded, "CallExpression") ||
    forwarded.optional ||
    forwarded.arguments.length !== REACT_CALLBACK_FORWARDER_ARGUMENT_COUNT
  )
    return false;
  const [forwardedArgument] = forwarded.arguments;
  if (
    !isNodeOfType(forwardedArgument, "Identifier") ||
    context.scopes.symbolFor(forwardedArgument) !== parameterSymbol ||
    !parameterSymbol.references.every(
      (reference) => reference.identifier === forwardedArgument && reference.flag === "read",
    )
  )
    return false;
  return notificationReferences.some((reference) => getCallExpr(reference) === forwarded);
};
