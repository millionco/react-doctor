import { createImportedNativeMediaGuardPredicate } from "./create-imported-native-media-guard-predicate.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getUninterruptedConstInitializer } from "../../../utils/get-uninterrupted-const-initializer.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  FIRST_ARGUMENT_INDEX,
  NATIVE_MEDIA_CALL_ARGUMENT_COUNT,
  NATIVE_MEDIA_EFFECT_PARAMETER_COUNT,
  NATIVE_MEDIA_ELEMENT_NAMES,
  NATIVE_MEDIA_PROVIDER_NAMES,
  NATIVE_MEDIA_SUPPORT_VALUES,
  NATIVE_MEDIA_STATE_TUPLE_LENGTH,
} from "./effect/constants.js";

interface NativeMediaCapabilityPredicateInput {
  context: RuleContext;
  effectNode: EsTreeNode;
  effectFunction: EsTreeNode;
  stateDeclarator: EsTreeNode;
  executionNode?: EsTreeNode;
}

const isReadonlyBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.kind === "const" &&
  symbol.references.every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );

const hasCanonicalReactImport = (call: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const identifier = getRootIdentifier(call.callee);
  const symbol = identifier ? context.scopes.symbolFor(identifier) : null;
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  return Boolean(
    declaration &&
    declaration.source.value === "react" &&
    declaration.importKind !== "type" &&
    (!isNodeOfType(symbol?.declarationNode, "ImportSpecifier") ||
      symbol.declarationNode.importKind !== "type"),
  );
};

const isOrdinaryMemberCall = (node: EsTreeNode, memberName: string): boolean =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === NATIVE_MEDIA_CALL_ARGUMENT_COUNT &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  !node.callee.computed &&
  getStaticPropertyName(node.callee) === memberName;

const isFreshMediaElement = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isOrdinaryMemberCall(node, "createElement") || !isNodeOfType(node, "CallExpression"))
    return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  const tag = node.arguments[FIRST_ARGUMENT_INDEX];
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "document" &&
    context.scopes.isGlobalReference(receiver) &&
    isNodeOfType(tag, "Literal") &&
    typeof tag.value === "string" &&
    NATIVE_MEDIA_ELEMENT_NAMES.has(tag.value)
  );
};

export const createNativeMediaCapabilityPredicate = ({
  context,
  effectNode,
  effectFunction,
  stateDeclarator,
  executionNode,
}: NativeMediaCapabilityPredicateInput): ((expression: EsTreeNode) => boolean) | null => {
  if (!isNodeOfType(stateDeclarator, "VariableDeclarator") || !isFunctionLike(effectFunction))
    return null;
  let hasMediaCall = false;
  walkAst(effectFunction, (node) => {
    if (node !== effectFunction && isFunctionLike(node)) return false;
    if (isOrdinaryMemberCall(node, "canPlayType")) hasMediaCall = true;
  });
  const importedPredicate = executionNode
    ? createImportedNativeMediaGuardPredicate({ context, effectFunction, executionNode })
    : null;
  if (!hasMediaCall && !importedPredicate) return null;
  const stateCall = stateDeclarator.init ? stripParenExpression(stateDeclarator.init) : null;
  const effectArgument = isNodeOfType(effectNode, "CallExpression")
    ? effectNode.arguments[FIRST_ARGUMENT_INDEX]
    : null;
  if (
    !stateCall ||
    !effectArgument ||
    !hasCanonicalReactImport(stateCall, context) ||
    !isUnmodifiedLocalReactStateCall(stateCall, context.scopes) ||
    !hasCanonicalReactImport(effectNode, context) ||
    !isProvenUnmodifiedReactApiCall(effectNode, "useEffect", context.scopes) ||
    hasReactDefaultProviderMutation("useEffect", context.scopes) ||
    !isNodeOfType(effectNode, "CallExpression") ||
    stripParenExpression(effectArgument) !== effectFunction ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
    stateDeclarator.id.elements.length !== NATIVE_MEDIA_STATE_TUPLE_LENGTH ||
    effectFunction.async ||
    effectFunction.generator ||
    effectFunction.params.length !== NATIVE_MEDIA_EFFECT_PARAMETER_COUNT ||
    findEnclosingFunction(stateDeclarator) !== findEnclosingFunction(effectNode) ||
    stateDeclarator.id.elements.some((binding) => {
      if (!isNodeOfType(binding, "Identifier")) return true;
      const symbol = context.scopes.symbolFor(binding);
      return !symbol || !isReadonlyBinding(symbol);
    })
  )
    return null;
  let hasProviderHazard = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasProviderHazard) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "MemberExpression") && isMemberMutationTarget(node)) ||
      isProvenGlobalObjectReference(node, context.scopes) ||
      [...NATIVE_MEDIA_PROVIDER_NAMES].some((provider) =>
        isProvenGlobalNamespaceReference(node, provider, context.scopes),
      ) ||
      ((isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))) &&
        getResolvedStaticPropertyName(node, context.scopes) === "__proto__")
    ) {
      hasProviderHazard = true;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== "document" ||
      !context.scopes.isGlobalReference(node)
    )
      return;
    const member = findTransparentExpressionRoot(node).parent;
    const call = member ? findTransparentExpressionRoot(member).parent : null;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      !isNodeOfType(call, "CallExpression") ||
      !isFreshMediaElement(call, context)
    )
      hasProviderHazard = true;
  });
  if (hasProviderHazard) return null;

  const resolveValue = (
    expression: EsTreeNode,
    isReceiver: boolean,
    visited = new Set<number>(),
  ): EsTreeNode | null => {
    const node = stripParenExpression(expression);
    if (isReceiver && isFreshMediaElement(node, context)) return node;
    if (!isReceiver && isOrdinaryMemberCall(node, "canPlayType")) {
      if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
        return null;
      return resolveValue(node.callee.object, true) ? node : null;
    }
    if (!isNodeOfType(node, "Identifier")) return null;
    const symbol = context.scopes.symbolFor(node);
    if (
      !symbol ||
      visited.has(symbol.id) ||
      !isReadonlyBinding(symbol) ||
      findEnclosingFunction(symbol.declarationNode) !== effectFunction
    )
      return null;
    const initializer = getUninterruptedConstInitializer(node, context);
    if (!initializer) return null;
    visited.add(symbol.id);
    if (isReceiver) {
      const aliases = getEquivalentSymbols(symbol.bindingIdentifier, context.scopes);
      if (
        aliases.some(
          (alias) =>
            !isReadonlyBinding(alias) ||
            alias.references.some((reference) => {
              const root = findTransparentExpressionRoot(reference.identifier);
              const parent = root.parent;
              if (findEnclosingFunction(reference.identifier) !== effectFunction) return true;
              if (
                isNodeOfType(parent, "VariableDeclarator") &&
                parent.init === root &&
                isNodeOfType(parent.id, "Identifier") &&
                isNodeOfType(parent.parent, "VariableDeclaration") &&
                parent.parent.kind === "const"
              )
                return false;
              const call = parent ? findTransparentExpressionRoot(parent).parent : null;
              return (
                !isNodeOfType(parent, "MemberExpression") ||
                parent.object !== root ||
                !call ||
                !isOrdinaryMemberCall(call, "canPlayType")
              );
            }),
        )
      )
        return null;
    }
    return resolveValue(initializer, isReceiver, visited);
  };

  const comparisonValue = (expression: EsTreeNode): EsTreeNode | null => {
    const node = stripParenExpression(expression);
    if (!isNodeOfType(node, "BinaryExpression") || !["===", "!=="].includes(node.operator))
      return null;
    const literal = isNodeOfType(node.right, "Literal") ? node.right : node.left;
    const value = literal === node.right ? node.left : node.right;
    return isNodeOfType(literal, "Literal") &&
      typeof literal.value === "string" &&
      NATIVE_MEDIA_SUPPORT_VALUES.has(literal.value)
      ? resolveValue(value, false)
      : null;
  };
  const matchesPredicate = (expression: EsTreeNode): boolean => {
    const node = stripParenExpression(expression);
    if (isNodeOfType(node, "UnaryExpression") && node.operator === "!")
      return matchesPredicate(node.argument);
    if (isNodeOfType(node, "LogicalExpression") && node.operator === "||") {
      const left = stripParenExpression(node.left);
      const right = stripParenExpression(node.right);
      if (
        !isNodeOfType(left, "BinaryExpression") ||
        !isNodeOfType(right, "BinaryExpression") ||
        left.operator !== "===" ||
        right.operator !== "===" ||
        !isNodeOfType(left.right, "Literal") ||
        !isNodeOfType(right.right, "Literal") ||
        typeof left.right.value !== "string" ||
        typeof right.right.value !== "string" ||
        left.right.value === "" ||
        right.right.value === "" ||
        !NATIVE_MEDIA_SUPPORT_VALUES.has(left.right.value) ||
        !NATIVE_MEDIA_SUPPORT_VALUES.has(right.right.value) ||
        left.right.value === right.right.value
      )
        return false;
      const leftValue = comparisonValue(left);
      return Boolean(leftValue && leftValue === comparisonValue(right));
    }
    return Boolean(comparisonValue(node) || resolveValue(node, false));
  };
  return (expression) => {
    const root = findTransparentExpressionRoot(expression);
    const parent = root.parent;
    return (
      !(
        isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "??" &&
        parent.left === root
      ) &&
      (matchesPredicate(expression) || Boolean(importedPredicate?.(expression)))
    );
  };
};
